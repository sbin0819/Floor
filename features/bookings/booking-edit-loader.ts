import type { Session } from "@/lib/auth/types";
import { ActionError } from "@/lib/actions/result";
import type { DalDatabase } from "@/lib/dal";
import { getFloorWithAccess } from "@/lib/dal/branches";
import {
  getBookingWithLocation,
  listSpaceBookings,
  listSpaceBlocks,
  sumBookedMinutes,
} from "@/lib/dal/bookings";
import { listBookingParticipantDetails } from "@/lib/dal/booking-edit";
import { listFloorSpaceAccess } from "@/lib/dal/spaces";
import { listSpaceCoverPhotos } from "@/lib/dal/photos";
import { loadPermissionData } from "@/lib/permissions/context";
import { getOpenHours } from "@/lib/time/open-hours";
import { localDate } from "@/lib/time/zoned";
import { canBookAs } from "./access";
import {
  bookingLimitRole,
  remainingDailyMinutes,
  resolveBookingLimits,
} from "./limits";
import { maskParticipantEmail } from "./participants";
import { bookingDayRange } from "./rules";
import type { BookingForEditData } from "./types";
import { canCancelBooking, canSeeBookingTitle } from "./visibility";

export async function loadBookingForEdit({
  bookingId,
  session,
  current,
  db,
}: {
  bookingId: string;
  session: Session;
  current: Date;
  db?: DalDatabase;
}): Promise<BookingForEditData> {
  const row = await getBookingWithLocation(bookingId, db);
  if (
    !row ||
    row.booking.userId !== session.userId ||
    row.booking.status !== "confirmed" ||
    row.booking.during.end <= current ||
    row.space.archivedAt ||
    row.space.type === "desk"
  )
    throw new ActionError("NOT_FOUND");
  const { booking, space, branch } = row;
  const [floor, identities, { context, settings }] = await Promise.all([
    getFloorWithAccess(row.floor.id, db),
    listFloorSpaceAccess(row.floor.id, db),
    loadPermissionData(session, branch.id, db),
  ]);
  const identity = identities.find(({ id }) => id === space.id);
  if (
    !floor ||
    floor.branchId !== branch.id ||
    !identity ||
    !canBookAs(context, { ...identity, floor }, booking.teamId)
  )
    throw new ActionError("NOT_FOUND");
  // 예약한 날짜는 조회 시점의 오늘·60일 창으로 보정하지 않는다.
  const date = localDate(booking.during.start, branch.timezone);
  const during = bookingDayRange(date, branch.timezone);
  const [photos, schedule, blocks, usedMinutes, participants] =
    await Promise.all([
      listSpaceCoverPhotos([space.id], db),
      listSpaceBookings(
        { spaceIds: [space.id], during, excludeBookingId: booking.id },
        db,
      ),
      listSpaceBlocks({ spaceIds: [space.id], during }, db),
      sumBookedMinutes(
        {
          branchId: branch.id,
          during,
          actor: booking.teamId
            ? { teamId: booking.teamId }
            : { userId: session.userId },
          excludeBookingId: booking.id,
        },
        db,
      ),
      listBookingParticipantDetails(booking.id, session.userId, db),
    ]);
  const role = bookingLimitRole(context, branch.id, booking.teamId);
  const limits = resolveBookingLimits(role, settings[role]?.limits);
  const cover = photos[0];
  return {
    booking: {
      id: booking.id,
      start: booking.during.start.toISOString(),
      end: booking.during.end.toISOString(),
      attendeeCount: booking.attendeeCount,
      title: booking.title,
      started: booking.during.start <= current,
    },
    participants: participants.map(({ email, ...participant }) => ({
      ...participant,
      maskedEmail: maskParticipantEmail(email),
    })),
    actor: {
      teamId: booking.teamId,
      name: booking.teamId ? `${row.teamName ?? "팀"}으로` : "개인으로",
      limits,
      remainingMinutes: remainingDailyMinutes(limits, usedMinutes),
    },
    space: {
      id: space.id,
      type: space.type,
      name: space.name,
      capacity: space.capacity,
      amenities: space.amenities,
      photo: cover ? { path: cover.path, alt: cover.alt } : null,
    },
    branch: {
      id: branch.id,
      name: branch.name,
      timezone: branch.timezone,
      openHours: branch.openHours,
    },
    floor: { id: floor.id, name: floor.name },
    date,
    now: current.toISOString(),
    openHours: getOpenHours(branch.openHours, date),
    bookings: schedule.map((other) => ({
      id: other.id,
      start: other.during.start.toISOString(),
      end: other.during.end.toISOString(),
      bookerName: other.teamName ?? other.userName,
      isMine:
        other.userId === session.userId ||
        context.teams.some(({ teamId }) => teamId === other.teamId),
      canCancel:
        other.during.end > current &&
        canCancelBooking(context, other, branch.id),
      ...(canSeeBookingTitle(context, other, branch.id)
        ? { title: other.title, attendeeCount: other.attendeeCount }
        : {}),
    })),
    blocks: blocks.map((block) => ({
      id: block.id,
      start: block.during.start.toISOString(),
      end: block.during.end.toISOString(),
      reason: block.reason,
    })),
  };
}

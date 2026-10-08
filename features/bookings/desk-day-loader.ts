import { availableBookingActors } from "@/features/bookings/access";
import { arrangeDesks } from "@/features/bookings/desk-layout";
import {
  classifyDeskPart,
  createDeskParts,
} from "@/features/bookings/desk-parts";
import { summarizeDesks } from "@/features/bookings/desk-states";
import {
  bookingLimitRole,
  resolveBookingLimits,
} from "@/features/bookings/limits";
import type {
  BranchDetails,
  FloorSummary,
  SpaceDayData,
} from "@/features/bookings/types";
import { ActionError } from "@/lib/actions/result";
import type { DalDatabase } from "@/lib/dal";
import { listUserTeamHomeBranches } from "@/lib/dal/bookings";
import {
  listDesks,
  listDeskBookings,
  listDeskBlocks,
  listFloorSeats,
} from "@/lib/dal/desks";
import { getSpacesByIds } from "@/lib/dal/spaces";
import type { loadPermissionData } from "@/lib/permissions/context";
import type { SpaceForAccess } from "@/lib/permissions/types";
import { getOpenHours } from "@/lib/time/open-hours";
import { bookingDayRange } from "@/features/bookings/rules";

export async function loadDeskDay({
  id,
  branch,
  floor,
  identity,
  date,
  current,
  context,
  settings,
  db,
}: {
  id: string;
  branch: BranchDetails;
  floor: FloorSummary;
  identity: SpaceForAccess;
  date: string;
  current: Date;
  context: Awaited<ReturnType<typeof loadPermissionData>>["context"];
  settings: Awaited<ReturnType<typeof loadPermissionData>>["settings"];
  db: DalDatabase | undefined;
}): Promise<SpaceDayData> {
  const during = bookingDayRange(date, branch.timezone);
  const input = { parentIds: [id], during };
  const [metadata, desks, bookings, blocks, teams, positions] =
    await Promise.all([
      getSpacesByIds([id], db),
      listDesks([id], db),
      listDeskBookings(input, db),
      listDeskBlocks(input, db),
      listUserTeamHomeBranches(context.userId, db),
      listFloorSeats(floor.id, db),
    ]);
  const space = metadata[0];
  if (!space || space.floorId !== floor.id) throw new ActionError("NOT_FOUND");
  const parts = createDeskParts({
    date,
    timeZone: branch.timezone,
    openHours: branch.openHours,
  });
  const summary = summarizeDesks({
    desks,
    bookings,
    blocks,
    parts,
    userId: context.userId,
    now: current,
  });
  return {
    branch,
    floor,
    date,
    now: current.toISOString(),
    openHours: getOpenHours(branch.openHours, date),
    photos: space.photos,
    space: {
      kind: "accessible",
      id: space.id,
      type: space.type,
      name: space.name,
      capacity: space.capacity,
      photo: space.photo,
      amenities: space.amenities,
      bookable: space.bookable,
      deskCount: desks.length,
      bookingCount: 0,
      status: null,
    },
    bookings: [],
    blocks: [],
    hasTeams: context.teams.length > 0,
    actors: availableBookingActors(context, identity).map((teamId) => {
      const role = bookingLimitRole(context, branch.id, teamId);
      return {
        teamId,
        name:
          teamId === null
            ? "개인으로"
            : `${teams.find(({ id }) => id === teamId)?.name ?? "팀"}으로`,
        limits: resolveBookingLimits(role, settings[role]?.limits),
        remainingMinutes: null,
      };
    }),
    desk: {
      parts: summary.parts,
      seats: arrangeDesks(desks, positions).map((seat) => ({
        ...seat,
        states: summary.states.get(seat.id) ?? {},
      })),
      myBookings: bookings
        .filter(({ userId }) => userId === context.userId)
        .map((booking) => ({
          id: booking.id,
          deskId: booking.spaceId,
          deskName:
            desks.find(({ id }) => id === booking.spaceId)?.name ?? "좌석",
          start: booking.during.start.toISOString(),
          end: booking.during.end.toISOString(),
          part: classifyDeskPart(booking.during, parts),
          canCancel: booking.during.end > current,
        })),
    },
  };
}

import { z } from "zod";
import { availableBookingActors } from "@/features/bookings/access";
import {
  bookingLimitRole,
  remainingDailyMinutes,
  resolveBookingLimits,
} from "@/features/bookings/limits";
import { bookingDayRange } from "@/features/bookings/rules";
import { getSpaceStatus } from "@/features/bookings/status";
import {
  canCancelBooking,
  canSeeBookingTitle,
} from "@/features/bookings/visibility";
import type {
  BranchDetails,
  BranchFloorsData,
  BranchListItem,
  FloorDayData,
  FloorSummary,
  MyBooking,
  MyBookingsData,
  SpaceDayData,
  SpaceType,
} from "@/features/bookings/types";
import { ActionError } from "@/lib/actions/result";
import { requireSession } from "@/lib/auth/session";
import type { Session } from "@/lib/auth/types";
import {
  getRoleSettings,
  getSpaceForAccess,
  type DalDatabase,
} from "@/lib/dal";
import {
  getBranch,
  getFloorWithAccess,
  listBranchDetails,
  listFloorsWithAccess,
} from "@/lib/dal/branches";
import {
  getUserDefaultBranch,
  listMyBookings,
  listSpaceBlocks,
  listSpaceBookings,
  listUserTeamHomeBranches,
  sumBookedMinutes,
} from "@/lib/dal/bookings";
import {
  getDeskCounts,
  getSpacesByIds,
  listFloorSpaceAccess,
} from "@/lib/dal/spaces";
import { can } from "@/lib/permissions/can";
import { canAccess, canAccessFloor } from "@/lib/permissions/can-access";
import { loadPermissionContext } from "@/lib/permissions/context";
import { getOpenHours } from "@/lib/time/open-hours";
import { addDays, localDate } from "@/lib/time/zoned";

export type BookingQueryDependencies = {
  database?: DalDatabase;
  requireSession?: () => Promise<Session>;
  now?: () => Date;
};
const validId = (id: string) => {
  if (!z.uuid().safeParse(id).success) throw new ActionError("NOT_FOUND");
};
export function normalizeBookingDate(
  value: unknown,
  now: Date,
  timeZone: string,
): string {
  const today = localDate(now, timeZone);
  if (typeof value !== "string") return today;
  try {
    return addDays(value, 0) === value &&
      value >= today &&
      value <= addDays(today, 60)
      ? value
      : today;
  } catch {
    return today;
  }
}
const branchDto = (branch: BranchDetails): BranchDetails => ({
  id: branch.id,
  name: branch.name,
  address: branch.address,
  timezone: branch.timezone,
  openHours: branch.openHours,
});
const floorDto = (floor: FloorSummary): FloorSummary => ({
  id: floor.id,
  name: floor.name,
  level: floor.level,
  sortOrder: floor.sortOrder,
});
const order: SpaceType[] = [
  "meeting_room",
  "seminar",
  "phone_booth",
  "desk_area",
  "lounge",
  "desk",
];

export function createBookingQueries(
  dependencies: BookingQueryDependencies = {},
) {
  const db = dependencies.database;
  const readSession = dependencies.requireSession ?? requireSession;
  const now = dependencies.now ?? (() => new Date());
  async function branchFloors(session: Session, branchId: string) {
    validId(branchId);
    const branch = await getBranch(branchId, db);
    if (!branch) throw new ActionError("NOT_FOUND");
    const context = await loadPermissionContext(session, branch.id, db);
    const floors = can(context, "floor.view", { branchId: branch.id })
      ? (await listFloorsWithAccess(branch.id, db))
          .filter((floor) => canAccessFloor(context, floor))
          .map(floorDto)
      : [];
    return { branch: branchDto(branch), floors, context };
  }
  async function checkedFloor(
    session: Session,
    branchId: string,
    floorId: string,
  ) {
    validId(branchId);
    validId(floorId);
    const floor = await getFloorWithAccess(floorId, db);
    if (!floor || floor.branchId !== branchId)
      throw new ActionError("NOT_FOUND");
    const data = await branchFloors(session, floor.branchId);
    if (
      !can(data.context, "floor.view", { branchId: floor.branchId }) ||
      !canAccessFloor(data.context, floor)
    )
      throw new ActionError("NOT_FOUND");
    return { ...data, floor };
  }
  return {
    async getBranchList(): Promise<BranchListItem[]> {
      const session = await readSession();
      const current = now();
      const selected = await getUserDefaultBranch(session.userId, db);
      return (await listBranchDetails(db))
        .map((branch) => ({
          ...branchDto(branch),
          isDefault: branch.id === selected,
          todayHours: getOpenHours(
            branch.openHours,
            localDate(current, branch.timezone),
          ),
        }))
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
    },
    async getBookingEntry(): Promise<string | null> {
      const session = await readSession();
      const selected = await getUserDefaultBranch(session.userId, db);
      if (selected) return selected;
      return (
        (await listUserTeamHomeBranches(session.userId, db)).find(
          ({ homeBranchId }) => homeBranchId !== null,
        )?.homeBranchId ?? null
      );
    },
    async getBranchFloors(branchId: string): Promise<BranchFloorsData> {
      const data = await branchFloors(await readSession(), branchId);
      return { branch: data.branch, floors: data.floors };
    },
    async getFloorDay(
      branchId: string,
      floorId: string,
      value?: unknown,
    ): Promise<FloorDayData> {
      const session = await readSession();
      const current = now();
      const { branch, floor, floors, context } = await checkedFloor(
        session,
        branchId,
        floorId,
      );
      const date = normalizeBookingDate(value, current, branch.timezone);
      const during = bookingDayRange(date, branch.timezone);
      const accessRows = await listFloorSpaceAccess(floor.id, db);
      const allowedIds = accessRows
        .filter((space) => canAccess(context, { ...space, floor }))
        .map(({ id }) => id);
      const metadata = await getSpacesByIds(allowedIds, db);
      const bookings = await listSpaceBookings(
        { spaceIds: allowedIds, during },
        db,
      );
      const blocks = await listSpaceBlocks(
        { spaceIds: allowedIds, during },
        db,
      );
      const desks = await getDeskCounts(allowedIds, db);
      const isToday = date === localDate(current, branch.timezone);
      const summaries: FloorDayData["spaces"] = [];
      for (const row of accessRows) {
        if (!allowedIds.includes(row.id)) {
          summaries.push({ kind: "restricted", id: row.id, type: row.type });
          continue;
        }
        const space = metadata.find(({ id }) => id === row.id);
        if (!space || space.archivedAt || space.type === "desk") continue;
        const schedule = bookings.filter(({ spaceId }) => spaceId === space.id);
        summaries.push({
          kind: "accessible",
          id: space.id,
          type: space.type,
          name: space.name,
          capacity: space.capacity,
          amenities: space.amenities,
          bookable: space.bookable,
          deskCount:
            desks.find(({ parentId }) => parentId === space.id)?.count ?? 0,
          bookingCount: schedule.length,
          status: isToday
            ? getSpaceStatus({
                accessible: true,
                now: current,
                userId: session.userId,
                teamIds: context.teams.map(({ teamId }) => teamId),
                bookings: schedule.map((booking) => ({
                  ...booking.during,
                  userId: booking.userId,
                  teamId: booking.teamId,
                })),
                blocks: blocks
                  .filter(({ spaceId }) => spaceId === space.id)
                  .map(({ during }) => during),
              })
            : null,
        });
      }
      summaries.sort(
        (a, b) =>
          order.indexOf(a.type) - order.indexOf(b.type) ||
          (a.kind === "accessible" ? a.name : "").localeCompare(
            b.kind === "accessible" ? b.name : "",
            "ko",
          ),
      );
      return {
        branch,
        floor: floorDto(floor),
        floors,
        date,
        isToday,
        openHours: getOpenHours(branch.openHours, date),
        spaces: summaries,
      };
    },
    async getSpaceDay(spaceId: string, value?: unknown): Promise<SpaceDayData> {
      const session = await readSession();
      const current = now();
      validId(spaceId);
      const space = await getSpaceForAccess(spaceId, db);
      if (!space || space.archivedAt || space.type === "desk")
        throw new ActionError("NOT_FOUND");
      const { branch, floor, context } = await checkedFloor(
        session,
        space.floor.branchId,
        space.floor.id,
      );
      if (!canAccess(context, space)) throw new ActionError("NOT_FOUND");
      const date = normalizeBookingDate(value, current, branch.timezone);
      const during = bookingDayRange(date, branch.timezone);
      const bookings = await listSpaceBookings(
        { spaceIds: [spaceId], during },
        db,
      );
      const blocks = await listSpaceBlocks({ spaceIds: [spaceId], during }, db);
      const settings = await getRoleSettings(branch.id, db);
      const teams = await listUserTeamHomeBranches(session.userId, db);
      const actors = [];
      for (const teamId of availableBookingActors(context, space)) {
        const role = bookingLimitRole(context, branch.id, teamId);
        const limits = resolveBookingLimits(role, settings[role]?.limits);
        const usedMinutes = await sumBookedMinutes(
          {
            branchId: branch.id,
            during,
            actor: teamId ? { teamId } : { userId: session.userId },
          },
          db,
        );
        actors.push({
          teamId,
          name:
            teamId === null
              ? "개인으로"
              : `${teams.find(({ id }) => id === teamId)?.name ?? "팀"}으로`,
          limits,
          remainingMinutes: remainingDailyMinutes(limits, usedMinutes),
        });
      }
      const mine = (booking: { userId: string; teamId: string | null }) =>
        booking.userId === session.userId ||
        context.teams.some(({ teamId }) => teamId === booking.teamId);
      const desks = await getDeskCounts([spaceId], db);
      return {
        branch,
        floor: floorDto(floor),
        date,
        now: current.toISOString(),
        openHours: getOpenHours(branch.openHours, date),
        actors,
        hasTeams: context.teams.length > 0,
        space: {
          kind: "accessible",
          id: space.id,
          type: space.type,
          name: space.name,
          capacity: space.capacity,
          amenities: space.amenities,
          bookable: space.bookable,
          deskCount: desks[0]?.count ?? 0,
          bookingCount: bookings.length,
          status:
            date === localDate(current, branch.timezone)
              ? getSpaceStatus({
                  accessible: true,
                  now: current,
                  userId: session.userId,
                  teamIds: context.teams.map(({ teamId }) => teamId),
                  bookings: bookings.map((booking) => ({
                    ...booking.during,
                    userId: booking.userId,
                    teamId: booking.teamId,
                  })),
                  blocks: blocks.map(({ during }) => during),
                })
              : null,
        },
        bookings: bookings.map((booking) => ({
          id: booking.id,
          start: booking.during.start.toISOString(),
          end: booking.during.end.toISOString(),
          bookerName: booking.teamName ?? booking.userName,
          isMine: mine(booking),
          canCancel:
            booking.during.end > current &&
            canCancelBooking(context, booking, branch.id),
          ...(canSeeBookingTitle(context, booking, branch.id)
            ? { title: booking.title }
            : {}),
        })),
        blocks: blocks.map((block) => ({
          id: block.id,
          start: block.during.start.toISOString(),
          end: block.during.end.toISOString(),
          reason: block.reason,
        })),
      };
    },
    async getMyBookings(): Promise<MyBookingsData> {
      const session = await readSession();
      const rows = await listMyBookings(session.userId, now(), db);
      const dto = (row: (typeof rows.upcoming)[number]): MyBooking => ({
        id: row.booking.id,
        start: row.booking.during.start.toISOString(),
        end: row.booking.during.end.toISOString(),
        date: localDate(row.booking.during.start, row.branch.timezone),
        timezone: row.branch.timezone,
        title: row.booking.title,
        teamName: row.teamName,
        status: row.booking.status,
        cancelledAt: row.booking.cancelledAt?.toISOString() ?? null,
        branchId: row.branch.id,
        branchName: row.branch.name,
        floorId: row.floor.id,
        floorName: row.floor.name,
        spaceId: row.space.id,
        spaceName: row.space.name,
      });
      return { upcoming: rows.upcoming.map(dto), past: rows.past.map(dto) };
    },
  };
}

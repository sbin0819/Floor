import { z } from "zod";
import { loadDeskDay } from "@/features/bookings/desk-day-loader";
import {
  createDeskParts,
  classifyDeskPart,
} from "@/features/bookings/desk-parts";
import { summarizeDesks } from "@/features/bookings/desk-states";
import { readFloorDeskSchedule } from "@/lib/dal/desk-floor";
import {
  myBookingsMonthReadRange,
  normalizeMyBookingsMonth,
  type MyBookingsMonthInput,
} from "@/features/bookings/calendar";
import { availableBookingActors } from "@/features/bookings/access";
import {
  buildAvailabilityIntervals,
  getAvailabilitySummary,
} from "@/features/bookings/availability";
import {
  getOperatingState,
  getOperatingWindow,
} from "@/features/bookings/operating-state";
import { readBookingNow } from "@/features/bookings/request-clock";
import { normalizeBookingDate } from "@/features/bookings/date";
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
  BranchNavigationData,
  BranchNavigationStream,
  FloorDayData,
  FloorSummary,
  HomeHeaderData,
  HomeUpcomingBookingsData,
  HomeFreeSpacesData,
  HomeBookingLimitsData,
  HomeWeekBookingsData,
  HomeFrequentSpacesData,
  MyBooking,
  MyBookingsData,
  MyBookingsMonthData,
  MyBookingsMonthStream,
  SpaceDayData,
  SpaceType,
} from "@/features/bookings/types";
import { ActionError } from "@/lib/actions/result";
import { requireSession } from "@/lib/auth/session";
import type { Session } from "@/lib/auth/types";
import type { DalDatabase } from "@/lib/dal";
import {
  getBranch,
  listBranches,
  listFloorsWithAccess,
  listAllFloorsWithAccess,
} from "@/lib/dal/branches";
import {
  listBranchCards,
  listSpaceAvailabilityFlags,
  resolveBookingBranch,
} from "@/lib/dal/booking-discovery";
import { getAllRoleSettings } from "@/lib/dal/role-settings";
import {
  getFrequentSpaceCards,
  listFrequentSpaceAccess,
  listMySpaceBookingCounts,
  listMyWeekBookings,
} from "@/lib/dal/booking-home";
import { getMemberships } from "@/lib/dal/users";
import {
  listMyBookings,
  listMyConfirmedBookingsBetween,
  listMyBranchBookingDates,
  listMyUpcomingBookings,
  listSpaceBlocks,
  listSpaceBookings,
  listUserTeamHomeBranches,
  sumActorBookedMinutes,
  sumBookedMinutes,
} from "@/lib/dal/bookings";
import {
  getDeskCounts,
  getSpacesByIds,
  listFloorSpaceAccess,
  listBranchSpaceAccess,
  listAllSpaceAccess,
} from "@/lib/dal/spaces";
import { can } from "@/lib/permissions/can";
import { canAccess, canAccessFloor } from "@/lib/permissions/can-access";
import { loadPermissionData } from "@/lib/permissions/context";
import type { PermissionContext } from "@/lib/permissions/types";
import { getOpenHours } from "@/lib/time/open-hours";
import { addDays, localDate } from "@/lib/time/zoned";

export { normalizeBookingDate } from "@/features/bookings/date";

export type BookingQueryDependencies = {
  database?: DalDatabase;
  requireSession?: () => Promise<Session>;
  now?: () => Date;
};
const validId = (id: string) => {
  if (!z.uuid().safeParse(id).success) throw new ActionError("NOT_FOUND");
  return id.toLowerCase();
};
const branchDto = (
  branch: Omit<BranchDetails, "cover"> & {
    coverPhotoPath: string | null;
    coverPhotoAlt: string | null;
  },
): BranchDetails => ({
  id: branch.id,
  name: branch.name,
  address: branch.address,
  timezone: branch.timezone,
  openHours: branch.openHours,
  cover:
    branch.coverPhotoPath !== null && branch.coverPhotoAlt !== null
      ? { path: branch.coverPhotoPath, alt: branch.coverPhotoAlt }
      : null,
});
const floorDto = (floor: FloorSummary): FloorSummary => ({
  id: floor.id,
  name: floor.name,
  level: floor.level,
  sortOrder: floor.sortOrder,
});
const myBookingDto = (
  row: Awaited<ReturnType<typeof listMyBookings>>["upcoming"][number],
): MyBooking => ({
  desk:
    row.space.type === "desk"
      ? {
          id: row.space.id,
          name: row.space.name,
          part: classifyDeskPart(
            row.booking.during,
            createDeskParts({
              date: localDate(row.booking.during.start, row.branch.timezone),
              timeZone: row.branch.timezone,
              openHours: row.branch.openHours,
            }),
          ),
        }
      : null,
  id: row.booking.id,
  start: row.booking.during.start.toISOString(),
  end: row.booking.during.end.toISOString(),
  date: localDate(row.booking.during.start, row.branch.timezone),
  timezone: row.branch.timezone,
  title: row.booking.title,
  attendeeCount: row.booking.attendeeCount,
  teamName: row.teamName,
  status: row.booking.status,
  cancelledAt: row.booking.cancelledAt?.toISOString() ?? null,
  branchId: row.branch.id,
  branchName: row.branch.name,
  floorId: row.floor.id,
  floorName: row.floor.name,
  spaceId: (row.area ?? row.space).id,
  spaceName: (row.area ?? row.space).name,
  spaceType: (row.area ?? row.space).type,
  photo: row.photo,
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
  const now = dependencies.now ?? (() => readBookingNow(db !== undefined));
  async function branchFloors(session: Session, branchId: string) {
    const id = validId(branchId);
    const [branch, rows, { context, settings }] = await Promise.all([
      getBranch(id, db),
      listFloorsWithAccess(id, db),
      loadPermissionData(session, id, db),
    ]);
    if (!branch) throw new ActionError("NOT_FOUND");
    const floors = can(context, "floor.view", { branchId: branch.id })
      ? rows.filter((floor) => canAccessFloor(context, floor)).map(floorDto)
      : [];
    return { branch: branchDto(branch), floors, context, settings, rows };
  }
  function checkedFloor(
    data: Awaited<ReturnType<typeof branchFloors>>,
    floorId: string,
  ) {
    const floor = data.rows.find(({ id }) => id === floorId);
    if (!floor || floor.branchId !== data.branch.id)
      throw new ActionError("NOT_FOUND");
    if (
      !can(data.context, "floor.view", { branchId: floor.branchId }) ||
      !canAccessFloor(data.context, floor)
    )
      throw new ActionError("NOT_FOUND");
    return { ...data, floor };
  }
  async function readBranchNavigation(
    branchId: string,
  ): Promise<BranchNavigationStream> {
    const session = await readSession();
    const current = now();
    const [data, branches] = await Promise.all([
      branchFloors(session, branchId),
      listBranches(db),
    ]);
    const today = localDate(current, data.branch.timezone);
    return {
      meta: {
        branch: data.branch,
        floors: data.floors,
        branches,
        today,
        now: current.toISOString(),
      },
      bookingDates: listMyBranchBookingDates(
        {
          userId: session.userId,
          branchId: data.branch.id,
          today,
          timezone: data.branch.timezone,
        },
        db,
      ),
    };
  }
  async function readMyBookingsMonth(
    input: MyBookingsMonthInput = {},
  ): Promise<MyBookingsMonthStream> {
    const session = await readSession();
    const current = now();
    const branch = await resolveBookingBranch(session.userId, db);
    const timezone = branch?.timezone ?? "Asia/Seoul";
    const selection = normalizeMyBookingsMonth(
      input,
      localDate(current, timezone),
    );
    return {
      meta: { ...selection, now: current.toISOString(), timezone },
      bookings: listMyConfirmedBookingsBetween(
        {
          userId: session.userId,
          ...myBookingsMonthReadRange(selection.month),
        },
        db,
      ).then((rows) =>
        rows
          .map((row) => ({
            ...myBookingDto(row),
            // 소유자·확정 상태를 SQL에서 확인했고 본인 취소는 역할 설정과 무관하다.
            canCancel: row.booking.during.end > current,
          }))
          .filter((booking) => booking.date.slice(0, 7) === selection.month),
      ),
    };
  }
  return {
    async getBranchList(): Promise<BranchListItem[]> {
      const session = await readSession();
      const current = now();
      const [branches, floors, spaceAccess, memberships, roleSettings] =
        await Promise.all([
          listBranchCards(session.userId, db),
          listAllFloorsWithAccess(db),
          listAllSpaceAccess(db),
          getMemberships(session.userId, db),
          getAllRoleSettings(db),
        ]);
      const context: PermissionContext = {
        userId: session.userId,
        ...memberships,
        roleSettings,
      };
      const accessibleFloors = floors.filter(
        (floor) =>
          can(context, "floor.view", { branchId: floor.branchId }) &&
          canAccessFloor(context, floor),
      );
      const allowedIds = spaceAccess
        .filter((space) => {
          const floor = accessibleFloors.find(({ id }) => id === space.floorId);
          return floor && canAccess(context, { ...space, floor });
        })
        .map(({ id }) => id);
      const flags = await listSpaceAvailabilityFlags(allowedIds, current, db);
      return branches
        .map(({ branch, isDefault }) => {
          const branchFloors = accessibleFloors.filter(
            ({ branchId }) => branchId === branch.id,
          );
          const floorIds = new Set(branchFloors.map(({ id }) => id));
          const operatingState = getOperatingState(
            current,
            branch.timezone,
            branch.openHours,
          );
          return {
            ...branchDto(branch),
            isDefault,
            operatingState,
            todayHours: operatingState.hours,
            accessibleFloorCount: branchFloors.length,
            bookableSpaceCount: flags.filter(
              (space) => floorIds.has(space.floorId) && space.bookable,
            ).length,
            freeSpaceCount:
              operatingState.status === "open"
                ? flags.filter(
                    (space) =>
                      floorIds.has(space.floorId) &&
                      space.bookable &&
                      !space.occupied &&
                      !space.blocked,
                  ).length
                : null,
          };
        })
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
    },
    async getBookingEntry(): Promise<string | null> {
      const session = await readSession();
      return (await resolveBookingBranch(session.userId, db))?.id ?? null;
    },
    async getBookingDestination(date?: unknown): Promise<string> {
      const session = await readSession();
      const branch = await resolveBookingBranch(session.userId, db);
      if (!branch) return "/branches";
      const [floors, { context }] = await Promise.all([
        listFloorsWithAccess(branch.id, db),
        loadPermissionData(session, branch.id, db),
      ]);
      const floor = can(context, "floor.view", { branchId: branch.id })
        ? floors.find((floor) => canAccessFloor(context, floor))
        : undefined;
      if (!floor) return `/branches/${branch.id}`;
      const query =
        typeof date === "string" &&
        normalizeBookingDate(date, now(), branch.timezone) === date
          ? `?date=${date}`
          : "";
      return `/branches/${branch.id}/floors/${floor.id}${query}`;
    },
    async getHomeHeader(): Promise<HomeHeaderData> {
      const session = await readSession();
      const current = now();
      const selected = await resolveBookingBranch(session.userId, db);
      const branch = selected ? branchDto(selected) : null;
      return {
        name: session.name,
        now: current.toISOString(),
        date: localDate(current, branch?.timezone ?? "Asia/Seoul"),
        branch,
        operatingState: branch
          ? getOperatingState(current, branch.timezone, branch.openHours)
          : null,
      };
    },
    async getHomeUpcomingBookings(): Promise<HomeUpcomingBookingsData> {
      const session = await readSession();
      const current = now();
      return {
        now: current.toISOString(),
        bookings: (
          await listMyUpcomingBookings(session.userId, current, db)
        ).map((row) => ({
          ...myBookingDto(row),
          canCancel: row.booking.during.end > current,
        })),
      };
    },
    async getHomeWeekBookings(): Promise<HomeWeekBookingsData> {
      const session = await readSession();
      const current = now();
      const branch = await resolveBookingBranch(session.userId, db);
      const timezone = branch?.timezone ?? "Asia/Seoul";
      const today = localDate(current, timezone);
      const days: HomeWeekBookingsData["days"] = Array.from(
        { length: 7 },
        (_, offset) => ({ date: addDays(today, offset), bookings: [] }),
      );
      const byDate = new Map(days.map((day) => [day.date, day.bookings]));
      const rows = await listMyWeekBookings(
        {
          userId: session.userId,
          start: new Date(`${addDays(today, -1)}T00:00:00.000Z`),
          end: new Date(`${addDays(today, 8)}T00:00:00.000Z`),
        },
        db,
      );
      for (const { during, ...booking } of rows) {
        const date = localDate(during.start, booking.timezone);
        byDate.get(date)?.push({
          ...booking,
          start: during.start.toISOString(),
          end: during.end.toISOString(),
          date,
        });
      }
      return {
        now: current.toISOString(),
        today,
        timezone,
        openHours: branch?.openHours ?? null,
        days,
      };
    },
    async getHomeFrequentSpaces(): Promise<HomeFrequentSpacesData> {
      const session = await readSession();
      const current = now();
      const [counts, memberships, roleSettings] = await Promise.all([
        listMySpaceBookingCounts(
          {
            userId: session.userId,
            since: new Date(current.getTime() - 30 * 24 * 60 * 60_000),
          },
          db,
        ),
        getMemberships(session.userId, db),
        getAllRoleSettings(db),
      ]);
      const context: PermissionContext = {
        userId: session.userId,
        ...memberships,
        roleSettings,
      };
      const accessRows = await listFrequentSpaceAccess(
        counts.map(({ spaceId }) => spaceId),
        db,
      );
      const allowedIds = new Set(
        accessRows
          .filter(
            (space) =>
              can(context, "floor.view", { branchId: space.floor.branchId }) &&
              canAccess(context, space),
          )
          .map(({ id }) => id),
      );
      const selected = counts
        .filter(({ spaceId }) => allowedIds.has(spaceId))
        .slice(0, 3);
      const cards = await getFrequentSpaceCards(
        selected.map(({ spaceId }) => spaceId),
        db,
      );
      const byId = new Map(cards.map((card) => [card.id, card]));
      return {
        spaces: selected.flatMap(({ spaceId, bookingCount }) => {
          const card = byId.get(spaceId);
          if (!card) return [];
          const { timezone, ...space } = card;
          return [
            { ...space, bookingCount, date: localDate(current, timezone) },
          ];
        }),
      };
    },
    async getHomeFreeSpaces(): Promise<HomeFreeSpacesData> {
      const session = await readSession();
      const current = now();
      const selected = await resolveBookingBranch(session.userId, db);
      const branch = selected ? branchDto(selected) : null;
      const date = localDate(current, branch?.timezone ?? "Asia/Seoul");
      const operatingState = branch
        ? getOperatingState(current, branch.timezone, branch.openHours)
        : null;
      const empty = {
        branch,
        date,
        now: current.toISOString(),
        operatingState,
        totalCount: 0,
        freeCount: 0,
        spaces: [],
      };
      if (!branch || !operatingState) return { ...empty, state: "no_branch" };
      const [floors, accessRows, { context }] = await Promise.all([
        listFloorsWithAccess(branch.id, db),
        listBranchSpaceAccess(branch.id, db),
        loadPermissionData(session, branch.id, db),
      ]);
      const accessibleFloors = can(context, "floor.view", {
        branchId: branch.id,
      })
        ? floors.filter((floor) => canAccessFloor(context, floor))
        : [];
      if (!accessibleFloors.length) return { ...empty, state: "no_floors" };
      if (operatingState.status !== "open")
        return { ...empty, state: "outside_hours" };
      const allowedIds = accessRows
        .filter((space) => {
          const floor = accessibleFloors.find(({ id }) => id === space.floorId);
          return floor && canAccess(context, { ...space, floor });
        })
        .map(({ id }) => id);
      const during = bookingDayRange(date, branch.timezone);
      const [metadata, bookings, blocks] = await Promise.all([
        getSpacesByIds(allowedIds, db),
        listSpaceBookings(
          { spaceIds: allowedIds, during, summaryOnly: true },
          db,
        ),
        listSpaceBlocks({ spaceIds: allowedIds, during }, db),
      ]);
      const candidates: HomeFreeSpacesData["spaces"] = [];
      for (const space of metadata.filter(({ bookable }) => bookable)) {
        const input = {
          now: current,
          window: operatingState.window,
          userId: session.userId,
          teamIds: context.teams.map(({ teamId }) => teamId),
          bookings: bookings
            .filter(({ spaceId }) => spaceId === space.id)
            .map((booking) => ({
              ...booking.during,
              userId: booking.userId,
              teamId: booking.teamId,
            })),
          blocks: blocks
            .filter(({ spaceId }) => spaceId === space.id)
            .map(({ during }) => during),
        };
        const summary = getAvailabilitySummary(input);
        const floor = accessibleFloors.find(({ id }) => id === space.floorId);
        if (summary.status !== "free" || !floor) continue;
        candidates.push({
          id: space.id,
          name: space.name,
          type: space.type,
          capacity: space.capacity,
          photo: space.photo,
          amenities: space.amenities,
          floor: floorDto(floor),
          intervals: buildAvailabilityIntervals(input),
          freeUntil: summary.until,
        });
      }
      candidates.sort(
        (a, b) =>
          b.freeUntil.localeCompare(a.freeUntil) ||
          a.floor.sortOrder - b.floor.sortOrder ||
          a.floor.level - b.floor.level ||
          a.floor.id.localeCompare(b.floor.id) ||
          a.name.localeCompare(b.name, "ko") ||
          a.id.localeCompare(b.id),
      );
      return {
        ...empty,
        state: "ready",
        totalCount: metadata.filter(({ bookable }) => bookable).length,
        freeCount: candidates.length,
        spaces: candidates.slice(0, 4),
      };
    },
    async getHomeBookingLimits(): Promise<HomeBookingLimitsData | null> {
      const session = await readSession();
      const current = now();
      const branch = await resolveBookingBranch(session.userId, db);
      if (!branch) return null;
      const { context, settings } = await loadPermissionData(
        session,
        branch.id,
        db,
      );
      if (!can(context, "booking.own", { branchId: branch.id })) return null;
      const role = bookingLimitRole(context, branch.id, null);
      const limits = resolveBookingLimits(role, settings[role]?.limits);
      if (limits.maxMinutesPerDay === null) return null;
      const date = localDate(current, branch.timezone);
      const usedMinutes = await sumBookedMinutes(
        {
          branchId: branch.id,
          during: bookingDayRange(date, branch.timezone),
          actor: { userId: session.userId },
        },
        db,
      );
      return {
        branch: { id: branch.id, name: branch.name },
        now: current.toISOString(),
        date,
        limitMinutes: limits.maxMinutesPerDay,
        usedMinutes,
        remainingMinutes: Math.max(0, limits.maxMinutesPerDay - usedMinutes),
      };
    },
    async getBranchFloors(branchId: string): Promise<BranchFloorsData> {
      const data = await branchFloors(await readSession(), branchId);
      return { branch: data.branch, floors: data.floors };
    },
    async getBranchNavigation(branchId: string): Promise<BranchNavigationData> {
      const { meta, bookingDates } = await readBranchNavigation(branchId);
      return { ...meta, bookingDates: await bookingDates };
    },
    getBranchNavigationStream: readBranchNavigation,
    async getFloorDay(
      branchId: string,
      floorId: string,
      value?: unknown,
    ): Promise<FloorDayData> {
      const session = await readSession();
      const current = now();
      const id = validId(floorId);
      const [data, accessRows] = await Promise.all([
        branchFloors(session, branchId),
        listFloorSpaceAccess(id, db),
      ]);
      const { branch, floor, floors, context } = checkedFloor(data, id);
      const date = normalizeBookingDate(value, current, branch.timezone);
      const during = bookingDayRange(date, branch.timezone);
      const allowedIds = accessRows
        .filter((space) => canAccess(context, { ...space, floor }))
        .map(({ id }) => id);
      const [metadata, bookings, blocks, deskSchedule] = await Promise.all([
        getSpacesByIds(allowedIds, db),
        listSpaceBookings(
          { spaceIds: allowedIds, during, summaryOnly: true },
          db,
        ),
        listSpaceBlocks({ spaceIds: allowedIds, during }, db),
        readFloorDeskSchedule({ parentIds: allowedIds, during }, db),
      ]);
      const {
        desks,
        bookings: deskBookings,
        blocks: deskBlocks,
      } = deskSchedule;
      const isToday = date === localDate(current, branch.timezone);
      const operatingState = getOperatingState(
        current,
        branch.timezone,
        branch.openHours,
      );
      const window = getOperatingWindow(
        date,
        branch.timezone,
        branch.openHours,
      );
      const summaries: FloorDayData["spaces"] = [];
      for (const row of accessRows) {
        if (!allowedIds.includes(row.id)) {
          summaries.push({ kind: "restricted", id: row.id, type: row.type });
          continue;
        }
        const space = metadata.find(({ id }) => id === row.id);
        if (!space || space.archivedAt || space.type === "desk") continue;
        const schedule = bookings.filter(({ spaceId }) => spaceId === space.id);
        const areaDesks = desks.filter(({ parentId }) => parentId === space.id);
        const deskSummary =
          space.type === "desk_area" && !space.bookable && areaDesks.length > 0
            ? summarizeDesks({
                desks: areaDesks,
                bookings: deskBookings,
                blocks: deskBlocks,
                parts: createDeskParts({
                  date,
                  timeZone: branch.timezone,
                  openHours: branch.openHours,
                }),
                userId: session.userId,
                now: current,
              })
            : null;
        const availability = {
          window,
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
        };
        summaries.push({
          kind: "accessible",
          id: space.id,
          type: space.type,
          name: space.name,
          capacity: space.capacity,
          photo: space.photo,
          amenities: space.amenities,
          bookable: space.bookable,
          deskCount: areaDesks.length,
          ...(deskSummary
            ? {
                deskParts: deskSummary.parts.filter(
                  ({ part }) => part !== "day",
                ),
              }
            : {}),
          bookingCount: schedule.length,
          intervals: space.bookable
            ? buildAvailabilityIntervals(availability)
            : [],
          summary:
            space.bookable && isToday
              ? getAvailabilitySummary(availability)
              : null,
          status:
            isToday && operatingState.status === "open"
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
          Number(a.kind === "restricted") - Number(b.kind === "restricted") ||
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
        now: current.toISOString(),
        operatingState,
        groups: order.flatMap((type) => {
          const rows = summaries.filter((space) => space.type === type);
          return rows.length
            ? [
                {
                  type,
                  totalCount: rows.length,
                  freeCount:
                    isToday && operatingState.status === "open"
                      ? rows.filter(
                          (space) =>
                            space.kind === "accessible" &&
                            space.bookable &&
                            space.summary?.status === "free",
                        ).length
                      : null,
                },
              ]
            : [];
        }),
        openHours: getOpenHours(branch.openHours, date),
        spaces: summaries,
      };
    },
    async getSpaceDay(
      branchId: string,
      floorId: string,
      spaceId: string,
      value?: unknown,
    ): Promise<SpaceDayData> {
      const session = await readSession();
      const current = now();
      const id = validId(spaceId);
      const parentId = validId(floorId);
      const [data, accessRows] = await Promise.all([
        branchFloors(session, branchId),
        listFloorSpaceAccess(parentId, db),
      ]);
      const { branch, floor, context, settings } = checkedFloor(data, parentId);
      const identity = accessRows.find(({ id: candidate }) => candidate === id);
      if (!identity || !canAccess(context, { ...identity, floor }))
        throw new ActionError("NOT_FOUND");
      const date = normalizeBookingDate(value, current, branch.timezone);
      if (identity.type === "desk_area" && !identity.bookable) {
        return loadDeskDay({
          id,
          branch,
          floor: floorDto(floor),
          identity: { ...identity, floor },
          date,
          current,
          context,
          settings,
          db,
        });
      }
      const during = bookingDayRange(date, branch.timezone);
      const actorIds = availableBookingActors(context, { ...identity, floor });
      const [metadata, bookings, blocks, teams, usage, desks] =
        await Promise.all([
          getSpacesByIds([id], db),
          listSpaceBookings({ spaceIds: [id], during }, db),
          listSpaceBlocks({ spaceIds: [id], during }, db),
          listUserTeamHomeBranches(session.userId, db),
          sumActorBookedMinutes(
            {
              branchId: branch.id,
              during,
              userId: session.userId,
              teamIds: actorIds.filter((teamId) => teamId !== null),
              includePersonal: actorIds.includes(null),
            },
            db,
          ),
          getDeskCounts([id], db),
        ]);
      const space = metadata[0];
      if (!space || space.floorId !== floor.id)
        throw new ActionError("NOT_FOUND");
      const actors = actorIds.map((teamId) => {
        const role = bookingLimitRole(context, branch.id, teamId);
        const limits = resolveBookingLimits(role, settings[role]?.limits);
        const usedMinutes =
          usage.find((row) => row.teamId === teamId)?.minutes ?? 0;
        return {
          teamId,
          name:
            teamId === null
              ? "개인으로"
              : `${teams.find(({ id }) => id === teamId)?.name ?? "팀"}으로`,
          limits,
          remainingMinutes: remainingDailyMinutes(limits, usedMinutes),
        };
      });
      const mine = (booking: { userId: string; teamId: string | null }) =>
        booking.userId === session.userId ||
        context.teams.some(({ teamId }) => teamId === booking.teamId);
      const operatingState = getOperatingState(
        current,
        branch.timezone,
        branch.openHours,
      );
      return {
        branch,
        floor: floorDto(floor),
        desk: null,
        date,
        now: current.toISOString(),
        openHours: getOpenHours(branch.openHours, date),
        actors,
        hasTeams: context.teams.length > 0,
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
          deskCount: desks[0]?.count ?? 0,
          bookingCount: bookings.length,
          status:
            date === localDate(current, branch.timezone) &&
            operatingState.status === "open"
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
            ? { title: booking.title, attendeeCount: booking.attendeeCount }
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
      const current = now();
      const rows = await listMyBookings(session.userId, current, db);
      return {
        now: current.toISOString(),
        upcoming: rows.upcoming.map(myBookingDto),
        past: rows.past.map(myBookingDto),
      };
    },
    async getMyBookingsMonth(
      input: MyBookingsMonthInput = {},
    ): Promise<MyBookingsMonthData> {
      const { meta, bookings } = await readMyBookingsMonth(input);
      return { ...meta, bookings: await bookings };
    },
    getMyBookingsMonthStream: readMyBookingsMonth,
  };
}

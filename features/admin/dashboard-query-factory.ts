import { z } from "zod";
import { readBookingNow } from "@/features/bookings/request-clock";
import { ActionError } from "@/lib/actions/result";
import { requireSession } from "@/lib/auth/session";
import { toAvatar } from "@/lib/avatar";
import {
  listDashboardFloors,
  listDashboardMaintenance,
  listDashboardSpaceScope,
  listDashboardUpcoming,
  readDashboardCards,
  readDashboardUtilization,
} from "@/lib/dal/admin-dashboard";
import { getBranch } from "@/lib/dal/branches";
import { getFloorPlanWithAccess } from "@/lib/dal/floor-plans";
import { floorPlanSchema } from "@/lib/floor-plan/schema";
import { can } from "@/lib/permissions/can";
import { loadPermissionContext } from "@/lib/permissions/context";
import { addDays, localDate, localTime, zonedDateTime } from "@/lib/time/zoned";
import type { AdminQueryDependencies } from "./query-factory";
import type { AdminDashboardData } from "./dashboard-types";
import {
  combinedUtilization,
  dashboardOpenRanges,
  dashboardPeriod,
  normalizeDashboardDate,
  utilizationRatio,
} from "./utilization";

export type AdminDashboardInput = {
  branchId: string;
  date?: unknown;
  range?: unknown;
  floorId?: string | null;
};
function validId(value: string): string {
  const result = z.uuid().safeParse(value);
  if (!result.success) throw new ActionError("NOT_FOUND");
  return result.data.toLowerCase();
}

export function createAdminDashboardQueries(
  dependencies: AdminQueryDependencies = {},
) {
  const db = dependencies.database;
  const readSession = dependencies.requireSession ?? requireSession;
  return {
    async getAdminDashboard(
      input: AdminDashboardInput,
    ): Promise<AdminDashboardData> {
      const session = await readSession();
      const branchId = validId(input.branchId);
      const floorId = input.floorId ? validId(input.floorId) : null;
      const scope = { branchId, floorId, userId: session.userId };
      // 소속·역할 3문장을 포함해 첫 단계는 정확히 6문장이다. 개인/예약 정보와
      // 공간 이름은 stats.view 확인 뒤의 두 번째 단계에서만 읽는다.
      const [branch, context, floors, spaces] = await Promise.all([
        getBranch(branchId, db),
        loadPermissionContext(session, branchId, db),
        listDashboardFloors(scope, db),
        listDashboardSpaceScope(scope, db),
      ]);
      if (!branch || !context.staffBranchIds.includes(branch.id))
        throw new ActionError("NOT_FOUND");
      const selectedFloor = floorId
        ? floors.find((floor) => floor.id === floorId)
        : null;
      if (floorId && !selectedFloor) throw new ActionError("NOT_FOUND");
      if (!can(context, "stats.view", { branchId }))
        throw new ActionError("FORBIDDEN");
      const now = dependencies.now?.() ?? readBookingNow(db !== undefined);
      const today = localDate(now, branch.timezone);
      const date = normalizeDashboardDate(input.date, now, branch.timezone);
      const range =
        input.range === "week" || input.range === "30days"
          ? input.range
          : "day";
      const period = dashboardPeriod(date, range);
      const current = dashboardOpenRanges(
        period.start,
        period.end,
        branch.timezone,
        branch.openHours,
      );
      const previous = dashboardOpenRanges(
        period.previousStart,
        period.previousEnd,
        branch.timezone,
        branch.openHours,
      );
      const maintenanceUntil = zonedDateTime(
        addDays(today, 7),
        localTime(now, branch.timezone),
        branch.timezone,
      );
      maintenanceUntil.setTime(
        maintenanceUntil.getTime() +
          now.getUTCSeconds() * 1000 +
          now.getUTCMilliseconds(),
      );
      const [metrics, cards, upcoming, maintenance, plan] = await Promise.all([
        readDashboardUtilization(
          { scope, spaceIds: spaces.map(({ id }) => id), current, previous },
          db,
        ),
        readDashboardCards(
          scope,
          {
            start: zonedDateTime(date, "00:00", branch.timezone).toISOString(),
            end: zonedDateTime(
              addDays(date, 1),
              "00:00",
              branch.timezone,
            ).toISOString(),
          },
          now,
          db,
        ),
        listDashboardUpcoming(scope, now, db),
        listDashboardMaintenance(scope, now, maintenanceUntil, db),
        selectedFloor?.plan
          ? getFloorPlanWithAccess(selectedFloor.plan.id, db)
          : null,
      ]);
      const measurements = new Map(metrics.map((row) => [row.id, row]));
      const metadata = new Map(spaces.map((space) => [space.id, space]));
      const parentsWithSeats = new Set(
        spaces
          .filter(({ type }) => type === "desk")
          .map(({ parentId }) => parentId),
      );
      const eligible = spaces.filter((space) => {
        if (space.archivedAt || !space.bookable || space.type === "lounge")
          return false;
        if (space.type === "desk_area" && parentsWithSeats.has(space.id))
          return false;
        if (space.type === "desk") {
          const parent = space.parentId ? metadata.get(space.parentId) : null;
          if (!parent || parent.archivedAt) return false;
        }
        return true;
      });
      const eligibleIds = new Set(eligible.map(({ id }) => id));
      const selectedMetrics = (ids: readonly string[]) =>
        ids.flatMap((id) => {
          const value = measurements.get(id);
          return value ? [value] : [];
        });
      const ratios = new Map(
        eligible.map(({ id }) => [
          id,
          measurements.has(id) ? utilizationRatio(measurements.get(id)!) : null,
        ]),
      );
      for (const space of spaces) {
        if (
          space.type !== "desk_area" ||
          space.archivedAt ||
          !parentsWithSeats.has(space.id)
        )
          continue;
        const seats = spaces.filter(
          (seat) => seat.parentId === space.id && eligibleIds.has(seat.id),
        );
        const values = seats.flatMap(({ id }) =>
          ratios.get(id) == null ? [] : [ratios.get(id)!],
        );
        ratios.set(
          space.id,
          values.length
            ? values.reduce((sum, value) => sum + value, 0) / values.length
            : null,
        );
      }
      const meetingIds = eligible
        .filter(
          ({ type }) =>
            type === "meeting_room" ||
            type === "phone_booth" ||
            type === "seminar",
        )
        .map(({ id }) => id);
      const meetings = selectedMetrics(meetingIds);
      return {
        branch: {
          id: branch.id,
          name: branch.name,
          timezone: branch.timezone,
          utilization: combinedUtilization(selectedMetrics([...eligibleIds])),
        },
        now: now.toISOString(),
        date,
        range,
        floorId,
        period,
        isToday: date === today,
        cards: {
          ...cards,
          ongoingCount: date === today ? cards.ongoingCount : null,
          remainingCount: date === today ? cards.remainingCount : null,
          meetingUtilization: combinedUtilization(meetings),
          previousMeetingUtilization: combinedUtilization(
            meetings.map((row) => ({
              bookedMinutes: row.previousBookedMinutes,
              operatingMinutes: row.previousOperatingMinutes,
            })),
          ),
        },
        floors: floors.map((floor) => ({
          id: floor.id,
          name: floor.name,
          level: floor.level,
          utilization: combinedUtilization(
            selectedMetrics(
              eligible
                .filter((space) => space.floorId === floor.id)
                .map(({ id }) => id),
            ),
          ),
        })),
        spaces: spaces
          .filter(({ type }) => type !== "desk")
          .flatMap((space) => {
            const value = measurements.get(space.id);
            return value
              ? [
                  {
                    id: space.id,
                    floorId: space.floorId,
                    name: value.name,
                    type: space.type,
                    utilization: ratios.get(space.id) ?? null,
                  },
                ]
              : [];
          })
          .sort(
            (a, b) =>
              a.name.localeCompare(b.name, "ko") || a.id.localeCompare(b.id),
          ),
        plan:
          selectedFloor?.plan && plan?.branchId === branchId
            ? {
                ...selectedFloor.plan,
                document: floorPlanSchema.parse(plan.document),
              }
            : null,
        upcoming: upcoming.map((row) => ({
          id: row.id,
          start: row.during.start.toISOString(),
          end: row.during.end.toISOString(),
          spaceName: row.spaceName,
          floorName: row.floorName,
          booker: { name: row.bookerName, avatar: toAvatar(row.bookerAvatar) },
          teamName: row.teamName,
          attendeeCount: row.attendeeCount,
        })),
        maintenance: maintenance.map((row) => ({
          id: row.id,
          start: row.during.start.toISOString(),
          end: row.during.end.toISOString(),
          spaceName: row.spaceName,
          floorName: row.floorName,
          reason: row.reason,
          status: row.during.start <= now ? "ongoing" : "upcoming",
        })),
      };
    },
  };
}

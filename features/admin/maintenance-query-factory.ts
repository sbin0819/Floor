import { z } from "zod";
import { readBookingNow } from "@/features/bookings/request-clock";
import { ActionError } from "@/lib/actions/result";
import { requireSession } from "@/lib/auth/session";
import { getMemberships } from "@/lib/dal";
import { getBranch } from "@/lib/dal/branches";
import {
  countActiveMaintenance,
  getMaintenanceSpace,
  getMaintenanceSpacePermissions,
  listMaintenanceOverlaps,
  listMaintenanceRows,
  listMaintenanceSpaces,
} from "@/lib/dal/maintenance-read";
import { can } from "@/lib/permissions/can";
import { loadPermissionContext } from "@/lib/permissions/context";
import { addDays, localDate, zonedDateTime } from "@/lib/time/zoned";
import type { PermissionContext } from "@/lib/permissions/types";
import {
  ensureMaintenanceSpace,
  maintenanceListSchema,
  previewMaintenanceSchema,
  validateMaintenanceWindow,
  type MaintenanceListInput,
  type PreviewMaintenanceInput,
} from "./maintenance-schema";
import type {
  MaintenanceListData,
  MaintenancePreview,
} from "./maintenance-types";
import type { AdminQueryDependencies } from "./query-factory";

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new ActionError("INVALID_INPUT", {
      fieldErrors: z.flattenError(result.error).fieldErrors as Record<
        string,
        string[]
      >,
    });
  return result.data;
}
function requireMaintenancePermission(
  context: PermissionContext,
  branchId: string,
) {
  if (!context.staffBranchIds.includes(branchId))
    throw new ActionError("NOT_FOUND");
  if (!can(context, "space.manage", { branchId }))
    throw new ActionError("FORBIDDEN");
}

export function createMaintenanceQueries(
  dependencies: AdminQueryDependencies = {},
) {
  const db = dependencies.database;
  const readSession = dependencies.requireSession ?? requireSession;
  const readNow = () =>
    dependencies.now?.() ?? readBookingNow(db !== undefined);
  return {
    async getMaintenanceList(
      input: MaintenanceListInput,
    ): Promise<MaintenanceListData> {
      const session = await readSession();
      const { branchId, tab } = parse(maintenanceListSchema, input);
      const now = readNow();
      const [branch, context] = await Promise.all([
        getBranch(branchId, db),
        loadPermissionContext(session, branchId, db),
      ]);
      if (!branch) throw new ActionError("NOT_FOUND");
      requireMaintenancePermission(context, branchId);
      const scope = { branchId, userId: session.userId, now };
      const cutoff = zonedDateTime(
        addDays(localDate(now, branch.timezone), -30),
        "00:00",
        branch.timezone,
      );
      const [rows, activeCount, spaces] = await Promise.all([
        listMaintenanceRows({ ...scope, tab, cutoff }, db),
        countActiveMaintenance(scope, db),
        listMaintenanceSpaces(scope, db),
      ]);
      return {
        branch: { id: branch.id, name: branch.name, timezone: branch.timezone },
        now: now.toISOString(),
        tab,
        activeCount,
        spaces,
        rows: rows.map((row) => ({
          id: row.id,
          space: row.space,
          start: row.during.start.toISOString(),
          end: row.during.end.toISOString(),
          reason: row.reason,
          state:
            row.during.end <= now
              ? "past"
              : row.during.start <= now
                ? "ongoing"
                : "upcoming",
          createdByName: row.createdByName,
        })),
      };
    },
    async previewMaintenance(
      input: PreviewMaintenanceInput,
    ): Promise<MaintenancePreview> {
      const session = await readSession();
      const value = parse(previewMaintenanceSchema, input);
      const now = readNow();
      // 공간 메타데이터와 권한 재료는 병렬로 읽고, can() 확인 뒤에만
      // 예약자 이름을 포함하는 겹침 목록을 읽는다.
      const [row, memberships, roleSettings] = await Promise.all([
        getMaintenanceSpace(value.spaceId, db),
        getMemberships(session.userId, db),
        getMaintenanceSpacePermissions(value.spaceId, db),
      ]);
      if (!row) throw new ActionError("NOT_FOUND");
      requireMaintenancePermission(
        { userId: session.userId, ...memberships, roleSettings },
        row.branch.id,
      );
      ensureMaintenanceSpace(row);
      const during = validateMaintenanceWindow({
        ...value,
        now,
        timeZone: row.branch.timezone,
      });
      const bookings = await listMaintenanceOverlaps(
        {
          spaceId: row.space.id,
          isDeskArea: row.space.type === "desk_area",
          ...during,
          now,
        },
        db,
      );
      return {
        branchId: row.branch.id,
        window: {
          start: during.start.toISOString(),
          end: during.end.toISOString(),
        },
        bookings: bookings.map((booking) => ({
          id: booking.id,
          start: booking.during.start.toISOString(),
          end: booking.during.end.toISOString(),
          bookerName: booking.bookerName,
          teamName: booking.teamName,
          attendeeCount: booking.attendeeCount,
        })),
      };
    },
  };
}

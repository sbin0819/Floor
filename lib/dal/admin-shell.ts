import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { branchStaff, branches, roleSettings } from "@/lib/db/schema";
import { isPermissionKey } from "@/lib/permissions/keys";
import type { PermissionContext } from "@/lib/permissions/types";
import type { DalDatabase } from "./database";
import { openBranchReportSummary } from "./branch-report-scope";
import type { ReportSummary } from "@/features/admin/reports-types";

export async function getOperatorRoleSettings(
  userId: string,
  database: DalDatabase = getDb(),
) {
  const rows = await database
    .select({
      branchId: roleSettings.branchId,
      role: roleSettings.role,
      permissions: roleSettings.permissions,
    })
    .from(roleSettings)
    .innerJoin(
      branchStaff,
      and(
        eq(branchStaff.branchId, roleSettings.branchId),
        eq(branchStaff.userId, userId),
      ),
    );
  const settings: PermissionContext["roleSettings"] = {};
  for (const row of rows)
    (settings[row.branchId] ??= {})[row.role] =
      row.permissions.filter(isPermissionKey);
  return settings;
}

export async function getAdminBranchBadgeCounts(
  {
    maintenanceBranchIds,
    reportBranchIds,
    userId,
    now,
  }: {
    maintenanceBranchIds: readonly string[];
    reportBranchIds: readonly string[];
    userId: string;
    now: Date;
  },
  database: DalDatabase = getDb(),
) {
  const branchIds = [...new Set([...maintenanceBranchIds, ...reportBranchIds])];
  if (!branchIds.length)
    return new Map<
      string,
      { maintenanceCount: number | null; reportSummary: ReportSummary | null }
    >();
  const rows = await database
    .select({
      branchId: branches.id,
      maintenanceCount: maintenanceBranchIds.length
        ? sql<
            number | null
          >`case when ${inArray(branches.id, [...maintenanceBranchIds])} then
        (select count(*)::int from space_blocks badge_block join spaces badge_space on badge_space.id = badge_block.space_id
          join floors badge_floor on badge_floor.id = badge_space.floor_id where badge_floor.branch_id = ${branches.id}
          and badge_block.during @> ${now.toISOString()}::timestamptz) else null end`
        : sql<null>`null`,
      reportSummary: reportBranchIds.length
        ? sql<ReportSummary | null>`case when ${inArray(branches.id, [...reportBranchIds])}
        then ${openBranchReportSummary(sql`${branches.id}`)} else null end`
        : sql<null>`null`,
    })
    .from(branches)
    .innerJoin(
      branchStaff,
      and(
        eq(branchStaff.branchId, branches.id),
        eq(branchStaff.userId, userId),
      ),
    )
    .where(inArray(branches.id, branchIds));
  return new Map(rows.map(({ branchId, ...row }) => [branchId, row]));
}

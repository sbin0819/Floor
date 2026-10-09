import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  branchStaff,
  floors,
  roleSettings,
  spaceBlocks,
  spaces,
} from "@/lib/db/schema";
import { isPermissionKey } from "@/lib/permissions/keys";
import type { PermissionContext } from "@/lib/permissions/types";
import type { DalDatabase } from "./database";

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

export async function getOngoingMaintenanceCounts(
  branchIds: readonly string[],
  now: Date,
  database: DalDatabase = getDb(),
) {
  if (!branchIds.length) return new Map<string, number>();
  const rows = await database
    .select({
      branchId: floors.branchId,
      count: sql<number>`count(*)::integer`,
    })
    .from(spaceBlocks)
    .innerJoin(spaces, eq(spaces.id, spaceBlocks.spaceId))
    .innerJoin(floors, eq(floors.id, spaces.floorId))
    .where(
      and(
        inArray(floors.branchId, [...branchIds]),
        sql`${spaceBlocks.during} @> ${now.toISOString()}::timestamptz`,
      ),
    )
    .groupBy(floors.branchId);
  return new Map(rows.map((row) => [row.branchId, row.count]));
}

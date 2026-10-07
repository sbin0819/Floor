import "server-only";

import { eq } from "drizzle-orm";
import { cache } from "react";

import type { DalDatabase } from "@/lib/dal/database";
import { getDb } from "@/lib/db/client";
import { roleSettings } from "@/lib/db/schema";
import {
  isPermissionKey,
  type PermissionKey,
  type Role,
} from "@/lib/permissions/keys";
import type { RoleLimits } from "@/lib/permissions/types";

export type RoleSettings = Partial<
  Record<Role, { permissions: PermissionKey[]; limits: Partial<RoleLimits> }>
>;

async function readRoleSettings(
  branchId: string,
  database: DalDatabase = getDb(),
): Promise<RoleSettings> {
  const rows = await database
    .select({
      role: roleSettings.role,
      permissions: roleSettings.permissions,
      limits: roleSettings.limits,
    })
    .from(roleSettings)
    .where(eq(roleSettings.branchId, branchId));

  const settings: RoleSettings = {};
  for (const row of rows) {
    settings[row.role] = {
      permissions: row.permissions.filter(isPermissionKey),
      limits: row.limits,
    };
  }
  return settings;
}

const cachedRoleSettings = cache((branchId: string) =>
  readRoleSettings(branchId),
);

export function getRoleSettings(
  branchId: string,
  database?: DalDatabase,
): Promise<RoleSettings> {
  return database === undefined
    ? cachedRoleSettings(branchId)
    : readRoleSettings(branchId, database);
}

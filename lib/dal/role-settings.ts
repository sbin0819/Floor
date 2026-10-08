import "server-only";

import { eq, inArray } from "drizzle-orm";
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

async function readAllRoleSettings(database: DalDatabase = getDb()) {
  const rows = await database
    .select({
      branchId: roleSettings.branchId,
      role: roleSettings.role,
      permissions: roleSettings.permissions,
    })
    .from(roleSettings);
  const result: Record<string, Partial<Record<Role, PermissionKey[]>>> = {};
  for (const row of rows) {
    const branch = (result[row.branchId] ??= {});
    branch[row.role] = row.permissions.filter(isPermissionKey);
  }
  return result;
}
const cachedAllRoleSettings = cache(() => readAllRoleSettings());
export function getAllRoleSettings(database?: DalDatabase) {
  return database === undefined
    ? cachedAllRoleSettings()
    : readAllRoleSettings(database);
}

export async function getRoleSettingsForBranches(
  branchIds: readonly string[],
  database: DalDatabase = getDb(),
) {
  if (!branchIds.length) return {};
  const rows = await database
    .select({
      branchId: roleSettings.branchId,
      role: roleSettings.role,
      permissions: roleSettings.permissions,
    })
    .from(roleSettings)
    .where(inArray(roleSettings.branchId, [...new Set(branchIds)]));
  const result: Record<string, Partial<Record<Role, PermissionKey[]>>> = {};
  for (const row of rows)
    (result[row.branchId] ??= {})[row.role] =
      row.permissions.filter(isPermissionKey);
  return result;
}

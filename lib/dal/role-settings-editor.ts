import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { branches, branchStaff, roleSettings, users } from "@/lib/db/schema";
import type { PermissionKey, Role } from "@/lib/permissions/keys";
import type { RoleLimits } from "@/lib/permissions/types";
import type { DalDatabase } from "./database";

export async function getRoleSettingsBranch(
  branchId: string,
  db: DalDatabase = getDb(),
) {
  const [row] = await db
    .select({
      id: branches.id,
      name: branches.name,
      timezone: branches.timezone,
    })
    .from(branches)
    .where(eq(branches.id, branchId));
  return row ?? null;
}

export async function listRoleSettingsEditorRows(
  branchId: string,
  userId: string,
  db: DalDatabase = getDb(),
) {
  return db
    .select({
      role: roleSettings.role,
      permissions: roleSettings.permissions,
      limits: roleSettings.limits,
      updatedAt:
        sql<Date>`date_trunc('milliseconds', ${roleSettings.updatedAt})`.mapWith(
          roleSettings.updatedAt,
        ),
      updatedByName: users.name,
    })
    .from(roleSettings)
    .innerJoin(
      branchStaff,
      and(
        eq(branchStaff.branchId, roleSettings.branchId),
        eq(branchStaff.userId, userId),
      ),
    )
    .leftJoin(users, eq(users.id, roleSettings.updatedBy))
    .where(eq(roleSettings.branchId, branchId))
    .orderBy(desc(roleSettings.updatedAt), roleSettings.role);
}

export async function lockRoleSettingsBranch(
  branchId: string,
  db: DalDatabase,
) {
  const [row] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.id, branchId))
    .for("no key update");
  return row ?? null;
}

export async function getRoleSettingsVersion(
  branchId: string,
  db: DalDatabase,
) {
  const [row] = await db
    .select({
      updatedAt:
        sql<Date | null>`date_trunc('milliseconds', max(${roleSettings.updatedAt}))`.mapWith(
          roleSettings.updatedAt,
        ),
    })
    .from(roleSettings)
    .where(eq(roleSettings.branchId, branchId));
  return row?.updatedAt ?? null;
}

export async function writeRoleSettings(
  branchId: string,
  values: readonly {
    role: Role;
    permissions: PermissionKey[];
    limits: Partial<RoleLimits>;
  }[],
  userId: string,
  now: Date,
  db: DalDatabase,
) {
  await db
    .insert(roleSettings)
    .values(
      values.map((value) => ({
        branchId,
        ...value,
        updatedBy: userId,
        updatedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [roleSettings.branchId, roleSettings.role],
      set: {
        permissions: sql`excluded.permissions`,
        limits: sql`excluded.limits`,
        updatedBy: userId,
        updatedAt: now,
      },
    });
}

export async function removeRoleSettings(branchId: string, db: DalDatabase) {
  await db.delete(roleSettings).where(eq(roleSettings.branchId, branchId));
}

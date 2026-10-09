import "server-only";

import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db/client";
import {
  bookingParticipants,
  bookings,
  branches,
  branchStaff,
  floors,
  roleSettings,
  spaceBlocks,
  spaces,
  teams,
  users,
} from "@/lib/db/schema";
import { isPermissionKey } from "@/lib/permissions/keys";
import type { PermissionContext } from "@/lib/permissions/types";
import type {
  MaintenanceSpaceType,
  MaintenanceTab,
} from "@/features/admin/maintenance-types";
import type { DalDatabase } from "./database";
import { teamDisplayName } from "./team-name";

const parent = alias(spaces, "maintenance_parent");
export async function getMaintenanceSpace(
  spaceId: string,
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .select({
      space: {
        id: spaces.id,
        floorId: spaces.floorId,
        parentId: spaces.parentId,
        name: spaces.name,
        type: spaces.type,
        archivedAt: spaces.archivedAt,
      },
      parent: {
        id: parent.id,
        floorId: parent.floorId,
        name: parent.name,
        type: parent.type,
        archivedAt: parent.archivedAt,
      },
      floor: { id: floors.id, branchId: floors.branchId, name: floors.name },
      branch: {
        id: branches.id,
        name: branches.name,
        timezone: branches.timezone,
      },
    })
    .from(spaces)
    .innerJoin(floors, eq(floors.id, spaces.floorId))
    .innerJoin(branches, eq(branches.id, floors.branchId))
    .leftJoin(parent, eq(parent.id, spaces.parentId))
    .where(eq(spaces.id, spaceId))
    .limit(1);
  return row ?? null;
}

// 실제 공간의 지점으로 좁히되 공간 메타데이터와 병렬로 읽어,
// 지점 ID를 기다리는 세 번째 조회 단계를 만들지 않는다.
export async function getMaintenanceSpacePermissions(
  spaceId: string,
  database: DalDatabase = getDb(),
): Promise<PermissionContext["roleSettings"]> {
  const rows = await database
    .select({
      branchId: roleSettings.branchId,
      role: roleSettings.role,
      permissions: roleSettings.permissions,
    })
    .from(roleSettings)
    .innerJoin(floors, eq(floors.branchId, roleSettings.branchId))
    .innerJoin(spaces, eq(spaces.floorId, floors.id))
    .where(eq(spaces.id, spaceId));
  const result: PermissionContext["roleSettings"] = {};
  for (const row of rows)
    (result[row.branchId] ??= {})[row.role] =
      row.permissions.filter(isPermissionKey);
  return result;
}

export type MaintenanceOverlapInput = {
  spaceId: string;
  isDeskArea: boolean;
  start: Date;
  end: Date;
  now: Date;
};
export function maintenanceOverlapCondition(input: MaintenanceOverlapInput) {
  return and(
    eq(bookings.status, "confirmed"),
    sql`upper(${bookings.during}) > ${input.now.toISOString()}::timestamptz`,
    sql`${bookings.during} && tstzrange(${input.start.toISOString()}::timestamptz, ${input.end.toISOString()}::timestamptz, '[)')`,
    or(
      eq(spaces.id, input.spaceId),
      input.isDeskArea ? eq(spaces.parentId, input.spaceId) : undefined,
    ),
  );
}
export function listMaintenanceOverlaps(
  input: MaintenanceOverlapInput,
  database: DalDatabase = getDb(),
) {
  return database
    .select({
      id: bookings.id,
      during: bookings.during,
      bookerName: users.name,
      teamName: sql<string | null>`${teamDisplayName(teams)}`,
      attendeeCount: sql<number>`coalesce(${bookings.attendeeCount}, 1 + (select count(*)::int from ${bookingParticipants} where ${bookingParticipants.bookingId} = ${bookings}.id))`,
    })
    .from(bookings)
    .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
    .innerJoin(users, eq(users.id, bookings.userId))
    .leftJoin(teams, eq(teams.id, bookings.teamId))
    .where(maintenanceOverlapCondition(input))
    .orderBy(asc(sql`lower(${bookings.during})`), asc(bookings.id));
}

type BranchScope = { branchId: string; userId: string };
function assigned(scope: BranchScope) {
  return sql`exists(select 1 from ${branchStaff} where ${branchStaff.userId} = ${scope.userId}::uuid and ${branchStaff.branchId} = ${scope.branchId}::uuid)`;
}
export function listMaintenanceSpaces(
  scope: BranchScope,
  database: DalDatabase = getDb(),
) {
  return database
    .select({
      id: spaces.id,
      name: spaces.name,
      floorId: floors.id,
      floorName: floors.name,
      type: sql<MaintenanceSpaceType>`${spaces.type}`,
    })
    .from(spaces)
    .innerJoin(floors, eq(floors.id, spaces.floorId))
    .leftJoin(parent, eq(parent.id, spaces.parentId))
    .where(
      and(
        eq(floors.branchId, scope.branchId),
        assigned(scope),
        isNull(spaces.archivedAt),
        inArray(spaces.type, [
          "meeting_room",
          "phone_booth",
          "seminar",
          "desk_area",
          "desk",
        ]),
        or(
          ne(spaces.type, "desk"),
          and(
            eq(parent.type, "desk_area"),
            isNull(parent.archivedAt),
            eq(parent.floorId, floors.id),
          ),
        ),
      ),
    )
    .orderBy(
      asc(floors.sortOrder),
      asc(floors.level),
      asc(floors.id),
      asc(spaces.name),
      asc(spaces.id),
    );
}
export function listMaintenanceRows(
  input: BranchScope & { tab: MaintenanceTab; now: Date; cutoff: Date },
  database: DalDatabase = getDb(),
) {
  const now = input.now.toISOString();
  return database
    .select({
      id: spaceBlocks.id,
      during: spaceBlocks.during,
      reason: spaceBlocks.reason,
      space: {
        id: spaces.id,
        name: spaces.name,
        floorName: floors.name,
        type: spaces.type,
      },
      createdByName: users.name,
    })
    .from(spaceBlocks)
    .innerJoin(spaces, eq(spaces.id, spaceBlocks.spaceId))
    .innerJoin(floors, eq(floors.id, spaces.floorId))
    .innerJoin(users, eq(users.id, spaceBlocks.createdBy))
    .where(
      and(
        eq(floors.branchId, input.branchId),
        assigned(input),
        input.tab === "active"
          ? sql`upper(${spaceBlocks.during}) > ${now}::timestamptz`
          : sql`upper(${spaceBlocks.during}) <= ${now}::timestamptz and upper(${spaceBlocks.during}) >= ${input.cutoff.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(
      input.tab === "active"
        ? asc(sql`lower(${spaceBlocks.during})`)
        : desc(sql`upper(${spaceBlocks.during})`),
      asc(spaceBlocks.id),
    );
}
export async function countActiveMaintenance(
  input: BranchScope & { now: Date },
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(spaceBlocks)
    .innerJoin(spaces, eq(spaces.id, spaceBlocks.spaceId))
    .innerJoin(floors, eq(floors.id, spaces.floorId))
    .where(
      and(
        eq(floors.branchId, input.branchId),
        assigned(input),
        sql`upper(${spaceBlocks.during}) > ${input.now.toISOString()}::timestamptz`,
      ),
    );
  return row?.count ?? 0;
}

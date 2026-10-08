import "server-only";

import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNotNull,
  isNull,
  max,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DalDatabase } from "@/lib/dal/database";
import { getDb } from "@/lib/db/client";
import {
  accessGrants,
  bookings,
  branches,
  floors,
  spaces,
  teams,
} from "@/lib/db/schema";

type BranchValues = Pick<
  typeof branches.$inferSelect,
  "name" | "address" | "openHours"
>;
type FloorValues = Pick<
  typeof floors.$inferSelect,
  "level" | "name" | "sortOrder"
>;
type SpaceValues = Pick<
  typeof spaces.$inferSelect,
  "name" | "capacity" | "bookable" | "amenities"
>;
type SpaceType = Exclude<typeof spaces.$inferSelect.type, "desk">;
type FloorAccess = typeof floors.$inferSelect.access;
type SpaceAccess = typeof spaces.$inferSelect.access;

export async function updateBranchRecord(
  { branchId, name, address, openHours }: BranchValues & { branchId: string },
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .update(branches)
    .set({ name, address, openHours })
    .where(eq(branches.id, branchId))
    .returning();
  return row ?? null;
}

export async function insertFloor(
  { branchId, level, name, sortOrder }: FloorValues & { branchId: string },
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .insert(floors)
    .values({ branchId, level, name, sortOrder })
    .returning();
  if (!row) throw new Error("Floor insertion returned no row.");
  return row;
}

export async function updateFloorRecord(
  { floorId, level, name, sortOrder }: FloorValues & { floorId: string },
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .update(floors)
    .set({ level, name, sortOrder })
    .where(eq(floors.id, floorId))
    .returning();
  return row ?? null;
}

export async function maxFloorSortOrder(
  branchId: string,
  database: DalDatabase = getDb(),
): Promise<number | null> {
  const [row] = await database
    .select({ value: max(floors.sortOrder) })
    .from(floors)
    .where(eq(floors.branchId, branchId));
  return row?.value ?? null;
}

export async function insertSpace(
  {
    floorId,
    type,
    name,
    capacity,
    bookable,
    amenities,
  }: SpaceValues & { floorId: string; type: SpaceType },
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .insert(spaces)
    .values({ floorId, type, name, capacity, bookable, amenities })
    .returning();
  if (!row) throw new Error("Space insertion returned no row.");
  return row;
}

export async function updateSpaceRecord(
  {
    spaceId,
    name,
    capacity,
    bookable,
    amenities,
  }: SpaceValues & { spaceId: string },
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .update(spaces)
    .set({ name, capacity, bookable, amenities })
    .where(eq(spaces.id, spaceId))
    .returning();
  return row ?? null;
}

export async function archiveSpaceRecord(
  spaceId: string,
  now: Date,
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .update(spaces)
    .set({ archivedAt: now })
    .where(and(eq(spaces.id, spaceId), isNull(spaces.archivedAt)))
    .returning();
  return row ?? null;
}

export async function restoreSpaceRecord(
  spaceId: string,
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .update(spaces)
    .set({ archivedAt: null })
    .where(and(eq(spaces.id, spaceId), isNotNull(spaces.archivedAt)))
    .returning();
  return row ?? null;
}

export async function listAdminSpaces(
  {
    floorId,
    includeArchived = false,
    includeDesks = false,
  }: { floorId: string; includeArchived?: boolean; includeDesks?: boolean },
  database: DalDatabase = getDb(),
) {
  const rows = await database
    .select()
    .from(spaces)
    .where(
      and(
        eq(spaces.floorId, floorId),
        includeArchived ? undefined : isNull(spaces.archivedAt),
        includeDesks ? undefined : ne(spaces.type, "desk"),
      ),
    )
    .orderBy(asc(spaces.name), asc(spaces.id));
  const grants = rows.length
    ? await database
        .select({ spaceId: accessGrants.targetId, teamId: accessGrants.teamId })
        .from(accessGrants)
        .where(
          and(
            eq(accessGrants.targetType, "space"),
            inArray(
              accessGrants.targetId,
              rows.map(({ id }) => id),
            ),
          ),
        )
        .orderBy(asc(accessGrants.teamId))
    : [];
  return rows.map((row) => ({
    ...row,
    allowedTeamIds: grants
      .filter(({ spaceId }) => spaceId === row.id)
      .map(({ teamId }) => teamId),
  }));
}

export async function countActiveBookings(
  spaceId: string,
  now: Date,
  database: DalDatabase = getDb(),
): Promise<number> {
  const [row] = await database
    .select({ value: count() })
    .from(bookings)
    .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
    .where(
      and(
        or(
          eq(bookings.spaceId, spaceId),
          and(eq(spaces.type, "desk"), eq(spaces.parentId, spaceId)),
        ),
        eq(bookings.status, "confirmed"),
        sql`upper(${bookings.during}) > ${now.toISOString()}::timestamptz`,
      ),
    );
  return row?.value ?? 0;
}

export function countActiveSpacesByFloor(
  branchId: string,
  database: DalDatabase = getDb(),
) {
  return database
    .select({ floorId: spaces.floorId, count: count() })
    .from(spaces)
    .innerJoin(floors, eq(spaces.floorId, floors.id))
    .where(
      and(
        eq(floors.branchId, branchId),
        isNull(spaces.archivedAt),
        ne(spaces.type, "desk"),
      ),
    )
    .groupBy(spaces.floorId);
}

export async function listAdminSpaceDetails(
  floorId: string,
  database: DalDatabase = getDb(),
) {
  const desks = alias(spaces, "admin_desks");
  const deskCount = database
    .select({ count: count() })
    .from(desks)
    .where(
      and(
        eq(desks.parentId, spaces.id),
        eq(desks.type, "desk"),
        isNull(desks.archivedAt),
      ),
    );
  const rows = await database
    .select({
      space: {
        id: spaces.id,
        floorId: spaces.floorId,
        name: spaces.name,
        type: spaces.type,
        capacity: spaces.capacity,
        bookable: spaces.bookable,
        amenities: spaces.amenities,
        access: spaces.access,
        archivedAt: spaces.archivedAt,
      },
      team: { id: teams.id, name: teams.name },
      deskCount: sql<number>`(${deskCount})`.mapWith(Number),
    })
    .from(spaces)
    .leftJoin(
      accessGrants,
      and(
        eq(accessGrants.targetType, "space"),
        eq(accessGrants.targetId, spaces.id),
      ),
    )
    .leftJoin(teams, eq(teams.id, accessGrants.teamId))
    .where(and(eq(spaces.floorId, floorId), ne(spaces.type, "desk")))
    .orderBy(asc(spaces.name), asc(spaces.id), asc(teams.name), asc(teams.id));
  const grouped = new Map<
    string,
    (typeof rows)[number]["space"] & {
      allowedTeams: { id: string; name: string }[];
      deskCount: number;
    }
  >();
  for (const row of rows) {
    let space = grouped.get(row.space.id);
    if (!space) {
      space = { ...row.space, allowedTeams: [], deskCount: row.deskCount };
      grouped.set(space.id, space);
    }
    if (row.team) space.allowedTeams.push(row.team);
  }
  return [...grouped.values()];
}

export async function setFloorAccessRecord(
  floorId: string,
  access: FloorAccess,
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .update(floors)
    .set({ access })
    .where(eq(floors.id, floorId))
    .returning();
  return row ?? null;
}

export async function setSpaceAccessRecord(
  spaceId: string,
  access: SpaceAccess,
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .update(spaces)
    .set({ access })
    .where(eq(spaces.id, spaceId))
    .returning();
  return row ?? null;
}

export async function replaceAccessGrants(
  {
    targetType,
    targetId,
    teamIds,
  }: {
    targetType: typeof accessGrants.$inferSelect.targetType;
    targetId: string;
    teamIds: string[];
  },
  database: DalDatabase = getDb(),
): Promise<void> {
  const ids = [...new Set(teamIds.map((id) => id.toLowerCase()))].sort();
  // 대상 행 잠금과 이 두 쓰기를 호출자의 트랜잭션 안에서 묶어야 한다.
  await database
    .delete(accessGrants)
    .where(
      and(
        eq(accessGrants.targetType, targetType),
        eq(accessGrants.targetId, targetId),
        ids.length ? notInArray(accessGrants.teamId, ids) : undefined,
      ),
    );
  if (ids.length)
    await database
      .insert(accessGrants)
      .values(ids.map((teamId) => ({ targetType, targetId, teamId })))
      .onConflictDoNothing({
        target: [
          accessGrants.targetType,
          accessGrants.targetId,
          accessGrants.teamId,
        ],
      });
}

export async function getTeamsByIds(
  ids: string[],
  database: DalDatabase = getDb(),
): Promise<{ id: string; name: string }[]> {
  if (ids.length === 0) return [];
  return database
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(inArray(teams.id, ids))
    .orderBy(asc(teams.name), asc(teams.id));
}

export async function lockAdminFloor(
  floorId: string,
  mode: "update" | "share",
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .select()
    .from(floors)
    .where(eq(floors.id, floorId))
    .for(mode);
  return row ?? null;
}

export async function lockAdminSpace(
  spaceId: string,
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .select()
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .for("update");
  return row ?? null;
}

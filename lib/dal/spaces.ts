import "server-only";

import {
  and,
  asc,
  count,
  eq,
  getTableColumns,
  inArray,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { cache } from "react";

import type { DalDatabase } from "@/lib/dal/database";
import { getDb } from "@/lib/db/client";
import { accessGrants, floors, spaces, spacePhotos } from "@/lib/db/schema";
import type { Photo } from "@/lib/photos/schema";

async function readSpaceAccess(
  filter: SQL | undefined,
  database: DalDatabase = getDb(),
) {
  const rows = await database
    .select({
      space: {
        id: spaces.id,
        floorId: spaces.floorId,
        type: spaces.type,
        bookable: spaces.bookable,
        access: spaces.access,
      },
      teamId: accessGrants.teamId,
    })
    .from(spaces)
    .innerJoin(floors, eq(floors.id, spaces.floorId))
    .leftJoin(
      accessGrants,
      and(
        eq(accessGrants.targetType, "space"),
        eq(accessGrants.targetId, spaces.id),
      ),
    )
    .where(and(filter, isNull(spaces.archivedAt), ne(spaces.type, "desk")))
    .orderBy(asc(spaces.id), asc(accessGrants.teamId));
  const grouped = new Map<
    string,
    (typeof rows)[number]["space"] & { allowedTeamIds: string[] }
  >();
  for (const { space, teamId } of rows) {
    let result = grouped.get(space.id);
    if (!result) {
      result = { ...space, allowedTeamIds: [] };
      grouped.set(space.id, result);
    }
    if (teamId !== null) result.allowedTeamIds.push(teamId);
  }
  return [...grouped.values()];
}

async function readFloorSpaceAccess(floorId: string, database?: DalDatabase) {
  return (await readSpaceAccess(eq(spaces.floorId, floorId), database)).map(
    ({ id, type, bookable, access, allowedTeamIds }) => ({
      id,
      type,
      bookable,
      access,
      allowedTeamIds,
    }),
  );
}
async function readBranchSpaceAccess(branchId: string, database?: DalDatabase) {
  return readSpaceAccess(eq(floors.branchId, branchId), database);
}
const cachedBranchSpaceAccess = cache((branchId: string) =>
  readBranchSpaceAccess(branchId),
);
const cachedAllSpaceAccess = cache(() => readSpaceAccess(undefined));
export function listBranchSpaceAccess(
  branchId: string,
  database?: DalDatabase,
) {
  return database === undefined
    ? cachedBranchSpaceAccess(branchId)
    : readBranchSpaceAccess(branchId, database);
}
export function listAllSpaceAccess(database?: DalDatabase) {
  return database === undefined
    ? cachedAllSpaceAccess()
    : readSpaceAccess(undefined, database);
}

const cachedFloorSpaceAccess = cache((floorId: string) =>
  readFloorSpaceAccess(floorId),
);

export function listFloorSpaceAccess(floorId: string, database?: DalDatabase) {
  return database === undefined
    ? cachedFloorSpaceAccess(floorId)
    : readFloorSpaceAccess(floorId, database);
}

export async function getSpacesByIds(
  spaceIds: string[],
  database: DalDatabase = getDb(),
) {
  if (spaceIds.length === 0) return [];
  return database
    .select({
      ...getTableColumns(spaces),
      photo: sql<Photo | null>`(json_agg(json_build_object('path', ${spacePhotos.path}, 'alt', ${spacePhotos.alt})) filter (where ${spacePhotos.sortOrder} = 0)) -> 0`,
      photos: sql<
        Photo[]
      >`coalesce(json_agg(json_build_object('path', ${spacePhotos.path}, 'alt', ${spacePhotos.alt}) order by ${spacePhotos.sortOrder}) filter (where ${spacePhotos.id} is not null), '[]'::json)`,
    })
    .from(spaces)
    .leftJoin(spacePhotos, eq(spacePhotos.spaceId, spaces.id))
    .where(
      and(
        inArray(spaces.id, spaceIds),
        isNull(spaces.archivedAt),
        ne(spaces.type, "desk"),
      ),
    )
    .groupBy(spaces.id)
    .orderBy(asc(spaces.name), asc(spaces.id));
}

export async function getDeskCounts(
  parentIds: string[],
  database: DalDatabase = getDb(),
) {
  if (parentIds.length === 0) return [];
  const rows = await database
    .select({ parentId: spaces.parentId, count: count() })
    .from(spaces)
    .where(
      and(
        inArray(spaces.parentId, parentIds),
        eq(spaces.type, "desk"),
        isNull(spaces.archivedAt),
      ),
    )
    .groupBy(spaces.parentId);
  return rows.flatMap((row) =>
    row.parentId === null ? [] : [{ parentId: row.parentId, count: row.count }],
  );
}

export async function getSpaceForAccess(
  spaceId: string,
  database: DalDatabase = getDb(),
) {
  const [record] = await database
    .select({ space: spaces, floor: floors })
    .from(spaces)
    .innerJoin(floors, eq(spaces.floorId, floors.id))
    .where(eq(spaces.id, spaceId))
    .limit(1);
  if (!record) return null;

  const grants = await database
    .select({
      targetType: accessGrants.targetType,
      teamId: accessGrants.teamId,
    })
    .from(accessGrants)
    .where(
      or(
        and(
          eq(accessGrants.targetType, "floor"),
          eq(accessGrants.targetId, record.floor.id),
        ),
        and(
          eq(accessGrants.targetType, "space"),
          eq(accessGrants.targetId, record.space.id),
        ),
      ),
    );

  return {
    ...record.space,
    allowedTeamIds: grants
      .filter((grant) => grant.targetType === "space")
      .map((grant) => grant.teamId),
    floor: {
      ...record.floor,
      allowedTeamIds: grants
        .filter((grant) => grant.targetType === "floor")
        .map((grant) => grant.teamId),
    },
  };
}

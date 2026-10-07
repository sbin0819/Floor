import "server-only";

import { and, asc, eq, exists, inArray, isNull, ne, sql } from "drizzle-orm";
import { cache } from "react";
import type { DalDatabase } from "@/lib/dal/database";
import { getDb } from "@/lib/db/client";
import {
  bookings,
  branches,
  spaceBlocks,
  spaces,
  teamMembers,
  teams,
  users,
} from "@/lib/db/schema";

async function readBookingBranch(
  userId: string,
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .select({ branch: branches })
    .from(users)
    .leftJoin(
      branches,
      sql`${branches.id} = coalesce(${users.defaultBranchId}, (
      select ${teams.homeBranchId} from ${teamMembers}
      inner join ${teams} on ${teams.id} = ${teamMembers.teamId}
      where ${teamMembers.userId} = ${userId} and ${teams.homeBranchId} is not null
      order by ${teams.name}, ${teams.id} limit 1
    ))`,
    )
    .where(eq(users.id, userId))
    .limit(1);
  return row?.branch ?? null;
}
const cachedBookingBranch = cache((userId: string) =>
  readBookingBranch(userId),
);
export function resolveBookingBranch(userId: string, database?: DalDatabase) {
  return database === undefined
    ? cachedBookingBranch(userId)
    : readBookingBranch(userId, database);
}

async function readBranchCards(
  userId: string,
  database: DalDatabase = getDb(),
) {
  return database
    .select({
      branch: branches,
      isDefault: sql<boolean>`${users.id} is not null`,
    })
    .from(branches)
    .leftJoin(
      users,
      and(eq(users.id, userId), eq(users.defaultBranchId, branches.id)),
    )
    .orderBy(asc(branches.name), asc(branches.id));
}
const cachedBranchCards = cache((userId: string) => readBranchCards(userId));
export function listBranchCards(userId: string, database?: DalDatabase) {
  return database === undefined
    ? cachedBranchCards(userId)
    : readBranchCards(userId, database);
}

export async function listSpaceAvailabilityFlags(
  spaceIds: string[],
  now: Date,
  database: DalDatabase = getDb(),
) {
  if (!spaceIds.length) return [];
  const instant = now.toISOString();
  return database
    .select({
      id: spaces.id,
      floorId: spaces.floorId,
      bookable: spaces.bookable,
      occupied: exists(
        database
          .select({ id: bookings.id })
          .from(bookings)
          .where(
            and(
              eq(bookings.spaceId, spaces.id),
              eq(bookings.status, "confirmed"),
              sql`lower(${bookings.during}) <= ${instant}::timestamptz`,
              sql`upper(${bookings.during}) > ${instant}::timestamptz`,
            ),
          ),
      ),
      blocked: exists(
        database
          .select({ id: spaceBlocks.id })
          .from(spaceBlocks)
          .where(
            and(
              eq(spaceBlocks.spaceId, spaces.id),
              sql`lower(${spaceBlocks.during}) <= ${instant}::timestamptz`,
              sql`upper(${spaceBlocks.during}) > ${instant}::timestamptz`,
            ),
          ),
      ),
    })
    .from(spaces)
    .where(
      and(
        inArray(spaces.id, spaceIds),
        isNull(spaces.archivedAt),
        ne(spaces.type, "desk"),
      ),
    );
}

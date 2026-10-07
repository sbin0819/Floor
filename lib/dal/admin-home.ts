import "server-only";

import { and, asc, count, countDistinct, eq, isNull, ne } from "drizzle-orm";
import { cache } from "react";
import type { DalDatabase } from "@/lib/dal/database";
import { getDb } from "@/lib/db/client";
import { branches, branchStaff, floors, spaces } from "@/lib/db/schema";

async function readOperatorBranchSummaries(
  userId: string,
  database: DalDatabase = getDb(),
) {
  return database
    .select({
      id: branches.id,
      name: branches.name,
      address: branches.address,
      timezone: branches.timezone,
      openHours: branches.openHours,
      floorCount: countDistinct(floors.id),
      spaceCount: count(spaces.id),
    })
    .from(branchStaff)
    .innerJoin(branches, eq(branches.id, branchStaff.branchId))
    .leftJoin(floors, eq(floors.branchId, branches.id))
    .leftJoin(
      spaces,
      and(
        eq(spaces.floorId, floors.id),
        isNull(spaces.archivedAt),
        ne(spaces.type, "desk"),
      ),
    )
    .where(eq(branchStaff.userId, userId))
    .groupBy(branches.id)
    .orderBy(asc(branches.name), asc(branches.id));
}

const cachedOperatorBranchSummaries = cache((userId: string) =>
  readOperatorBranchSummaries(userId),
);

export function listOperatorBranchSummaries(
  userId: string,
  database?: DalDatabase,
) {
  return database === undefined
    ? cachedOperatorBranchSummaries(userId)
    : readOperatorBranchSummaries(userId, database);
}

import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { cache } from "react";
import type { DalDatabase } from "@/lib/dal/database";
import { getDb } from "@/lib/db/client";
import { accessGrants, branches, branchStaff, floors } from "@/lib/db/schema";

async function readBranchDetails(database: DalDatabase = getDb()) {
  return database
    .select()
    .from(branches)
    .orderBy(asc(branches.name), asc(branches.id));
}

const cachedBranchDetails = cache(() => readBranchDetails());

export function listBranchDetails(database?: DalDatabase) {
  return database === undefined
    ? cachedBranchDetails()
    : readBranchDetails(database);
}

async function readBranch(branchId: string, database: DalDatabase = getDb()) {
  const [branch] = await database
    .select()
    .from(branches)
    .where(eq(branches.id, branchId))
    .limit(1);
  return branch ?? null;
}

const cachedBranch = cache((branchId: string) => readBranch(branchId));

export function getBranch(branchId: string, database?: DalDatabase) {
  return database === undefined
    ? cachedBranch(branchId)
    : readBranch(branchId, database);
}

async function floorGrants(floorIds: string[], database: DalDatabase) {
  if (floorIds.length === 0) return [];
  return database
    .select({ floorId: accessGrants.targetId, teamId: accessGrants.teamId })
    .from(accessGrants)
    .where(
      and(
        eq(accessGrants.targetType, "floor"),
        inArray(accessGrants.targetId, floorIds),
      ),
    )
    .orderBy(asc(accessGrants.teamId));
}

async function readFloorWithAccess(
  floorId: string,
  database: DalDatabase = getDb(),
) {
  const [floor] = await database
    .select()
    .from(floors)
    .where(eq(floors.id, floorId))
    .limit(1);
  if (!floor) return null;
  const grants = await floorGrants([floor.id], database);
  return { ...floor, allowedTeamIds: grants.map((grant) => grant.teamId) };
}

const cachedFloorWithAccess = cache((floorId: string) =>
  readFloorWithAccess(floorId),
);

export function getFloorWithAccess(floorId: string, database?: DalDatabase) {
  return database === undefined
    ? cachedFloorWithAccess(floorId)
    : readFloorWithAccess(floorId, database);
}

async function readFloorsWithAccess(
  branchId: string,
  database: DalDatabase = getDb(),
) {
  const rows = await database
    .select()
    .from(floors)
    .where(eq(floors.branchId, branchId))
    .orderBy(asc(floors.sortOrder), asc(floors.level), asc(floors.id));
  const grants = await floorGrants(
    rows.map((row) => row.id),
    database,
  );
  return rows.map((floor) => ({
    ...floor,
    allowedTeamIds: grants
      .filter((grant) => grant.floorId === floor.id)
      .map((grant) => grant.teamId),
  }));
}

const cachedFloorsWithAccess = cache((branchId: string) =>
  readFloorsWithAccess(branchId),
);

export function listFloorsWithAccess(branchId: string, database?: DalDatabase) {
  return database === undefined
    ? cachedFloorsWithAccess(branchId)
    : readFloorsWithAccess(branchId, database);
}

async function readBranches(database: DalDatabase = getDb()) {
  return database
    .select({ id: branches.id, name: branches.name })
    .from(branches)
    .orderBy(asc(branches.name), asc(branches.id));
}

const cachedBranches = cache(() => readBranches());

export function listBranches(database?: DalDatabase) {
  return database === undefined ? cachedBranches() : readBranches(database);
}

async function readOperatorBranches(
  userId: string,
  database: DalDatabase = getDb(),
): Promise<{ id: string; name: string }[]> {
  return database
    .select({ id: branches.id, name: branches.name })
    .from(branchStaff)
    .innerJoin(branches, eq(branchStaff.branchId, branches.id))
    .where(eq(branchStaff.userId, userId))
    .orderBy(asc(branches.name), asc(branches.id));
}

const cachedOperatorBranches = cache((userId: string) =>
  readOperatorBranches(userId),
);

export function getOperatorBranches(
  userId: string,
  database?: DalDatabase,
): Promise<{ id: string; name: string }[]> {
  return database === undefined
    ? cachedOperatorBranches(userId)
    : readOperatorBranches(userId, database);
}

export async function getBranchesByName(
  name: string,
  database: DalDatabase = getDb(),
) {
  return database
    .select({ id: branches.id, name: branches.name })
    .from(branches)
    .where(eq(branches.name, name))
    .limit(2);
}

export async function createBranch(
  name: string,
  database: DalDatabase = getDb(),
) {
  const [branch] = await database
    .insert(branches)
    .values({ name })
    .returning({ id: branches.id, name: branches.name });
  if (!branch) throw new Error("Failed to create the requested branch.");
  return branch;
}

export async function addBranchStaff(
  input: { branchId: string; userId: string },
  database: DalDatabase = getDb(),
): Promise<void> {
  await database
    .insert(branchStaff)
    .values(input)
    .onConflictDoNothing({
      target: [branchStaff.branchId, branchStaff.userId],
    });
}

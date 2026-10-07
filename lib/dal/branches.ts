import "server-only";

import { and, asc, eq } from "drizzle-orm";
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

function floorAccessQuery(database: DalDatabase) {
  return database
    .select({ floor: floors, teamId: accessGrants.teamId })
    .from(floors)
    .leftJoin(
      accessGrants,
      and(
        eq(accessGrants.targetType, "floor"),
        eq(accessGrants.targetId, floors.id),
      ),
    );
}

function groupFloorAccess(
  rows: {
    floor: typeof floors.$inferSelect;
    teamId: string | null;
  }[],
) {
  const grouped = new Map<
    string,
    typeof floors.$inferSelect & { allowedTeamIds: string[] }
  >();
  for (const { floor, teamId } of rows) {
    let result = grouped.get(floor.id);
    if (!result) {
      result = { ...floor, allowedTeamIds: [] };
      grouped.set(floor.id, result);
    }
    if (teamId !== null) result.allowedTeamIds.push(teamId);
  }
  return [...grouped.values()];
}

async function readFloorWithAccess(
  floorId: string,
  database: DalDatabase = getDb(),
) {
  const rows = await floorAccessQuery(database)
    .where(eq(floors.id, floorId))
    .orderBy(asc(accessGrants.teamId));
  return groupFloorAccess(rows)[0] ?? null;
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
  const rows = await floorAccessQuery(database)
    .where(eq(floors.branchId, branchId))
    .orderBy(
      asc(floors.sortOrder),
      asc(floors.level),
      asc(floors.id),
      asc(accessGrants.teamId),
    );
  return groupFloorAccess(rows);
}

const cachedFloorsWithAccess = cache((branchId: string) =>
  readFloorsWithAccess(branchId),
);

async function readAllFloorsWithAccess(database: DalDatabase = getDb()) {
  return groupFloorAccess(
    await floorAccessQuery(database).orderBy(
      asc(floors.branchId),
      asc(floors.sortOrder),
      asc(floors.level),
      asc(floors.id),
      asc(accessGrants.teamId),
    ),
  );
}
const cachedAllFloorsWithAccess = cache(() => readAllFloorsWithAccess());
export function listAllFloorsWithAccess(database?: DalDatabase) {
  return database === undefined
    ? cachedAllFloorsWithAccess()
    : readAllFloorsWithAccess(database);
}

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

import "server-only";

import { asc, eq } from "drizzle-orm";
import type { DalDatabase } from "@/lib/dal/database";
import { getDb } from "@/lib/db/client";
import { branches, branchStaff } from "@/lib/db/schema";

export function listBranches(database: DalDatabase = getDb()) {
  return database
    .select({ id: branches.id, name: branches.name })
    .from(branches)
    .orderBy(asc(branches.name), asc(branches.id));
}

export async function getOperatorBranches(
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

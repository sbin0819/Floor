import "server-only";

import { eq } from "drizzle-orm";

import type { DalDatabase } from "@/lib/dal/database";
import { getDb } from "@/lib/db/client";
import { branchStaff, teamMembers, users } from "@/lib/db/schema";

export async function getUserById(id: string, database: DalDatabase = getDb()) {
  const [user] = await database
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return user ?? null;
}

export async function getMemberships(
  userId: string,
  database: DalDatabase = getDb(),
) {
  const [teams, staff] = await Promise.all([
    database
      .select({ teamId: teamMembers.teamId, role: teamMembers.role })
      .from(teamMembers)
      .where(eq(teamMembers.userId, userId)),
    database
      .select({ branchId: branchStaff.branchId })
      .from(branchStaff)
      .where(eq(branchStaff.userId, userId)),
  ]);
  return { teams, staffBranchIds: staff.map(({ branchId }) => branchId) };
}

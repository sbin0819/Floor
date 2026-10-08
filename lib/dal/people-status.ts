import "server-only";

import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import type { UserStatus } from "@/features/people/status";
import type { DalDatabase } from "./database";
import { avatarColumns } from "./avatar";

export async function saveUserStatus(
  userId: string,
  status: UserStatus,
  now: Date,
  database: DalDatabase,
) {
  const [row] = await database
    .update(users)
    .set({ status, updatedAt: now })
    .where(eq(users.id, userId))
    .returning({ status: users.status });
  return row ?? null;
}

export async function readAccountMenu(
  userId: string,
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .select({
      name: users.name,
      avatar: avatarColumns(users),
      myStatus: users.status,
      username: users.username,
      isOperator: sql<boolean>`exists (select 1 from branch_staff o where o.user_id = ${userId}::uuid)`,
    })
    .from(users)
    .where(eq(users.id, userId));
  return row ?? null;
}

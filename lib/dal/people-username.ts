import "server-only";

import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import type { DalDatabase } from "./database";

const usernameFields = {
  username: users.username,
  usernameChangedAt: users.usernameChangedAt,
};
export async function readUsername(
  userId: string,
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .select(usernameFields)
    .from(users)
    .where(eq(users.id, userId));
  return row ?? null;
}
export async function lockUsername(userId: string, database: DalDatabase) {
  const [row] = await database
    .select(usernameFields)
    .from(users)
    .where(eq(users.id, userId))
    .for("update");
  return row ?? null;
}
export async function listTakenUsernames(
  candidates: readonly string[],
  database: DalDatabase = getDb(),
) {
  const rows = await database
    .select({ username: users.username })
    .from(users)
    .where(sql`${users.username} = any(${sql.param([...candidates])}::text[])`);
  return new Set(
    rows.flatMap(({ username }) => (username === null ? [] : [username])),
  );
}
export async function saveUsername(
  userId: string,
  username: string,
  changedAt: Date | null,
  now: Date,
  database: DalDatabase,
) {
  await database
    .update(users)
    .set({ username, usernameChangedAt: changedAt, updatedAt: now })
    .where(eq(users.id, userId));
}

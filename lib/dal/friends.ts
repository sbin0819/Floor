import "server-only";

import { and, count, eq, gt, not, sql } from "drizzle-orm";
import { friendships } from "@/lib/db/schema";
import type { DalDatabase } from "./database";
import { friendPairCondition } from "./people-write";
import { FRIEND_DAY_MS } from "@/lib/people/friendship";

export type FriendshipRow = typeof friendships.$inferSelect;

export async function countRecentFriendRequests(
  me: string,
  other: string,
  now: Date,
  database: DalDatabase,
) {
  const [row] = await database
    .select({ count: count() })
    .from(friendships)
    .where(
      and(
        eq(friendships.requestedBy, me),
        gt(friendships.requestedAt, new Date(now.getTime() - FRIEND_DAY_MS)),
        not(friendPairCondition(me, other)!),
      ),
    );
  return row?.count ?? 0;
}

export async function insertFriendRequest(
  me: string,
  other: string,
  now: Date,
  database: DalDatabase,
) {
  const [row] = await database
    .insert(friendships)
    .values({
      userLowId: sql`least(${me}::uuid, ${other}::uuid)`,
      userHighId: sql`greatest(${me}::uuid, ${other}::uuid)`,
      requestedBy: me,
      requestedAt: now,
      statusChangedAt: now,
      status: "pending",
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning();
  return row ?? null;
}

function expectedState(row: FriendshipRow) {
  return and(
    eq(friendships.userLowId, row.userLowId),
    eq(friendships.userHighId, row.userHighId),
    eq(friendships.status, row.status),
    eq(friendships.requestedBy, row.requestedBy),
    eq(friendships.statusChangedAt, row.statusChangedAt),
  );
}

export async function changeFriendship(
  row: FriendshipRow,
  values: Pick<FriendshipRow, "status" | "statusChangedAt"> &
    Partial<Pick<FriendshipRow, "requestedBy" | "requestedAt">>,
  database: DalDatabase,
) {
  const [changed] = await database
    .update(friendships)
    .set(values)
    .where(expectedState(row))
    .returning();
  return changed ?? null;
}

export async function deleteFriendship(
  row: FriendshipRow,
  database: DalDatabase,
) {
  const [removed] = await database
    .delete(friendships)
    .where(expectedState(row))
    .returning({ userLowId: friendships.userLowId });
  return Boolean(removed);
}

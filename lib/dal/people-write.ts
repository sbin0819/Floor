import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { friendships, users } from "@/lib/db/schema";
import type { DalDatabase } from "./database";

export function friendPairCondition(me: string, other: string) {
  return and(
    eq(friendships.userLowId, sql`least(${me}::uuid, ${other}::uuid)`),
    eq(friendships.userHighId, sql`greatest(${me}::uuid, ${other}::uuid)`),
  );
}

export async function lockFriendUsers(
  me: string,
  other: string,
  database: DalDatabase,
) {
  const people = new Map<
    string,
    { id: string; name: string; emailVerified: boolean }
  >();
  // 하루 한도 검사와 서로 반대로 보내는 요청을 같은 UUID 순서로 줄 세운다.
  for (const id of [...new Set([me, other])].sort()) {
    const [row] = await database
      .select({
        id: users.id,
        name: users.name,
        emailVerified: users.emailVerified,
      })
      .from(users)
      .where(eq(users.id, id))
      .for(id === me ? "update" : "key share");
    if (row) people.set(id, row);
  }
  return { me: people.get(me) ?? null, other: people.get(other) ?? null };
}

export async function lockFriendPair(
  me: string,
  other: string,
  database: DalDatabase,
) {
  const [row] = await database
    .select()
    .from(friendships)
    .where(friendPairCondition(me, other))
    .for("update");
  return row ?? null;
}

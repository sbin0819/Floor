import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import type { DalDatabase } from "./database";

export function blockedBy(recipient: SQL, author: SQL): SQL<boolean> {
  return sql<boolean>`exists (select 1 from user_blocks blocked
    where blocked.blocker_id = ${recipient} and blocked.blocked_id = ${author})`;
}

export function blockedBetween(me: SQL, other: SQL): SQL<boolean> {
  return sql<boolean>`(${blockedBy(me, other)} or ${blockedBy(other, me)})`;
}

export async function blockBetween(
  me: string,
  other: string,
  database: DalDatabase = getDb(),
): Promise<{ byMe: boolean; byThem: boolean }> {
  const [row] = await database
    .select({
      byMe: blockedBy(sql`${me}::uuid`, sql`${other}::uuid`),
      byThem: blockedBy(sql`${other}::uuid`, sql`${me}::uuid`),
    })
    .from(sql`(select 1) as block_context`);
  return row!;
}

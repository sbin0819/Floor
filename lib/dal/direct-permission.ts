import "server-only";

import { eq, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import type { DalDatabase } from "./database";
import { blockedBetween } from "./people-blocks";

export function directRelationshipCondition(me: SQL, other: SQL): SQL<boolean> {
  return sql<boolean>`(exists (select 1 from friendships f where f.user_low_id = least(${me}, ${other})
      and f.user_high_id = greatest(${me}, ${other}) and f.status = 'accepted')
    or exists (select 1 from team_members a inner join team_members b on a.team_id = b.team_id
      where a.user_id = ${me} and b.user_id = ${other}))`;
}

export function canOpenDirectMessageCondition(
  me: SQL,
  other: SQL,
): SQL<boolean> {
  return sql<boolean>`(${me} <> ${other} and not ${blockedBetween(me, other)} and exists (
    select 1 from users target where target.id = ${other} and target.email_verified
  ) and (
    ${directRelationshipCondition(me, other)}
    or exists (select 1 from chat_rooms r inner join chat_room_members m on m.room_id = r.id
      where r.kind = 'dm' and r.dm_low_user_id = least(${me}, ${other})
        and r.dm_high_user_id = greatest(${me}, ${other}) and r.last_message_at is not null
        and m.user_id = ${me} and m.status in ('active', 'requested'))
  ))`;
}

export async function directPeerAccess(
  userId: string,
  otherId: string,
  database: DalDatabase = getDb(),
) {
  const [peer] = await database
    .select({
      existsVerified: users.emailVerified,
      blocked: blockedBetween(sql`${userId}::uuid`, sql`${users.id}`),
      related: directRelationshipCondition(
        sql`${userId}::uuid`,
        sql`${users.id}`,
      ),
      canOpen: canOpenDirectMessageCondition(
        sql`${userId}::uuid`,
        sql`${users.id}`,
      ),
    })
    .from(users)
    .where(eq(users.id, otherId));
  return (
    peer ?? {
      existsVerified: false,
      canOpen: false,
      blocked: false,
      related: false,
    }
  );
}

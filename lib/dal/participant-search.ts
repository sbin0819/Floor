import "server-only";

import { and, asc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { teamMembers, teams, users } from "@/lib/db/schema";
import type { DalDatabase } from "@/lib/dal/database";
import { blockedBetween } from "./people-blocks";
import { avatarColumns } from "./avatar";
import { toAvatar } from "@/lib/avatar";

export async function findParticipants(
  userId: string,
  query: string,
  database: DalDatabase = getDb(),
) {
  const shared = sql`exists (
    select 1 from ${teamMembers} mine
    join ${teamMembers} theirs on theirs.team_id = mine.team_id
    where mine.user_id = ${userId} and theirs.user_id = ${users.id}
  )`;
  const like = `%${query.replace(/[\\%_]/gu, "\\$&")}%`;
  const rows = await database
    .select({
      userId: users.id,
      name: users.name,
      avatar: avatarColumns(users),
      email: users.email,
      sharedTeamNames: sql<string[]>`coalesce((
        select jsonb_agg(t.name order by t.name, t.id)
        from ${teamMembers} mine
        join ${teamMembers} theirs on theirs.team_id = mine.team_id
        join ${teams} t on t.id = mine.team_id
        where mine.user_id = ${userId} and theirs.user_id = ${users}.${sql.identifier("id")}
      ), '[]'::jsonb)`,
    })
    .from(users)
    .where(
      and(
        ne(users.id, userId),
        eq(users.emailVerified, true),
        sql`not ${blockedBetween(sql`${userId}::uuid`, sql`${users.id}`)}`,
        or(
          and(shared, or(ilike(users.name, like), ilike(users.email, like))),
          sql`lower(${users.email}) = ${query.toLowerCase()}`,
        ),
      ),
    )
    .orderBy(
      sql`case when ${shared} then 0 else 1 end`,
      asc(users.name),
      asc(users.id),
    )
    .limit(8);
  return rows.map(({ avatar, ...row }) => ({
    ...row,
    avatar: toAvatar(avatar),
  }));
}

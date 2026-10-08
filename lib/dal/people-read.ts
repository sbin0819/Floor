import "server-only";

import { and, asc, desc, eq, ne, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { friendships, users } from "@/lib/db/schema";
import type {
  FriendRow,
  FriendsTab,
  PersonRelation,
} from "@/features/people/types";
import { canOpenDirectMessageCondition } from "./direct-permission";
import type { DalDatabase } from "./database";
import { blockedBetween, blockedBy } from "./people-blocks";
import { messageRequestCount } from "./message-requests-read";
export { blockBetween } from "./people-blocks";

export function sharedTeamCondition(me: string, other: SQL) {
  return sql<boolean>`exists (
    select 1 from team_members mine join team_members theirs on mine.team_id = theirs.team_id
    where mine.user_id = ${me}::uuid and theirs.user_id = ${other}
  )`;
}
function sharedTeamNames(me: string, other: SQL) {
  return sql<string[]>`array(
    select t.name from teams t join team_members mine on mine.team_id = t.id
      join team_members theirs on theirs.team_id = t.id
    where mine.user_id = ${me}::uuid and theirs.user_id = ${other}
    order by t.name, t.id
  )`;
}
function directRoomId(me: string, other: SQL) {
  return sql<string | null>`(
    select r.id from chat_rooms r where r.kind = 'dm'
      and r.dm_low_user_id = least(${me}::uuid, ${other})
      and r.dm_high_user_id = greatest(${me}::uuid, ${other})
  )`;
}
function pair(me: string, other: SQL) {
  return and(
    sql`${friendships.userLowId} = least(${me}::uuid, ${other})`,
    sql`${friendships.userHighId} = greatest(${me}::uuid, ${other})`,
  );
}
function relation(me: string, now: Date) {
  return sql<PersonRelation>`case
    when ${blockedBy(sql`${me}::uuid`, sql`${users.id}`)} then 'blocked'
    when ${blockedBy(sql`${users.id}`, sql`${me}::uuid`)} then 'none'
    when ${friendships.status} = 'accepted' then 'friend'
    when ${friendships.requestedBy} = ${me}::uuid and (
      ${friendships.status} = 'pending' or (${friendships.status} = 'declined'
        and ${friendships.statusChangedAt} > ${new Date(now.getTime() - 30 * 86_400_000).toISOString()}::timestamptz)
    ) then 'outgoing'
    when ${friendships.status} = 'pending' then 'incoming'
    else 'none' end`;
}
const personId = sql`${users.id}`;

export function searchPeopleRows(
  me: string,
  input: { query: string; username: string | null },
  now: Date,
  database: DalDatabase = getDb(),
) {
  const exact = or(
    input.username === null ? sql`false` : eq(users.username, input.username),
    sql`lower(${users.email}) = ${input.query.toLowerCase()}`,
  )!;
  const pattern = `%${input.query.replace(/[\\%_]/g, "\\$&")}%`;
  const shared = sharedTeamCondition(me, personId);
  return database
    .select({
      userId: users.id,
      name: users.name,
      username: users.username,
      relation: relation(me, now),
      sharedTeamNames: sharedTeamNames(me, personId),
      directRoomId: directRoomId(me, personId),
      canDirectMessage: canOpenDirectMessageCondition(
        sql`${me}::uuid`,
        personId,
      ),
    })
    .from(users)
    .leftJoin(friendships, pair(me, personId))
    .where(
      and(
        ne(users.id, me),
        eq(users.emailVerified, true),
        or(
          exact,
          input.query.length >= 2
            ? and(
                shared,
                sql`not ${blockedBetween(sql`${me}::uuid`, personId)}`,
                sql`(${users.name} ilike ${pattern} escape '\\' or ${users.username} ilike ${pattern} escape '\\')`,
              )
            : sql`false`,
        ),
      ),
    )
    .orderBy(desc(exact), desc(shared), asc(users.name), asc(users.id))
    .limit(8);
}

export async function readPersonProfile(
  me: string,
  other: string,
  now: Date,
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .select({
      userId: users.id,
      name: users.name,
      username: users.username,
      relation: relation(me, now),
      directRoomId: directRoomId(me, personId),
      canDirectMessage: canOpenDirectMessageCondition(
        sql`${me}::uuid`,
        personId,
      ),
      sharedSpaces: sql<{ id: string; name: string }[]>`coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', t.name) order by t.name, s.id)
      from chat_spaces s join teams t on s.team_id = t.id
      join team_members mine on mine.team_id = t.id join team_members theirs on theirs.team_id = t.id
      where s.kind = 'team' and s.deleted_at is null
        and mine.user_id = ${me}::uuid and theirs.user_id = ${personId}
    ), '[]'::jsonb)`,
    })
    .from(users)
    .leftJoin(friendships, pair(me, personId))
    .where(
      and(
        eq(users.id, other),
        or(
          eq(users.id, me),
          sql`${friendships.userLowId} is not null`,
          sharedTeamCondition(me, personId),
          sql`${directRoomId(me, personId)} is not null`,
          sql`exists (
            select 1 from chat_rooms group_room
              join chat_room_members mine on mine.room_id = group_room.id
              join chat_room_members theirs on theirs.room_id = group_room.id
            where group_room.kind = 'group_dm'
              and mine.user_id = ${me}::uuid and mine.status = 'active'
              and theirs.user_id = ${personId} and theirs.status = 'active'
          )`,
        ),
      ),
    );
  return row ?? null;
}

export function listMessageContacts(
  me: string,
  database: DalDatabase = getDb(),
) {
  return database
    .select({
      userId: users.id,
      name: users.name,
      username: users.username,
      isFriend: sql<boolean>`coalesce(${friendships.status} = 'accepted', false)`,
      sharedTeamNames: sharedTeamNames(me, personId),
      directRoomId: directRoomId(me, personId),
    })
    .from(users)
    .leftJoin(friendships, pair(me, personId))
    .where(
      and(
        ne(users.id, me),
        eq(users.emailVerified, true),
        sql`not ${blockedBetween(sql`${me}::uuid`, personId)}`,
        or(
          eq(friendships.status, "accepted"),
          sharedTeamCondition(me, personId),
        ),
      ),
    )
    .orderBy(asc(users.name), asc(users.id))
    .limit(500);
}

export async function readFriendsList(
  me: string,
  tab: FriendsTab,
  now: Date,
  database: DalDatabase = getDb(),
) {
  const peer = sql`peer.id`;
  const required =
    tab === "all"
      ? sql`f.status = 'accepted'`
      : tab === "received"
        ? sql`f.status = 'pending' and f.requested_by <> ${me}::uuid`
        : sql`f.requested_by = ${me}::uuid and (f.status = 'pending' or (
        f.status = 'declined' and f.status_changed_at > ${new Date(now.getTime() - 30 * 86_400_000).toISOString()}::timestamptz
      ))`;
  const [row] = await database
    .select({
      receivedCount: sql<number>`(select count(*)::int from friendships f
      where ${me}::uuid in (f.user_low_id, f.user_high_id) and f.status = 'pending' and f.requested_by <> ${me}::uuid)`,
      messageRequestCount: messageRequestCount(me),
      rows:
        tab === "requests"
          ? sql<FriendRow[]>`'[]'::jsonb`
          : tab === "blocked"
            ? sql<FriendRow[]>`coalesce((select jsonb_agg(jsonb_build_object(
      'userId', peer.id, 'name', peer.name, 'username', peer.username,
      'sharedTeamNames', ${sharedTeamNames(me, peer)}, 'directRoomId', ${directRoomId(me, peer)}
    ) order by peer.name, peer.id)
    from user_blocks blocked join users peer on peer.id = blocked.blocked_id
    where blocked.blocker_id = ${me}::uuid), '[]'::jsonb)`
            : sql<FriendRow[]>`coalesce((select jsonb_agg(jsonb_build_object(
      'userId', peer.id, 'name', peer.name, 'username', peer.username,
      'sharedTeamNames', ${sharedTeamNames(me, peer)}, 'directRoomId', ${directRoomId(me, peer)}
    ) order by peer.name, peer.id)
    from friendships f join users peer on peer.id = case when f.user_low_id = ${me}::uuid then f.user_high_id else f.user_low_id end
    where ${me}::uuid in (f.user_low_id, f.user_high_id) and (${required})), '[]'::jsonb)`,
    })
    .from(users)
    .where(eq(users.id, me));
  return row ?? null;
}

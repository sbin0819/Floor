import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { chatRoomReads, chatRooms, chatSpacePrefs } from "@/lib/db/schema";
import type { DalDatabase } from "./database";
import { readableRoomCondition } from "./chat-access";
import { blockedBy } from "./people-blocks";

export function roomJoinedAt(userId: string) {
  return sql`case when ${chatRooms.kind} in ('dm', 'group_dm') then (
    select m.joined_at from chat_room_members m where m.room_id = ${chatRooms.id} and m.user_id = ${userId}::uuid
  ) else (
    select m.created_at from team_members m inner join chat_spaces s on s.team_id = m.team_id where s.id = ${chatRooms.spaceId} and m.user_id = ${userId}::uuid
  ) end`;
}

export function unreadDirectCount(userId: string) {
  return sql<number>`(select count(*)::integer from (
    select 1 from messages candidate where candidate.room_id = ${chatRooms.id}
      and candidate.seq > coalesce(${chatRoomReads.lastReadSeq}, 0)
      and candidate.created_at > ${roomJoinedAt(userId)}
      and candidate.author_id is distinct from ${userId}::uuid and candidate.deleted_at is null limit 100
  ) unread_direct)`.mapWith(Number);
}

// 목록과 채널 화면이 같은 시작점을 사용한다. 재가입 전 기록과 내 메시지는 제외한다.
export function firstUnreadSequence(userId: string) {
  return sql<number | null>`case when
    (${chatRoomReads.roomId} is null and ${chatRooms.lastMessageAt} > ${roomJoinedAt(userId)})
    or (${chatRoomReads.roomId} is not null and ${chatRooms.lastSeq} > ${chatRoomReads.lastReadSeq})
    then (
      select min(unread_message.seq) from messages as unread_message
      where unread_message.room_id = ${chatRooms.id}
        and unread_message.author_id is distinct from ${userId}
        and unread_message.created_at > ${roomJoinedAt(userId)}
        and (${chatRooms.kind} not in ('dm', 'group_dm') or unread_message.deleted_at is null)
        and (${chatRoomReads.roomId} is null or unread_message.seq > ${chatRoomReads.lastReadSeq})
    ) else null end`.mapWith(Number);
}

export function unreadMentionCount(userId: string) {
  const unread = sql`candidate.room_id = ${chatRooms.id}
    and candidate.seq > coalesce(${chatRoomReads.lastReadSeq}, 0)
    and candidate.created_at > ${roomJoinedAt(userId)}
    and candidate.author_id is distinct from ${userId}
    and candidate.deleted_at is null
    and not ${blockedBy(sql`${userId}::uuid`, sql`candidate.author_id`)}`;
  // 두 인덱스로 후보를 찾고 UNION으로 @모두·개인 멘션이 겹친 메시지를 한 번만 센다.
  return sql<number>`(select count(*)::integer from (
    select candidate.id from messages candidate
      where candidate.mentions_everyone = true and ${unread}
    union
    select candidate.id from message_mentions mention
      inner join messages candidate on candidate.id = mention.message_id
      where mention.user_id = ${userId} and ${unread}
  ) unread_mentions)`.mapWith(Number);
}

export async function saveRoomMuted(
  input: { roomId: string; userId: string; muted: boolean; now: Date },
  database: DalDatabase = getDb(),
) {
  const [preference] = await database
    .insert(chatRoomReads)
    .select(
      sql`
    with locked_user as materialized (
      select id from users where id = ${input.userId}::uuid for key share
    ), locked_room as materialized (
      select r.id from chat_rooms r cross join locked_user u
      where r.id = ${input.roomId}::uuid and ${readableRoomCondition(input.userId, sql`r.id`)} for key share of r
    ) select id, ${input.userId}::uuid, 0, ${input.muted},
      ${input.now.toISOString()}::timestamptz, ${input.now.toISOString()}::timestamptz
      from locked_room
  `,
    )
    .onConflictDoUpdate({
      target: [chatRoomReads.roomId, chatRoomReads.userId],
      set: { muted: input.muted, updatedAt: input.now },
    })
    .returning({ muted: chatRoomReads.muted });
  return preference ?? null;
}

export async function saveSpaceMuted(
  input: { spaceId: string; userId: string; muted: boolean; now: Date },
  database: DalDatabase = getDb(),
) {
  const [preference] = await database
    .insert(chatSpacePrefs)
    .select(
      sql`
    with locked_user as materialized (
      select id from users where id = ${input.userId}::uuid for key share
    ), locked_space as materialized (
      select s.id from chat_spaces s cross join locked_user u
      inner join team_members m on m.team_id = s.team_id and m.user_id = u.id
      where s.id = ${input.spaceId}::uuid and s.kind = 'team'
        and s.deleted_at is null for key share of s
    ) select id, ${input.userId}::uuid, ${input.muted},
      ${input.now.toISOString()}::timestamptz, ${input.now.toISOString()}::timestamptz
      from locked_space
  `,
    )
    .onConflictDoUpdate({
      target: [chatSpacePrefs.spaceId, chatSpacePrefs.userId],
      set: { muted: input.muted, updatedAt: input.now },
    })
    .returning({ muted: chatSpacePrefs.muted });
  return preference ?? null;
}

export async function advanceRoomRead(
  input: { roomId: string; userId: string; seq: number; now: Date },
  database: DalDatabase = getDb(),
) {
  const [cursor] = await database
    .insert(chatRoomReads)
    .select(
      // CTE 의존 순서로 사용자 → 방 → 읽은 행을 한 문장 안에서 잠근다.
      sql`with locked_user as materialized (
        select id from users where id = ${input.userId}::uuid for key share
      ), locked_room as materialized (
        select r.id, r.last_seq from chat_rooms r cross join locked_user u
        where r.id = ${input.roomId}::uuid and ${readableRoomCondition(input.userId, sql`r.id`)} for key share of r
      ) select id, ${input.userId}::uuid, least(${input.seq}, last_seq), false,
      ${input.now.toISOString()}::timestamptz, ${input.now.toISOString()}::timestamptz from locked_room`,
    )
    .onConflictDoUpdate({
      target: [chatRoomReads.roomId, chatRoomReads.userId],
      set: {
        lastReadSeq: sql`greatest(${chatRoomReads.lastReadSeq}, excluded.last_read_seq)`,
        updatedAt: input.now,
      },
      setWhere: sql`${chatRoomReads.lastReadSeq} < excluded.last_read_seq`,
    })
    .returning({
      lastReadSeq: chatRoomReads.lastReadSeq,
      advanced: sql<boolean>`${chatRoomReads.lastReadSeq} > 0`,
    });
  if (cursor) return cursor;
  // 동시 upsert의 no-op은 원래 statement snapshot이 아닌 새 snapshot의 실제 값을 읽는다.
  const [stored] = await database
    .select({ lastReadSeq: chatRoomReads.lastReadSeq })
    .from(chatRoomReads)
    .innerJoin(chatRooms, eq(chatRoomReads.roomId, chatRooms.id))
    .where(
      and(
        eq(chatRoomReads.roomId, input.roomId),
        eq(chatRoomReads.userId, input.userId),
        readableRoomCondition(input.userId),
      ),
    );
  return stored ? { ...stored, advanced: false } : null;
}

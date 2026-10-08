import "server-only";

import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { chatRoomReads, chatRooms, teamMembers } from "@/lib/db/schema";
import type { DalDatabase } from "./database";

// 목록과 채널 화면이 같은 시작점을 사용한다. 재가입 전 기록과 내 메시지는 제외한다.
export function firstUnreadSequence(userId: string) {
  return sql<number | null>`case when
    (${chatRoomReads.roomId} is null and ${chatRooms.lastMessageAt} > ${teamMembers.createdAt})
    or (${chatRoomReads.roomId} is not null and ${chatRooms.lastSeq} > ${chatRoomReads.lastReadSeq})
    then (
      select min(unread_message.seq) from messages as unread_message
      where unread_message.room_id = ${chatRooms.id}
        and unread_message.author_id is distinct from ${userId}
        and unread_message.created_at > ${teamMembers.createdAt}
        and (${chatRoomReads.roomId} is null or unread_message.seq > ${chatRoomReads.lastReadSeq})
    ) else null end`.mapWith(Number);
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
        where r.id = ${input.roomId}::uuid for key share of r
      ) select id, ${input.userId}::uuid, least(${input.seq}, last_seq), false,
        ${input.now.toISOString()}::timestamptz, ${input.now.toISOString()}::timestamptz
        from locked_room`,
    )
    .onConflictDoUpdate({
      target: [chatRoomReads.roomId, chatRoomReads.userId],
      set: {
        lastReadSeq: sql`greatest(${chatRoomReads.lastReadSeq}, excluded.last_read_seq)`,
        updatedAt: input.now,
      },
    })
    .returning({ lastReadSeq: chatRoomReads.lastReadSeq });
  return cursor ?? null;
}

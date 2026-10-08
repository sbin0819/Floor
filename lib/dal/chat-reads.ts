import "server-only";

import { eq, sql } from "drizzle-orm";
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
      database
        .select({
          roomId: chatRooms.id,
          userId: sql<string>`${input.userId}::uuid`.as("user_id"),
          lastReadSeq:
            sql<number>`least(${input.seq}, ${chatRooms.lastSeq})`.as(
              "last_read_seq",
            ),
          muted: sql<boolean>`false`.as("muted"),
          updatedAt: sql<Date>`${input.now.toISOString()}::timestamptz`.as(
            "updated_at",
          ),
          createdAt: sql<Date>`${input.now.toISOString()}::timestamptz`.as(
            "created_at",
          ),
        })
        .from(chatRooms)
        .where(eq(chatRooms.id, input.roomId))
        // 외래 키가 방을 뒤늦게 잠그지 않도록 보내기와 같은 방 → 읽은 행 순서를 유지한다.
        .for("key share"),
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

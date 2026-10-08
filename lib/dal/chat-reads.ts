import "server-only";

import { sql } from "drizzle-orm";
import { chatRoomReads, chatRooms, teamMembers } from "@/lib/db/schema";

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

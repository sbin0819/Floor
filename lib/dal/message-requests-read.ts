import "server-only";

import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { chatRoomMembers, chatRooms, users } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import type { DalDatabase } from "./database";
import type { AttachmentSummary } from "@/features/chat/types";
import { directPeerId } from "./direct";

export function messageRequestCount(userId: string) {
  return sql<number>`(select count(*)::int from chat_rooms request_room
    join chat_room_members recipient on recipient.room_id = request_room.id
    where request_room.kind = 'dm' and request_room.last_message_at is not null
      and recipient.user_id = ${userId}::uuid and recipient.status = 'requested')`;
}

export function listMessageRequests(
  userId: string,
  database: DalDatabase = getDb(),
) {
  return database
    .select({
      roomId: chatRooms.id,
      other: { userId: users.id, name: users.name, username: users.username },
      lastMessageAt: chatRooms.lastMessageAt,
      body: sql<string>`coalesce((select case when m.deleted_at is not null then '삭제된 메시지예요' else m.body end
      from messages m where m.room_id = ${chatRooms.id} order by m.seq desc limit 1), '')`,
      attachmentSummary: sql<AttachmentSummary | null>`(select case when m.deleted_at is not null then null else
        (select json_build_object('images', count(*) filter(where a.kind = 'image'),
          'files', count(*) filter(where a.kind = 'file'), 'firstName', (array_agg(a.name order by a.position))[1])
        from message_attachments a where a.message_id = m.id having count(*) > 0) end
        from messages m where m.room_id = ${chatRooms.id} order by m.seq desc limit 1)`,
    })
    .from(chatRooms)
    .innerJoin(
      chatRoomMembers,
      and(
        eq(chatRoomMembers.roomId, chatRooms.id),
        eq(chatRoomMembers.userId, userId),
        eq(chatRoomMembers.status, "requested"),
      ),
    )
    .innerJoin(users, eq(users.id, directPeerId(userId)))
    .where(and(eq(chatRooms.kind, "dm"), isNotNull(chatRooms.lastMessageAt)))
    .orderBy(desc(chatRooms.lastMessageAt), chatRooms.id)
    .limit(50);
}

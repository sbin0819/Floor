import "server-only";

import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db/client";
import {
  bookings,
  chatRoomMembers,
  chatRoomReads,
  chatRooms,
  chatSpaces,
  messageAttachments,
  messageMentions,
  spaces,
  users,
} from "@/lib/db/schema";
import type { AvatarSource } from "@/lib/avatar";
import type { SystemMessageData } from "@/features/chat/system-messages";
import type { DalDatabase } from "./database";
import { avatarColumns, avatarJson } from "./avatar";
import { chatSpaceName, readableRoomCondition } from "./chat-access";
import { directPeerId } from "./direct";
import {
  unreadDirectCount,
  unreadMentionCondition,
  unreadMentionCount,
} from "./chat-reads";
import { blockedBy } from "./people-blocks";

type RecentMessage = {
  id: string;
  kind: "text" | "system";
  body: string;
  systemData: SystemMessageData | null;
  deleted: boolean;
  authorName: string | null;
  authorAvatar: AvatarSource | null;
  createdAt: string;
};

const author = alias(users, "recent_author");
const messageJson = sql<RecentMessage>`jsonb_build_object(
  'id', candidate.id, 'kind', candidate.kind,
  'body', case when candidate.deleted_at is null then candidate.body else '' end,
  'systemData', case when candidate.deleted_at is null then candidate.system_data else null end,
  'deleted', candidate.deleted_at is not null,
  'authorName', ${author.name}, 'authorAvatar',
    case when ${author.id} is null then null else ${avatarJson(author)} end,
  'createdAt', candidate.created_at)`;

export function readHomeDirectChats(
  userId: string,
  database: DalDatabase = getDb(),
) {
  return database
    .select({
      roomId: chatRooms.id,
      kind: sql<"dm" | "group_dm">`${chatRooms.kind}`,
      name: chatRooms.name,
      at: chatRooms.lastMessageAt,
      unreadCount: unreadDirectCount(userId),
      peer: { name: users.name, ...avatarColumns(users) },
      memberCount:
        sql<number>`(select count(*)::integer from chat_room_members member
        where member.room_id = ${chatRooms.id} and member.status = 'active')`.mapWith(
          Number,
        ),
      memberNames: sql<
        string[]
      >`coalesce((select jsonb_agg(member.name order by member.name, member.id)
        from (select person.id, person.name from chat_room_members member
          join users person on person.id = member.user_id
          where member.room_id = ${chatRooms.id} and member.status = 'active' and member.user_id <> ${userId}::uuid
          order by person.name, person.id limit 3) member), '[]'::jsonb)`,
      message: sql<RecentMessage | null>`recent_message.message`,
    })
    .from(chatRooms)
    .innerJoin(
      chatRoomMembers,
      and(
        eq(chatRoomMembers.roomId, chatRooms.id),
        eq(chatRoomMembers.userId, userId),
        eq(chatRoomMembers.status, "active"),
      ),
    )
    .leftJoin(
      users,
      sql`${chatRooms.kind} = 'dm' and ${users.id} = ${directPeerId(userId)}`,
    )
    .leftJoin(
      chatRoomReads,
      and(
        eq(chatRoomReads.roomId, chatRooms.id),
        eq(chatRoomReads.userId, userId),
      ),
    )
    .leftJoinLateral(
      sql`(select ${messageJson} as message from messages candidate
      left join users recent_author on recent_author.id = candidate.author_id
      where candidate.room_id = ${chatRooms.id}
        and not ${blockedBy(sql`${userId}::uuid`, sql`candidate.author_id`)}
      order by candidate.seq desc limit 1) as recent_message`,
      sql`true`,
    )
    .where(
      and(
        inArray(chatRooms.kind, ["dm", "group_dm"]),
        isNotNull(chatRooms.lastMessageAt),
        readableRoomCondition(userId),
        sql`(${chatRooms.kind} <> 'dm' or not ${blockedBy(sql`${userId}::uuid`, directPeerId(userId))})`,
      ),
    )
    .orderBy(desc(chatRooms.lastMessageAt), chatRooms.id)
    .limit(3);
}

export function readHomeMentionChats(
  userId: string,
  now: Date,
  database: DalDatabase = getDb(),
) {
  return database
    .select({
      roomId: chatRooms.id,
      spaceId: chatRooms.spaceId,
      bookingId: chatRooms.bookingId,
      name: chatRooms.name,
      spaceName: chatSpaceName,
      bookingTitle: bookings.title,
      bookingSpaceName: spaces.name,
      unreadCount: unreadMentionCount(userId),
      message: sql<RecentMessage>`recent_message.message`,
    })
    .from(chatRooms)
    .leftJoin(chatSpaces, eq(chatSpaces.id, chatRooms.spaceId))
    .leftJoin(bookings, eq(bookings.id, chatRooms.bookingId))
    .leftJoin(spaces, eq(spaces.id, bookings.spaceId))
    .leftJoin(
      chatRoomReads,
      and(
        eq(chatRoomReads.roomId, chatRooms.id),
        eq(chatRoomReads.userId, userId),
      ),
    )
    .innerJoinLateral(
      sql`(select ${messageJson} as message, candidate.created_at as at
      from messages candidate left join users recent_author on recent_author.id = candidate.author_id
      where ${unreadMentionCondition(userId)} and (candidate.mentions_everyone or exists (
        select 1 from message_mentions mention where mention.message_id = candidate.id and mention.user_id = ${userId}::uuid
      )) order by candidate.created_at desc, candidate.seq desc limit 1) as recent_message`,
      sql`true`,
    )
    .where(
      and(
        readableRoomCondition(userId),
        sql`(${chatRooms.kind} in ('text', 'voice') and ${chatRooms.archivedAt} is null
        or ${chatRooms.kind} = 'meeting' and ${bookings.status} = 'confirmed'
          and upper(${bookings.during}) > ${new Date(now.getTime() - 86_400_000).toISOString()}::timestamptz)`,
      ),
    )
    .orderBy(desc(sql`recent_message.at`), chatRooms.id)
    .limit(3);
}

export function readHomeMentionNames(
  messageIds: readonly string[],
  database: DalDatabase = getDb(),
) {
  if (!messageIds.length) return Promise.resolve([]);
  return database
    .select({
      messageId: messageMentions.messageId,
      userId: users.id,
      name: users.name,
    })
    .from(messageMentions)
    .innerJoin(users, eq(users.id, messageMentions.userId))
    .where(inArray(messageMentions.messageId, [...messageIds]));
}

export function readHomeMessageAttachments(
  messageIds: readonly string[],
  database: DalDatabase = getDb(),
) {
  if (!messageIds.length) return Promise.resolve([]);
  return database
    .select({
      messageId: messageAttachments.messageId,
      kind: messageAttachments.kind,
      name: messageAttachments.name,
    })
    .from(messageAttachments)
    .where(inArray(messageAttachments.messageId, [...messageIds]))
    .orderBy(messageAttachments.messageId, messageAttachments.position);
}

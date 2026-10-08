import "server-only";

import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  chatRoomMembers,
  chatRoomReads,
  chatRooms,
  users,
} from "@/lib/db/schema";
import type { DalDatabase } from "./database";
import { unreadDirectCount, unreadMentionCount } from "./chat-reads";
import { blockedBy } from "./people-blocks";
import { lockRoomForMessage } from "./chat-write";
import { alias } from "drizzle-orm/pg-core";
import { avatarColumns, avatarJson } from "./avatar";
import { toAvatar, type AvatarSource } from "@/lib/avatar";

export {
  canOpenDirectMessageCondition,
  directPeerAccess,
} from "./direct-permission";

export async function createDirectRoom(
  userIds: readonly [string, string],
  now: Date,
  database: DalDatabase,
) {
  const [low, high] = userIds.map((id) => id.toLowerCase()).sort() as [
    string,
    string,
  ];
  const [inserted] = await database
    .insert(chatRooms)
    .values({
      kind: "dm",
      dmLowUserId: low,
      dmHighUserId: high,
      createdAt: now,
    })
    .onConflictDoNothing({
      target: [chatRooms.dmLowUserId, chatRooms.dmHighUserId],
      where: sql`${chatRooms.kind} = 'dm'`,
    })
    .returning({ id: chatRooms.id });
  const room =
    inserted ??
    (
      await database
        .select({ id: chatRooms.id })
        .from(chatRooms)
        .where(
          and(
            eq(chatRooms.kind, "dm"),
            eq(chatRooms.dmLowUserId, low),
            eq(chatRooms.dmHighUserId, high),
          ),
        )
    )[0];
  if (!room) throw new Error("Direct room could not be created.");
  await lockRoomForMessage(room.id, database);
  await database
    .insert(chatRoomMembers)
    .values(
      [low, high].map((userId) => ({
        roomId: room.id,
        userId,
        status: "active" as const,
        joinedAt: now,
        statusChangedAt: now,
        createdAt: now,
      })),
    )
    .onConflictDoNothing();
  return { roomId: room.id };
}

export async function listDirectMembers(
  roomId: string,
  database: DalDatabase = getDb(),
  mentionAuthorId?: string,
) {
  const rows = await database
    .select({
      id: users.id,
      name: users.name,
      avatar: avatarColumns(users),
      admin: sql<false>`false`,
      ...(mentionAuthorId
        ? {
            canMention: sql<boolean>`not ${blockedBy(sql`${users.id}`, sql`${mentionAuthorId}::uuid`)}`,
          }
        : {}),
    })
    .from(chatRoomMembers)
    .innerJoin(users, eq(users.id, chatRoomMembers.userId))
    .innerJoin(chatRooms, eq(chatRooms.id, chatRoomMembers.roomId))
    .where(
      and(
        eq(chatRoomMembers.roomId, roomId),
        eq(chatRoomMembers.status, "active"),
        sql`(${chatRooms.kind} = 'group_dm' or ${chatRoomMembers.userId} in (${chatRooms.dmLowUserId}, ${chatRooms.dmHighUserId}))`,
      ),
    )
    .orderBy(users.name, users.id);
  return rows.map((row) => ({ ...row, avatar: toAvatar(row.avatar) }));
}

export function directPeerId(userId: string) {
  return sql<string>`case when ${chatRooms.dmLowUserId} = ${userId} then ${chatRooms.dmHighUserId} else ${chatRooms.dmLowUserId} end`;
}

export async function listDirectNav(
  userId: string,
  database: DalDatabase = getDb(),
) {
  const rows = await database
    .select({
      roomId: chatRooms.id,
      kind: sql<"dm" | "group_dm">`${chatRooms.kind}`,
      other: {
        userId: users.id,
        name: users.name,
        username: users.username,
        avatar: avatarJson(users),
      },
      name: chatRooms.name,
      memberCount:
        sql<number>`(select count(*)::int from chat_room_members m where m.room_id = ${chatRooms.id} and m.status = 'active')`.mapWith(
          Number,
        ),
      members: sql<
        { userId: string; name: string; avatar: AvatarSource }[]
      >`coalesce((select json_agg(json_build_object('userId', member.id, 'name', member.name, 'avatar', member.avatar) order by member.name, member.id) from (
        select u.id, u.name, ${avatarJson(alias(users, "u"))} as avatar from chat_room_members m inner join users u on u.id = m.user_id
        where m.room_id = ${chatRooms.id} and m.status = 'active' and m.user_id <> ${userId}::uuid order by u.name, u.id limit 3
      ) member), '[]'::json)`,
      lastSeq: chatRooms.lastSeq,
      lastMessageAt: chatRooms.lastMessageAt,
      unreadCount: unreadDirectCount(userId),
      unreadMentions: unreadMentionCount(userId),
      muted: sql<boolean>`coalesce(${chatRoomReads.muted}, false)`,
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
    .leftJoin(users, eq(users.id, directPeerId(userId)))
    .leftJoin(
      chatRoomReads,
      and(
        eq(chatRoomReads.roomId, chatRooms.id),
        eq(chatRoomReads.userId, userId),
      ),
    )
    .where(
      and(
        sql`${chatRooms.kind} in ('dm', 'group_dm')`,
        isNotNull(chatRooms.lastMessageAt),
      ),
    )
    .orderBy(desc(chatRooms.lastMessageAt), chatRooms.id)
    .limit(50);
  return rows.map((row) => ({
    ...row,
    other: row.other
      ? { ...row.other, avatar: toAvatar(row.other.avatar) }
      : null,
    members: row.members.map((member) => ({
      ...member,
      avatar: toAvatar(member.avatar),
    })),
  }));
}

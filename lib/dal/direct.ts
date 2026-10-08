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

export function listDirectMembers(
  roomId: string,
  database: DalDatabase = getDb(),
  mentionAuthorId?: string,
) {
  return database
    .select({
      id: users.id,
      name: users.name,
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
        sql`${chatRoomMembers.userId} in (${chatRooms.dmLowUserId}, ${chatRooms.dmHighUserId})`,
      ),
    )
    .orderBy(users.name, users.id);
}

export function directPeerId(userId: string) {
  return sql<string>`case when ${chatRooms.dmLowUserId} = ${userId} then ${chatRooms.dmHighUserId} else ${chatRooms.dmLowUserId} end`;
}

export function listDirectNav(userId: string, database: DalDatabase = getDb()) {
  return database
    .select({
      roomId: chatRooms.id,
      other: { userId: users.id, name: users.name, username: users.username },
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
    .innerJoin(users, eq(users.id, directPeerId(userId)))
    .leftJoin(
      chatRoomReads,
      and(
        eq(chatRoomReads.roomId, chatRooms.id),
        eq(chatRoomReads.userId, userId),
      ),
    )
    .where(and(eq(chatRooms.kind, "dm"), isNotNull(chatRooms.lastMessageAt)))
    .orderBy(desc(chatRooms.lastMessageAt), chatRooms.id)
    .limit(50);
}

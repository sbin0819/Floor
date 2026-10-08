import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import { ActionError } from "@/lib/actions/result";
import {
  chatRoomMembers,
  chatRooms,
  messages,
  notifications,
} from "@/lib/db/schema";
import type { DalDatabase } from "./database";
import { createPersonNotification } from "./notifications";

export const requestCooldownMs = 30 * 24 * 60 * 60 * 1000;

export async function findDirectRoom(
  me: string,
  other: string,
  database: DalDatabase,
) {
  const [room] = await database
    .select({ id: chatRooms.id })
    .from(chatRooms)
    .where(
      and(
        eq(chatRooms.kind, "dm"),
        eq(chatRooms.dmLowUserId, sql`least(${me}::uuid, ${other}::uuid)`),
        eq(chatRooms.dmHighUserId, sql`greatest(${me}::uuid, ${other}::uuid)`),
      ),
    );
  return room ?? null;
}

export async function createEmptyDirectRoom(
  me: string,
  other: string,
  now: Date,
  database: DalDatabase,
) {
  const [low, high] = [me, other].sort() as [string, string];
  const [room] = await database
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
  if (room) return { roomId: room.id, created: true };
  const existing = await findDirectRoom(me, other, database);
  if (!existing) throw new ActionError("INTERNAL");
  return { roomId: existing.id, created: false };
}

export function lockDirectMembers(roomId: string, database: DalDatabase) {
  return database
    .select()
    .from(chatRoomMembers)
    .where(eq(chatRoomMembers.roomId, roomId))
    .orderBy(asc(chatRoomMembers.userId))
    .for("update");
}

export async function countRecentRequests(
  userId: string,
  now: Date,
  database: DalDatabase,
) {
  const [row] = await database
    .select({ count: sql<number>`count(*)::int`.mapWith(Number) })
    .from(chatRooms)
    .innerJoin(
      chatRoomMembers,
      and(
        eq(chatRoomMembers.roomId, chatRooms.id),
        sql`${chatRoomMembers.userId} = case when ${chatRooms.dmLowUserId} = ${userId} then ${chatRooms.dmHighUserId} else ${chatRooms.dmLowUserId} end`,
      ),
    )
    .where(
      and(
        eq(chatRooms.kind, "dm"),
        sql`${userId}::uuid in (${chatRooms.dmLowUserId}, ${chatRooms.dmHighUserId})`,
        sql`${chatRoomMembers.requestedAt} > ${new Date(now.getTime() - 86_400_000).toISOString()}::timestamptz`,
      ),
    );
  return row?.count ?? 0;
}

export async function requireRequestCapacity(
  userId: string,
  now: Date,
  database: DalDatabase,
) {
  if ((await countRecentRequests(userId, now, database)) >= 10)
    throw new ActionError("LIMIT_EXCEEDED", { message: "request_daily" });
}

export async function countPendingMessages(
  roomId: string,
  userId: string,
  requestedAt: Date,
  database: DalDatabase,
) {
  const [row] = await database
    .select({ count: sql<number>`count(*)::int`.mapWith(Number) })
    .from(messages)
    .where(
      and(
        eq(messages.roomId, roomId),
        eq(messages.authorId, userId),
        sql`${messages.createdAt} >= ${requestedAt.toISOString()}::timestamptz`,
      ),
    );
  return row?.count ?? 0;
}

export function changeDirectMember(
  input: {
    roomId: string;
    userId: string;
    from: typeof chatRoomMembers.$inferSelect.status;
    status: "active" | "requested" | "declined";
    now: Date;
    newRequest?: boolean;
  },
  database: DalDatabase,
) {
  return database
    .update(chatRoomMembers)
    .set({
      status: input.status,
      statusChangedAt: input.now,
      ...(input.newRequest ? { requestedAt: input.now } : {}),
    })
    .where(
      and(
        eq(chatRoomMembers.roomId, input.roomId),
        eq(chatRoomMembers.userId, input.userId),
        eq(chatRoomMembers.status, input.from),
      ),
    )
    .returning({ userId: chatRoomMembers.userId });
}

export function deleteMessageRequestNotification(
  userId: string,
  actorId: string,
  database: DalDatabase,
) {
  return database
    .delete(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.actorId, actorId),
        eq(notifications.type, "message_request"),
      ),
    )
    .returning({ id: notifications.id });
}

export async function renewMessageRequestNotification(
  input: { userId: string; actorId: string; actorName: string; now: Date },
  database: DalDatabase,
) {
  await deleteMessageRequestNotification(input.userId, input.actorId, database);
  await createPersonNotification(
    { ...input, type: "message_request" },
    database,
  );
}

export async function initializeDirectMembers(
  input: {
    roomId: string;
    senderId: string;
    recipientId: string;
    requested: boolean;
    now: Date;
  },
  database: DalDatabase,
) {
  await database.insert(chatRoomMembers).values([
    {
      roomId: input.roomId,
      userId: input.senderId,
      status: "active",
      joinedAt: input.now,
      statusChangedAt: input.now,
      createdAt: input.now,
    },
    {
      roomId: input.roomId,
      userId: input.recipientId,
      status: input.requested ? "requested" : "active",
      requestedAt: input.requested ? input.now : null,
      joinedAt: input.now,
      statusChangedAt: input.now,
      createdAt: input.now,
    },
  ]);
}

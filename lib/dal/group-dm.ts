import "server-only";
import { avatarColumns } from "./avatar";
import { toAvatar } from "@/lib/avatar";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { ActionError } from "@/lib/actions/result";
import { getDb } from "@/lib/db/client";
import { chatRoomMembers, chatRooms, users } from "@/lib/db/schema";
import type { DalDatabase } from "./database";
import { directRelationshipCondition } from "./direct-permission";
import { blockedBetween } from "./people-blocks";
import { sharesChatSpace } from "./chat-access";
export { sharesChatSpace } from "./chat-access";

export function groupCandidates(
  adder: string,
  ids: readonly string[],
  database: DalDatabase,
) {
  if (!ids.length) return Promise.resolve([]);
  return database
    .select({
      id: users.id,
      name: users.name,
      verified: users.emailVerified,
      canAdd: sql<boolean>`${directRelationshipCondition(sql`${adder}::uuid`, sql`${users.id}`)} and not ${blockedBetween(sql`${adder}::uuid`, sql`${users.id}`)}`,
    })
    .from(users)
    .where(inArray(users.id, [...ids]));
}

export async function requireGroupCandidates(
  adder: string,
  ids: readonly string[],
  database: DalDatabase,
) {
  const candidates = await groupCandidates(adder, ids, database);
  if (
    candidates.length !== ids.length ||
    candidates.some((user) => !user.verified)
  )
    throw new ActionError("NOT_FOUND");
  if (candidates.some((user) => !user.canAdd))
    throw new ActionError("FORBIDDEN");
  return candidates;
}

export async function lockedGroup(roomId: string, database: DalDatabase) {
  const [room] = await database
    .select({
      id: chatRooms.id,
      name: chatRooms.name,
      archivedAt: chatRooms.archivedAt,
    })
    .from(chatRooms)
    .where(and(eq(chatRooms.id, roomId), eq(chatRooms.kind, "group_dm")))
    .for("update");
  return room ?? null;
}

export async function insertGroupRoom(
  name: string | null,
  now: Date,
  database: DalDatabase,
) {
  const [room] = await database
    .insert(chatRooms)
    .values({ kind: "group_dm", name, createdAt: now })
    .returning({ id: chatRooms.id });
  if (!room) throw new ActionError("INTERNAL");
  return room;
}

export async function activateGroupMembers(
  roomId: string,
  userIds: readonly string[],
  now: Date,
  database: DalDatabase,
) {
  if (!userIds.length) return;
  await database
    .insert(chatRoomMembers)
    .values(
      userIds.map((userId) => ({
        roomId,
        userId,
        status: "active" as const,
        joinedAt: now,
        statusChangedAt: now,
        createdAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [chatRoomMembers.roomId, chatRoomMembers.userId],
      set: { status: "active", joinedAt: now, statusChangedAt: now },
      setWhere: eq(chatRoomMembers.status, "left"),
    });
}

export async function leaveGroupMember(
  roomId: string,
  userId: string,
  now: Date,
  database: DalDatabase,
) {
  return database
    .update(chatRoomMembers)
    .set({ status: "left", statusChangedAt: now })
    .where(
      and(
        eq(chatRoomMembers.roomId, roomId),
        eq(chatRoomMembers.userId, userId),
        eq(chatRoomMembers.status, "active"),
      ),
    )
    .returning({ userId: chatRoomMembers.userId });
}

export function updateGroupName(
  roomId: string,
  name: string | null,
  database: DalDatabase,
) {
  return database
    .update(chatRooms)
    .set({ name })
    .where(and(eq(chatRooms.id, roomId), eq(chatRooms.kind, "group_dm")));
}

export function archiveGroup(roomId: string, now: Date, database: DalDatabase) {
  return database
    .update(chatRooms)
    .set({ archivedAt: now })
    .where(
      and(
        eq(chatRooms.id, roomId),
        eq(chatRooms.kind, "group_dm"),
        sql`${chatRooms.archivedAt} is null`,
      ),
    )
    .returning({ id: chatRooms.id });
}

export async function listGroupMembers(
  roomId: string,
  viewerId: string,
  database: DalDatabase = getDb(),
) {
  const rows = await database
    .select({
      userId: users.id,
      name: users.name,
      avatar: avatarColumns(users),
      username: users.username,
      sharesSpace: sharesChatSpace(viewerId, sql`${users.id}`),
    })
    .from(chatRoomMembers)
    .innerJoin(users, eq(users.id, chatRoomMembers.userId))
    .where(
      and(
        eq(chatRoomMembers.roomId, roomId),
        eq(chatRoomMembers.status, "active"),
      ),
    )
    .orderBy(asc(users.name), asc(users.id));
  return rows.map((row) => ({ ...row, avatar: toAvatar(row.avatar) }));
}

import "server-only";

import { and, eq, gt, or, sql } from "drizzle-orm";
import {
  chatRoomMembers,
  chatRooms,
  notifications,
  reports,
  userBlocks,
} from "@/lib/db/schema";
import type { DalDatabase } from "./database";

export async function insertUserBlock(
  me: string,
  other: string,
  now: Date,
  db: DalDatabase,
) {
  return db
    .insert(userBlocks)
    .values({ blockerId: me, blockedId: other, createdAt: now })
    .onConflictDoNothing()
    .returning({ blockedId: userBlocks.blockedId });
}
export async function removeUserBlock(
  me: string,
  other: string,
  db: DalDatabase,
) {
  return db
    .delete(userBlocks)
    .where(and(eq(userBlocks.blockerId, me), eq(userBlocks.blockedId, other)))
    .returning({ blockedId: userBlocks.blockedId });
}
export async function declineBlockedDirectRequests(
  me: string,
  other: string,
  now: Date,
  db: DalDatabase,
) {
  const [room] = await db
    .select({ id: chatRooms.id })
    .from(chatRooms)
    .where(
      and(
        eq(chatRooms.kind, "dm"),
        eq(chatRooms.dmLowUserId, sql`least(${me}::uuid, ${other}::uuid)`),
        eq(chatRooms.dmHighUserId, sql`greatest(${me}::uuid, ${other}::uuid)`),
      ),
    )
    .for("update");
  if (!room) return;
  await db
    .select({ userId: chatRoomMembers.userId })
    .from(chatRoomMembers)
    .where(eq(chatRoomMembers.roomId, room.id))
    .orderBy(chatRoomMembers.userId)
    .for("update");
  await db
    .update(chatRoomMembers)
    .set({ status: "declined", statusChangedAt: now })
    .where(
      and(
        eq(chatRoomMembers.roomId, room.id),
        eq(chatRoomMembers.status, "requested"),
      ),
    );
}
export async function deleteBlockedNotifications(
  me: string,
  other: string,
  cancelOwnFriendRequest: boolean,
  db: DalDatabase,
) {
  const incoming = and(
    eq(notifications.userId, me),
    eq(notifications.actorId, other),
  );
  const outgoing = and(
    eq(notifications.userId, other),
    eq(notifications.actorId, me),
  );
  return db
    .delete(notifications)
    .where(
      or(
        and(eq(notifications.type, "message_request"), or(incoming, outgoing)),
        and(
          eq(notifications.type, "friend_request"),
          cancelOwnFriendRequest ? or(incoming, outgoing) : incoming,
        ),
      ),
    )
    .returning({ id: notifications.id });
}
export async function hasMessageReport(
  me: string,
  messageId: string,
  db: DalDatabase,
) {
  const [row] = await db
    .select({ id: reports.id })
    .from(reports)
    .where(and(eq(reports.reporterId, me), eq(reports.messageId, messageId)))
    .limit(1);
  return Boolean(row);
}
export async function countRecentReports(
  me: string,
  now: Date,
  db: DalDatabase,
) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(reports)
    .where(
      and(
        eq(reports.reporterId, me),
        gt(reports.createdAt, new Date(now.getTime() - 86_400_000)),
      ),
    );
  return row!.count;
}
export async function insertReport(
  input: {
    reporterId: string;
    targetUserId: string;
    messageId?: string;
    reason: "spam" | "harassment" | "inappropriate" | "other";
    detail: string | null;
    now: Date;
  },
  db: DalDatabase,
) {
  const { now, ...values } = input;
  await db
    .insert(reports)
    .values({ ...values, createdAt: now })
    .onConflictDoNothing();
}

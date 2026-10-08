import "server-only";

import { and, count, eq, isNull, or, sql } from "drizzle-orm";
import { ActionError } from "@/lib/actions/result";
import {
  chatRooms,
  chatSpaceInvites,
  chatSpaceMembers,
  notifications,
} from "@/lib/db/schema";
import type { DalDatabase } from "./database";

export async function readChannelSpace(roomId: string, database: DalDatabase) {
  const [room] = await database
    .select({ spaceId: chatRooms.spaceId })
    .from(chatRooms)
    .where(and(eq(chatRooms.id, roomId), eq(chatRooms.kind, "text")));
  if (!room?.spaceId) throw new ActionError("NOT_FOUND");
  return room.spaceId;
}

export async function insertTextChannel(
  input: {
    spaceId: string;
    name: string;
    topic?: string | null;
    adminOnly?: boolean;
    now: Date;
  },
  database: DalDatabase,
) {
  const [total] = await database
    .select({ count: count() })
    .from(chatRooms)
    .where(
      and(
        eq(chatRooms.spaceId, input.spaceId),
        eq(chatRooms.kind, "text"),
        isNull(chatRooms.archivedAt),
      ),
    );
  if ((total?.count ?? 0) >= 50)
    throw new ActionError("LIMIT_EXCEEDED", { message: "channel_count" });
  const [room] = await database
    .insert(chatRooms)
    .values({
      kind: "text",
      spaceId: input.spaceId,
      name: input.name,
      topic: input.topic,
      adminOnly: input.adminOnly,
      createdAt: input.now,
    })
    .returning({ roomId: chatRooms.id });
  if (!room) throw new ActionError("INTERNAL");
  return room;
}

export async function changeTextChannel(
  roomId: string,
  spaceId: string,
  values: {
    name?: string;
    topic?: string | null;
    adminOnly?: boolean;
    archivedAt?: Date;
  },
  database: DalDatabase,
) {
  const [room] = await database
    .select({ archivedAt: chatRooms.archivedAt })
    .from(chatRooms)
    .where(
      and(
        eq(chatRooms.id, roomId),
        eq(chatRooms.spaceId, spaceId),
        eq(chatRooms.kind, "text"),
      ),
    )
    .for("update");
  if (!room) throw new ActionError("NOT_FOUND");
  if (room.archivedAt) {
    if (values.archivedAt) return false;
    throw new ActionError("FORBIDDEN");
  }
  const rows = await database
    .update(chatRooms)
    .set(values)
    .where(
      and(
        eq(chatRooms.id, roomId),
        eq(chatRooms.spaceId, spaceId),
        isNull(chatRooms.archivedAt),
      ),
    )
    .returning({ id: chatRooms.id });
  return rows.length > 0;
}

export async function banCommunityMember(
  spaceId: string,
  userId: string,
  now: Date,
  database: DalDatabase,
) {
  const rows = await database
    .update(chatSpaceMembers)
    .set({ status: "banned", role: "member", statusChangedAt: now })
    .where(
      and(
        eq(chatSpaceMembers.spaceId, spaceId),
        eq(chatSpaceMembers.userId, userId),
        eq(chatSpaceMembers.status, "active"),
      ),
    )
    .returning({ userId: chatSpaceMembers.userId });
  if (!rows.length) throw new ActionError("NOT_FOUND");
  await database
    .update(chatSpaceInvites)
    .set({ revokedAt: now })
    .where(
      and(
        eq(chatSpaceInvites.spaceId, spaceId),
        isNull(chatSpaceInvites.revokedAt),
        or(
          eq(chatSpaceInvites.targetUserId, userId),
          and(
            eq(chatSpaceInvites.createdBy, userId),
            isNull(chatSpaceInvites.targetUserId),
          ),
        ),
      ),
    );
  await database
    .delete(notifications)
    .where(
      and(
        eq(notifications.type, "space_invite"),
        sql`${notifications.data}->>'inviteCode' in (select code from ${chatSpaceInvites} where ${chatSpaceInvites.spaceId} = ${spaceId} and (${chatSpaceInvites.revokedAt} is not null or ${notifications.userId} = ${userId}::uuid))`,
      ),
    );
}

export async function unbanCommunityMember(
  spaceId: string,
  userId: string,
  database: DalDatabase,
) {
  const rows = await database
    .delete(chatSpaceMembers)
    .where(
      and(
        eq(chatSpaceMembers.spaceId, spaceId),
        eq(chatSpaceMembers.userId, userId),
        eq(chatSpaceMembers.status, "banned"),
      ),
    )
    .returning({ userId: chatSpaceMembers.userId });
  if (!rows.length) throw new ActionError("NOT_FOUND");
}

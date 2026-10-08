import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import { ActionError } from "@/lib/actions/result";
import { chatRooms, chatSpaces, messages, users } from "@/lib/db/schema";
import type { DalDatabase } from "./database";

export async function createTeamSpace(teamId: string, database: DalDatabase) {
  await database
    .insert(chatSpaces)
    .values({ kind: "team", teamId })
    .onConflictDoNothing({ target: chatSpaces.teamId });
  const [space] = await database
    .select({ id: chatSpaces.id })
    .from(chatSpaces)
    .where(eq(chatSpaces.teamId, teamId));
  if (!space) throw new ActionError("INTERNAL");
  await database
    .insert(chatRooms)
    .values({ kind: "text", spaceId: space.id, name: "일반" })
    .onConflictDoNothing();
  const [room] = await database
    .select({ id: chatRooms.id })
    .from(chatRooms)
    .where(
      and(
        eq(chatRooms.spaceId, space.id),
        eq(chatRooms.kind, "text"),
        eq(chatRooms.name, "일반"),
        isNull(chatRooms.archivedAt),
      ),
    );
  if (!room) throw new ActionError("INTERNAL");
  return { spaceId: space.id, roomId: room.id };
}

export async function lockMessageAuthor(userId: string, database: DalDatabase) {
  return database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .for("key share");
}

export async function lockRoomForMessage(
  roomId: string,
  database: DalDatabase,
) {
  return database
    .select({ id: chatRooms.id })
    .from(chatRooms)
    .where(eq(chatRooms.id, roomId))
    .for("update");
}

export async function findClientMessage(
  roomId: string,
  clientId: string,
  database: DalDatabase,
) {
  const [message] = await database
    .select()
    .from(messages)
    .where(and(eq(messages.roomId, roomId), eq(messages.clientId, clientId)));
  return message ?? null;
}

export async function insertChatMessage(
  input: {
    roomId: string;
    authorId: string;
    clientId: string;
    body: string;
    now: Date;
  },
  database: DalDatabase,
) {
  const [room] = await database
    .update(chatRooms)
    .set({ lastSeq: sql`${chatRooms.lastSeq} + 1`, lastMessageAt: input.now })
    .where(eq(chatRooms.id, input.roomId))
    .returning({ seq: chatRooms.lastSeq });
  if (!room) throw new ActionError("NOT_FOUND");
  const [message] = await database
    .insert(messages)
    .values({
      roomId: input.roomId,
      seq: room.seq,
      authorId: input.authorId,
      clientId: input.clientId,
      body: input.body,
      createdAt: input.now,
    })
    .returning();
  if (!message) throw new ActionError("INTERNAL");
  return message;
}

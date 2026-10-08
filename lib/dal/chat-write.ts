import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { ActionError } from "@/lib/actions/result";
import {
  chatRooms,
  chatRoomReads,
  chatRoomMembers,
  chatSpaces,
  messageMentions,
  messages,
  users,
} from "@/lib/db/schema";
import type { DalDatabase } from "./database";
import {
  systemMessageDataSchema,
  systemMessageText,
  type SystemMessageData,
} from "@/features/chat/system-messages";
import { emptyMessageDetails, type ChatMessage } from "@/features/chat/types";

export async function createTeamSpace(teamId: string, database: DalDatabase) {
  const [inserted] = await database
    .insert(chatSpaces)
    .values({ kind: "team", teamId })
    .onConflictDoNothing({ target: chatSpaces.teamId })
    .returning({ id: chatSpaces.id });
  const space =
    inserted ??
    (
      await database
        .select({ id: chatSpaces.id })
        .from(chatSpaces)
        .where(eq(chatSpaces.teamId, teamId))
    )[0];
  if (!space) throw new ActionError("INTERNAL");
  if (inserted)
    await database.insert(chatRooms).values([
      { kind: "text", spaceId: space.id, name: "일반" },
      { kind: "voice", spaceId: space.id, name: "회의실", voiceCapacity: 10 },
    ]);
  const [room] = await database
    .select({ id: chatRooms.id })
    .from(chatRooms)
    .where(
      and(
        eq(chatRooms.spaceId, space.id),
        eq(chatRooms.kind, "text"),
        eq(chatRooms.name, "일반"),
      ),
    )
    .orderBy(asc(chatRooms.createdAt), asc(chatRooms.id))
    .limit(1);
  return { spaceId: space.id, roomId: room?.id ?? null };
}

export async function createBranchLounge(
  branchId: string,
  database: DalDatabase,
) {
  const [inserted] = await database
    .insert(chatSpaces)
    .values({ kind: "branch", branchId })
    .onConflictDoNothing({ target: chatSpaces.branchId })
    .returning({ id: chatSpaces.id });
  if (inserted) {
    await database.insert(chatRooms).values([
      { kind: "text", spaceId: inserted.id, name: "라운지" },
      { kind: "text", spaceId: inserted.id, name: "공지", adminOnly: true },
      {
        kind: "voice",
        spaceId: inserted.id,
        name: "라운지-음성",
        voiceCapacity: 10,
      },
    ]);
    return { spaceId: inserted.id };
  }
  const [space] = await database
    .select({ id: chatSpaces.id })
    .from(chatSpaces)
    .where(eq(chatSpaces.branchId, branchId));
  if (!space) throw new ActionError("INTERNAL");
  return { spaceId: space.id };
}

export async function lockUsersForKeyShare(
  ids: readonly string[],
  database: DalDatabase,
) {
  const sorted = [...new Set(ids)].sort();
  if (!sorted.length) return [];
  return database
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.id, sorted))
    .orderBy(asc(users.id))
    .for("key share");
}

export async function lockMessageUsers(
  authorId: string,
  otherIds: readonly string[],
  database: DalDatabase,
) {
  // 요청의 하루 한도와 FK 대상의 잠금을 처음부터 최종 세기로 UUID 순서에 맞춘다.
  for (const id of [
    ...new Set([authorId, ...otherIds].map((value) => value.toLowerCase())),
  ].sort()) {
    await database
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, id))
      .for(id === authorId.toLowerCase() ? "update" : "key share");
  }
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

export function lockRoomMembers(roomId: string, database: DalDatabase) {
  return database
    .select()
    .from(chatRoomMembers)
    .where(eq(chatRoomMembers.roomId, roomId))
    .orderBy(asc(chatRoomMembers.userId))
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
    replyToId?: string;
    mentionsEveryone?: boolean;
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
      replyToId: input.replyToId,
      mentionsEveryone: input.mentionsEveryone,
      createdAt: input.now,
    })
    .returning();
  if (!message) throw new ActionError("INTERNAL");
  return message;
}

export async function insertMessageMentions(
  messageId: string,
  userIds: readonly string[],
  now: Date,
  database: DalDatabase,
) {
  if (!userIds.length) return;
  await database
    .insert(messageMentions)
    .values(userIds.map((userId) => ({ messageId, userId, createdAt: now })))
    .onConflictDoNothing();
}

// 호출자가 사용자 → 방 순서로 잠근 트랜잭션 안에서만 쓴다.
export async function insertSystemMessage(
  input: {
    roomId: string;
    data: SystemMessageData;
    actorId?: string | null;
    now: Date;
  },
  database: DalDatabase,
): Promise<ChatMessage> {
  const data = systemMessageDataSchema.parse(input.data);
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
      kind: "system",
      authorId: null,
      body: systemMessageText(data),
      systemData: data,
      createdAt: input.now,
    })
    .returning({ id: messages.id });
  if (!message) throw new ActionError("INTERNAL");
  if (input.actorId) {
    // 공개 읽음 액션과 달리 작업자·방의 자격은 호출자가 이미 잠금 아래 확인했다.
    await database
      .insert(chatRoomReads)
      .values({
        roomId: input.roomId,
        userId: input.actorId,
        lastReadSeq: room.seq,
        updatedAt: input.now,
        createdAt: input.now,
      })
      .onConflictDoUpdate({
        target: [chatRoomReads.roomId, chatRoomReads.userId],
        set: {
          lastReadSeq: sql`greatest(${chatRoomReads.lastReadSeq}, excluded.last_read_seq)`,
          updatedAt: input.now,
        },
      });
  }
  return {
    ...emptyMessageDetails(),
    id: message.id,
    seq: room.seq,
    authorId: null,
    authorName: null,
    clientId: null,
    kind: "system",
    body: systemMessageText(data),
    systemData: data,
    createdAt: input.now.toISOString(),
  };
}

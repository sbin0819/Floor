import "server-only";

import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  chatRoomReads,
  messageMentions,
  messageReactions,
  messages,
  teamMembers,
} from "@/lib/db/schema";
import type { DalDatabase } from "./database";

export async function findMessageTarget(
  messageId: string,
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .select({ id: messages.id, roomId: messages.roomId })
    .from(messages)
    .where(eq(messages.id, messageId));
  return row ?? null;
}

export async function lockChatMessage(
  messageId: string,
  database: DalDatabase,
) {
  const [row] = await database
    .select()
    .from(messages)
    .where(eq(messages.id, messageId))
    .for("update");
  return row ?? null;
}

export async function listStoredMentions(
  messageId: string,
  database: DalDatabase,
) {
  return database
    .select({ userId: messageMentions.userId })
    .from(messageMentions)
    .where(eq(messageMentions.messageId, messageId));
}

export async function unreadMentionRecipients(
  input: {
    teamId: string;
    roomId: string;
    userIds: string[];
    seq: number;
    createdAt: Date;
  },
  database: DalDatabase,
) {
  if (!input.userIds.length) return [];
  return database
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .leftJoin(
      chatRoomReads,
      and(
        eq(chatRoomReads.roomId, input.roomId),
        eq(chatRoomReads.userId, teamMembers.userId),
      ),
    )
    .where(
      and(
        eq(teamMembers.teamId, input.teamId),
        inArray(teamMembers.userId, input.userIds),
        gt(
          sql`${input.createdAt.toISOString()}::timestamptz`,
          teamMembers.createdAt,
        ),
        or(
          isNull(chatRoomReads.lastReadSeq),
          gt(sql`${input.seq}::int`, chatRoomReads.lastReadSeq),
        ),
      ),
    );
}

export async function editChatMessage(
  input: {
    id: string;
    userId: string;
    body: string;
    mentionsEveryone: boolean;
    now: Date;
  },
  database: DalDatabase,
) {
  const [row] = await database
    .update(messages)
    .set({
      body: input.body,
      mentionsEveryone: input.mentionsEveryone,
      editedAt: input.now,
    })
    .where(
      and(
        eq(messages.id, input.id),
        eq(messages.authorId, input.userId),
        eq(messages.kind, "text"),
        isNull(messages.deletedAt),
      ),
    )
    .returning({ id: messages.id });
  return row ?? null;
}

export async function removeMessageMentions(
  messageId: string,
  database: DalDatabase,
) {
  await database
    .delete(messageMentions)
    .where(eq(messageMentions.messageId, messageId));
}

export async function deleteChatMessage(
  input: { id: string; userId: string; admin: boolean; now: Date },
  database: DalDatabase,
) {
  const [row] = await database
    .update(messages)
    .set({
      body: "",
      mentionsEveryone: false,
      deletedAt: input.now,
      deletedBy: input.userId,
    })
    .where(
      and(
        eq(messages.id, input.id),
        eq(messages.kind, "text"),
        isNull(messages.deletedAt),
        input.admin ? undefined : eq(messages.authorId, input.userId),
      ),
    )
    .returning({ id: messages.id });
  if (!row) return false;
  await database
    .delete(messageReactions)
    .where(eq(messageReactions.messageId, input.id));
  await removeMessageMentions(input.id, database);
  return true;
}

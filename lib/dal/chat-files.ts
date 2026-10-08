import "server-only";

import { and, desc, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { messageAttachments, messages, users } from "@/lib/db/schema";
import { readableRoomCondition } from "./chat-access";
import type { DalDatabase } from "./database";

export async function readDownloadAttachment(
  attachmentId: string,
  userId: string,
  cutoff: Date,
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .select({
      id: messageAttachments.id,
      name: messageAttachments.name,
      size: messageAttachments.size,
      kind: messageAttachments.kind,
      contentType: messageAttachments.contentType,
      storageKey: messageAttachments.storageKey,
    })
    .from(messageAttachments)
    .where(
      and(
        eq(messageAttachments.id, attachmentId),
        isNotNull(messageAttachments.uploadedAt),
        or(
          and(
            isNull(messageAttachments.messageId),
            eq(messageAttachments.uploaderId, userId),
            gt(messageAttachments.createdAt, cutoff),
          ),
          and(
            isNotNull(messageAttachments.messageId),
            readableRoomCondition(userId, sql`${messageAttachments.roomId}`),
            sql`exists (select 1 from messages download_message where download_message.id = ${messageAttachments.messageId}
          and download_message.room_id = ${messageAttachments.roomId} and download_message.deleted_at is null)`,
          ),
        ),
      ),
    )
    .limit(1);
  return row ?? null;
}

export function listRoomFiles(
  roomId: string,
  userId: string,
  query: {
    kind: "all" | "image" | "file";
    before?: { seq: number; position: number };
  },
  database: DalDatabase = getDb(),
) {
  return database
    .select({
      id: messageAttachments.id,
      name: messageAttachments.name,
      size: messageAttachments.size,
      kind: messageAttachments.kind,
      width: messageAttachments.width,
      height: messageAttachments.height,
      uploaderName: users.name,
      sentAt: messages.createdAt,
      messageId: messages.id,
      seq: messages.seq,
      position: messageAttachments.position,
    })
    .from(messageAttachments)
    .innerJoin(
      messages,
      and(
        eq(messages.id, messageAttachments.messageId),
        eq(messages.roomId, messageAttachments.roomId),
      ),
    )
    .innerJoin(users, eq(users.id, messageAttachments.uploaderId))
    .where(
      and(
        eq(messages.roomId, roomId),
        isNull(messages.deletedAt),
        isNotNull(messageAttachments.uploadedAt),
        readableRoomCondition(userId, sql`${messages.roomId}`),
        query.kind === "all"
          ? undefined
          : eq(messageAttachments.kind, query.kind),
        query.before
          ? sql`(${messages.seq}, ${messageAttachments.position}) < (${query.before.seq}, ${query.before.position})`
          : undefined,
      ),
    )
    .orderBy(desc(messages.seq), desc(messageAttachments.position))
    .limit(31);
}

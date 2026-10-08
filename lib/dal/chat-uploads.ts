import "server-only";

import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { messageAttachments, users } from "@/lib/db/schema";
import type { DalDatabase } from "./database";

export type UploadRow = typeof messageAttachments.$inferSelect;

export async function lockUploadQuota(userId: string, database: DalDatabase) {
  const [user] = await database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .for("no key update");
  return user ?? null;
}

export function removeExpiredUploads(
  userId: string,
  cutoff: Date,
  database: DalDatabase,
) {
  const ids = database
    .select({ id: messageAttachments.id })
    .from(messageAttachments)
    .where(
      and(
        eq(messageAttachments.uploaderId, userId),
        isNull(messageAttachments.messageId),
        lte(messageAttachments.createdAt, cutoff),
      ),
    )
    .orderBy(asc(messageAttachments.createdAt), asc(messageAttachments.id))
    .limit(20);
  return database
    .delete(messageAttachments)
    .where(
      and(
        inArray(messageAttachments.id, ids),
        eq(messageAttachments.uploaderId, userId),
        isNull(messageAttachments.messageId),
        lte(messageAttachments.createdAt, cutoff),
      ),
    )
    .returning({ storageKey: messageAttachments.storageKey });
}

export async function totalUploadBytes(
  userId: string,
  cutoff: Date,
  database: DalDatabase,
) {
  const [row] = await database
    .select({
      size: sql<number>`coalesce(sum(${messageAttachments.size}), 0)::double precision`,
    })
    .from(messageAttachments)
    .where(
      and(
        eq(messageAttachments.uploaderId, userId),
        or(
          isNotNull(messageAttachments.messageId),
          gt(messageAttachments.createdAt, cutoff),
        ),
      ),
    );
  return row?.size ?? 0;
}

export function insertPendingUploads(
  rows: (typeof messageAttachments.$inferInsert)[],
  database: DalDatabase,
) {
  return database.insert(messageAttachments).values(rows).returning();
}

export function readOwnedUploads(
  userId: string,
  ids: readonly string[],
  database: DalDatabase = getDb(),
) {
  return database
    .select()
    .from(messageAttachments)
    .where(
      and(
        eq(messageAttachments.uploaderId, userId),
        inArray(messageAttachments.id, [...ids]),
      ),
    );
}

export async function completePendingUpload(
  input: {
    attachmentId: string;
    userId: string;
    now: Date;
    cutoff: Date;
    kind: "image" | "file";
    contentType: string;
    width: number | null;
    height: number | null;
  },
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .update(messageAttachments)
    .set({
      uploadedAt: input.now,
      kind: input.kind,
      contentType: input.contentType,
      width: input.width,
      height: input.height,
    })
    .where(
      and(
        eq(messageAttachments.id, input.attachmentId),
        eq(messageAttachments.uploaderId, input.userId),
        isNull(messageAttachments.uploadedAt),
        isNull(messageAttachments.messageId),
        gt(messageAttachments.createdAt, input.cutoff),
      ),
    )
    .returning();
  return row ?? null;
}

export function discardUnattachedUploads(
  userId: string,
  ids: readonly string[],
  database: DalDatabase = getDb(),
) {
  return database
    .delete(messageAttachments)
    .where(
      and(
        eq(messageAttachments.uploaderId, userId),
        inArray(messageAttachments.id, [...ids]),
        isNull(messageAttachments.messageId),
      ),
    )
    .returning({ storageKey: messageAttachments.storageKey });
}

export async function rejectPendingUpload(
  userId: string,
  attachmentId: string,
  database: DalDatabase = getDb(),
) {
  return database
    .delete(messageAttachments)
    .where(
      and(
        eq(messageAttachments.id, attachmentId),
        eq(messageAttachments.uploaderId, userId),
        isNull(messageAttachments.uploadedAt),
        isNull(messageAttachments.messageId),
      ),
    )
    .returning({ storageKey: messageAttachments.storageKey });
}

import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { messageAttachments } from "@/lib/db/schema";
import type { DalDatabase } from "./database";

export async function lockMessageAttachments(
  ids: readonly string[],
  database: DalDatabase,
) {
  if (!ids.length) return [];
  return database
    .select()
    .from(messageAttachments)
    .where(inArray(messageAttachments.id, [...ids]))
    .orderBy(messageAttachments.id)
    .for("update");
}

export async function attachMessageFiles(
  ids: readonly string[],
  messageId: string,
  database: DalDatabase,
) {
  if (!ids.length) return;
  const order = sql.join(
    ids.map((id, position) => sql`when ${id}::uuid then ${position}::smallint`),
    sql` `,
  );
  await database
    .update(messageAttachments)
    .set({
      messageId,
      position: sql`case ${messageAttachments.id} ${order} end`,
    })
    .where(inArray(messageAttachments.id, [...ids]));
}

export async function messageHasAttachments(
  messageId: string,
  database: DalDatabase,
) {
  const [row] = await database
    .select({ id: messageAttachments.id })
    .from(messageAttachments)
    .where(eq(messageAttachments.messageId, messageId))
    .limit(1);
  return !!row;
}

export async function deleteMessageAttachments(
  messageId: string,
  roomId: string,
  database: DalDatabase,
) {
  return database
    .delete(messageAttachments)
    .where(
      and(
        eq(messageAttachments.messageId, messageId),
        eq(messageAttachments.roomId, roomId),
      ),
    )
    .returning({ storageKey: messageAttachments.storageKey });
}

import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { chatRooms, messages } from "./chat";
import { createdAt, id } from "./common";
import { attachmentKind } from "./enums";
import { users } from "./users";

export const messageAttachments = pgTable(
  "message_attachments",
  {
    id: id(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => chatRooms.id, { onDelete: "cascade" }),
    uploaderId: uuid("uploader_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    messageId: uuid("message_id").references(() => messages.id, {
      onDelete: "cascade",
    }),
    position: smallint("position"),
    storageKey: text("storage_key")
      .notNull()
      .unique("message_attachments_key_unique"),
    name: text("name").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    contentType: text("content_type").notNull(),
    kind: attachmentKind("kind").notNull().default("file"),
    width: integer("width"),
    height: integer("height"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      "message_attachments_position_range",
      sql`${table.position} BETWEEN 0 AND 9`,
    ),
    check(
      "message_attachments_name_length",
      sql`char_length(${table.name}) BETWEEN 1 AND 200`,
    ),
    check(
      "message_attachments_size_range",
      sql`${table.size} BETWEEN 1 AND 26214400`,
    ),
    check(
      "message_attachments_attached",
      sql`${table.messageId} IS NULL OR (${table.position} IS NOT NULL AND ${table.uploadedAt} IS NOT NULL)`,
    ),
    check(
      "message_attachments_image_size",
      sql`(${table.kind} = 'image' AND ${table.width} IS NOT NULL AND ${table.height} IS NOT NULL AND ${table.width} >= 1 AND ${table.height} >= 1) OR (${table.kind} = 'file' AND ${table.width} IS NULL AND ${table.height} IS NULL)`,
    ),
    uniqueIndex("message_attachments_position_unique")
      .on(table.messageId, table.position)
      .where(sql`${table.messageId} IS NOT NULL`),
    index("message_attachments_message_id_idx").on(table.messageId),
    index("message_attachments_uploader_created_idx").on(
      table.uploaderId,
      table.createdAt,
    ),
  ],
);

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { branches } from "./branches";
import { createdAt, id } from "./common";
import { chatRoomKind, chatSpaceKind, messageKind } from "./enums";
import { teams } from "./teams";
import { users } from "./users";

export const chatSpaces = pgTable(
  "chat_spaces",
  {
    id: id(),
    kind: chatSpaceKind("kind").notNull(),
    teamId: uuid("team_id")
      .unique("chat_spaces_team_unique")
      .references(() => teams.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id")
      .unique("chat_spaces_branch_unique")
      .references(() => branches.id, { onDelete: "restrict" }),
    name: text("name"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      "chat_spaces_kind_ref",
      sql`(${table.kind} = 'team' AND ${table.teamId} IS NOT NULL AND ${table.branchId} IS NULL AND ${table.name} IS NULL) OR (${table.kind} = 'branch' AND ${table.branchId} IS NOT NULL AND ${table.teamId} IS NULL AND ${table.name} IS NULL) OR (${table.kind} = 'community' AND ${table.name} IS NOT NULL AND ${table.createdBy} IS NOT NULL AND ${table.teamId} IS NULL AND ${table.branchId} IS NULL)`,
    ),
  ],
);

export const chatRooms = pgTable(
  "chat_rooms",
  {
    id: id(),
    kind: chatRoomKind("kind").notNull(),
    spaceId: uuid("space_id").references(() => chatSpaces.id, {
      onDelete: "restrict",
    }),
    name: text("name"),
    topic: text("topic"),
    adminOnly: boolean("admin_only").notNull().default(false),
    lastSeq: bigint("last_seq", { mode: "number" }).notNull().default(0),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      "chat_rooms_kind_ref",
      sql`${table.kind} NOT IN ('text', 'voice') OR (${table.spaceId} IS NOT NULL AND ${table.name} IS NOT NULL)`,
    ),
    check(
      "chat_rooms_name_length",
      sql`(${table.name} IS NULL OR char_length(${table.name}) BETWEEN 1 AND 30) AND (${table.topic} IS NULL OR char_length(${table.topic}) <= 200)`,
    ),
    uniqueIndex("chat_rooms_space_name_unique")
      .on(table.spaceId, sql`lower(${table.name})`)
      .where(sql`${table.archivedAt} IS NULL`),
    index("chat_rooms_space_id_idx").on(table.spaceId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => chatRooms.id, { onDelete: "cascade" }),
    seq: bigint("seq", { mode: "number" }).notNull(),
    authorId: uuid("author_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    kind: messageKind("kind").notNull().default("text"),
    body: text("body").notNull(),
    clientId: text("client_id"),
    createdAt: createdAt(),
  },
  (table) => [
    unique("messages_room_id_seq_unique").on(table.roomId, table.seq),
    uniqueIndex("messages_room_id_client_id_unique")
      .on(table.roomId, table.clientId)
      .where(sql`${table.clientId} IS NOT NULL`),
    check(
      "messages_author_kind",
      sql`(${table.kind} = 'system' AND ${table.authorId} IS NULL) OR (${table.kind} = 'text' AND ${table.authorId} IS NOT NULL)`,
    ),
    check(
      "messages_body_length",
      sql`char_length(${table.body}) BETWEEN 1 AND 4000`,
    ),
  ],
);

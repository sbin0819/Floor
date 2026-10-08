import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { branches } from "./branches";
import { createdAt, id } from "./common";
import {
  chatRoomKind,
  chatMemberStatus,
  chatSpaceKind,
  messageKind,
  reactionEmoji,
} from "./enums";
import { teams } from "./teams";
import { users } from "./users";
import type { SystemMessageData } from "@/features/chat/system-messages";

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
    dmLowUserId: uuid("dm_low_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    dmHighUserId: uuid("dm_high_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      "chat_rooms_kind_ref",
      sql`(${table.kind} IN ('text', 'voice') AND ${table.spaceId} IS NOT NULL AND ${table.name} IS NOT NULL AND ${table.dmLowUserId} IS NULL AND ${table.dmHighUserId} IS NULL) OR (${table.kind} = 'dm' AND ${table.dmLowUserId} IS NOT NULL AND ${table.dmHighUserId} IS NOT NULL AND ${table.dmLowUserId} < ${table.dmHighUserId} AND ${table.spaceId} IS NULL AND ${table.name} IS NULL) OR (${table.kind} = 'group_dm' AND ${table.spaceId} IS NULL AND ${table.dmLowUserId} IS NULL AND ${table.dmHighUserId} IS NULL) OR ${table.kind} = 'meeting'`,
    ),
    check(
      "chat_rooms_name_length",
      sql`(${table.name} IS NULL OR char_length(${table.name}) BETWEEN 1 AND 30) AND (${table.topic} IS NULL OR char_length(${table.topic}) <= 200)`,
    ),
    uniqueIndex("chat_rooms_space_name_unique")
      .on(table.spaceId, sql`lower(${table.name})`)
      .where(sql`${table.archivedAt} IS NULL`),
    index("chat_rooms_space_id_idx").on(table.spaceId),
    uniqueIndex("chat_rooms_dm_pair_unique")
      .on(table.dmLowUserId, table.dmHighUserId)
      .where(sql`${table.kind} = 'dm'`),
    index("chat_rooms_dm_high_user_id_idx").on(table.dmHighUserId),
  ],
);

export const chatRoomMembers = pgTable(
  "chat_room_members",
  {
    roomId: uuid("room_id")
      .notNull()
      .references(() => chatRooms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: chatMemberStatus("status").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull(),
    statusChangedAt: timestamp("status_changed_at", {
      withTimezone: true,
    }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.roomId, table.userId] }),
    index("chat_room_members_user_id_idx").on(table.userId),
    check(
      "chat_room_members_requested",
      sql`${table.status} NOT IN ('requested', 'declined') OR ${table.requestedAt} IS NOT NULL`,
    ),
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
    systemData: jsonb("system_data").$type<SystemMessageData>(),
    clientId: text("client_id"),
    replyToId: uuid("reply_to_id").references((): AnyPgColumn => messages.id, {
      onDelete: "set null",
    }),
    mentionsEveryone: boolean("mentions_everyone").notNull().default(false),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, {
      onDelete: "restrict",
    }),
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
      sql`(${table.deletedAt} IS NULL AND char_length(${table.body}) BETWEEN 1 AND 4000) OR (${table.deletedAt} IS NOT NULL AND ${table.body} = '')`,
    ),
    check(
      "messages_system_data",
      sql`(${table.kind} = 'system' AND ${table.systemData} IS NOT NULL) OR (${table.kind} = 'text' AND ${table.systemData} IS NULL)`,
    ),
    index("messages_everyone_idx")
      .on(table.roomId, table.seq)
      .where(sql`${table.mentionsEveryone} AND ${table.deletedAt} IS NULL`),
  ],
);

export const messageReactions = pgTable(
  "message_reactions",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    emoji: reactionEmoji("emoji").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.userId, table.emoji] }),
  ],
);

export const messageMentions = pgTable(
  "message_mentions",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.userId] }),
    index("message_mentions_user_id_message_id_idx").on(
      table.userId,
      table.messageId,
    ),
  ],
);

export const chatSpacePrefs = pgTable(
  "chat_space_prefs",
  {
    spaceId: uuid("space_id")
      .notNull()
      .references(() => chatSpaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    muted: boolean("muted").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.spaceId, table.userId] })],
);

export const chatRoomReads = pgTable(
  "chat_room_reads",
  {
    roomId: uuid("room_id")
      .notNull()
      .references(() => chatRooms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    lastReadSeq: bigint("last_read_seq", { mode: "number" }).notNull(),
    muted: boolean("muted").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.roomId, table.userId] }),
    check("chat_room_reads_seq_valid", sql`${table.lastReadSeq} >= 0`),
  ],
);

import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  primaryKey,
  timestamp,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id } from "./common";
import { friendshipStatus, reportReason } from "./enums";
import { users } from "./users";
import { messages } from "./chat";

export const friendships = pgTable(
  "friendships",
  {
    userLowId: uuid("user_low_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    userHighId: uuid("user_high_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: friendshipStatus("status").notNull(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    statusChangedAt: timestamp("status_changed_at", {
      withTimezone: true,
    }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.userLowId, table.userHighId] }),
    check("friendships_order", sql`${table.userLowId} < ${table.userHighId}`),
    check(
      "friendships_requester",
      sql`${table.requestedBy} IN (${table.userLowId}, ${table.userHighId})`,
    ),
    index("friendships_user_high_id_idx").on(table.userHighId),
    index("friendships_requester_idx").on(table.requestedBy, table.requestedAt),
  ],
);

export const userBlocks = pgTable(
  "user_blocks",
  {
    blockerId: uuid("blocker_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    blockedId: uuid("blocked_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.blockerId, table.blockedId] }),
    index("user_blocks_blocked_id_idx").on(table.blockedId),
    check(
      "user_blocks_not_self",
      sql`${table.blockerId} <> ${table.blockedId}`,
    ),
  ],
);

export const reports = pgTable(
  "reports",
  {
    id: id(),
    reporterId: uuid("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    targetUserId: uuid("target_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    messageId: uuid("message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
    reason: reportReason("reason").notNull(),
    detail: text("detail"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("reports_message_unique")
      .on(table.reporterId, table.messageId)
      .where(sql`${table.messageId} IS NOT NULL`),
    index("reports_target_user_id_idx").on(table.targetUserId),
    index("reports_reporter_created_idx").on(table.reporterId, table.createdAt),
    check(
      "reports_detail_length",
      sql`${table.detail} IS NULL OR char_length(${table.detail}) <= 500`,
    ),
  ],
);

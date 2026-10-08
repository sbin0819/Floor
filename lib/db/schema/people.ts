import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt } from "./common";
import { friendshipStatus } from "./enums";
import { users } from "./users";

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

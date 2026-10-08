import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { chatRooms } from "./chat";
import { id } from "./common";
import { callKind } from "./enums";
import { users } from "./users";

export const callSessions = pgTable(
  "call_sessions",
  {
    id: id(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => chatRooms.id, { onDelete: "cascade" }),
    kind: callKind("kind").notNull(),
    startedBy: uuid("started_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("call_sessions_one_open")
      .on(table.roomId)
      .where(sql`${table.endedAt} IS NULL`),
    check(
      "call_sessions_time",
      sql`${table.endedAt} IS NULL OR ${table.endedAt} >= ${table.startedAt}`,
    ),
  ],
);

export const callParticipants = pgTable(
  "call_participants",
  {
    id: id(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => callSessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull(),
    leftAt: timestamp("left_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("call_participants_one_active")
      .on(table.userId)
      .where(sql`${table.leftAt} IS NULL`),
    index("call_participants_session_id_idx").on(table.sessionId),
  ],
);

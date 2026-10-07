import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { bookings } from "./bookings";
import { floors } from "./branches";
import { createdAt, id } from "./common";
import { chatRoomKind, messageKind } from "./enums";
import { spaces } from "./spaces";
import { teams } from "./teams";
import { users } from "./users";

export const chatRooms = pgTable(
  "chat_rooms",
  {
    id: id(),
    kind: chatRoomKind("kind").notNull(),
    bookingId: uuid("booking_id")
      .unique()
      .references(() => bookings.id, { onDelete: "restrict" }),
    floorId: uuid("floor_id").references(() => floors.id, {
      onDelete: "restrict",
    }),
    teamId: uuid("team_id").references(() => teams.id, {
      onDelete: "restrict",
    }),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      "chat_rooms_kind_ref",
      sql`(${table.kind} <> 'booking' OR ${table.bookingId} IS NOT NULL) AND (${table.kind} <> 'channel' OR ${table.floorId} IS NOT NULL) AND (${table.kind} <> 'team' OR ${table.teamId} IS NOT NULL)`,
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
    spaceRef: uuid("space_ref").references(() => spaces.id, {
      onDelete: "restrict",
    }),
    clientId: text("client_id"),
    createdAt: createdAt(),
  },
  (table) => [
    unique("messages_room_id_seq_unique").on(table.roomId, table.seq),
    uniqueIndex("messages_room_id_client_id_unique")
      .on(table.roomId, table.clientId)
      .where(sql`${table.clientId} IS NOT NULL`),
  ],
);

export const callSessions = pgTable(
  "call_sessions",
  {
    id: id(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => chatRooms.id, { onDelete: "restrict" }),
    livekitRoom: text("livekit_room").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("call_sessions_one_active")
      .on(table.roomId)
      .where(sql`${table.endedAt} IS NULL`),
  ],
);

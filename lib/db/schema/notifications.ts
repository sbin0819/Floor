import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { NotificationData } from "@/features/notifications/types";
import { bookings } from "./bookings";
import { id } from "./common";
import { notificationType } from "./enums";
import { users } from "./users";

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    type: notificationType("type").notNull(),
    bookingId: uuid("booking_id").references(() => bookings.id, {
      onDelete: "cascade",
    }),
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    data: jsonb("data").$type<NotificationData>().notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (table) => [
    index("notifications_user_scheduled_idx").on(
      table.userId,
      table.scheduledFor.desc(),
    ),
    index("notifications_unread_user_idx")
      .on(table.userId)
      .where(sql`${table.readAt} is null`),
    index("notifications_booking_id_idx").on(table.bookingId),
    uniqueIndex("notifications_reminder_unique")
      .on(table.userId, table.bookingId, table.scheduledFor)
      .where(sql`${table.type} = 'booking_reminder'`),
  ],
);

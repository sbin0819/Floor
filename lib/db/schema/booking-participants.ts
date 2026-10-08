import { index, pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { bookings } from "./bookings";
import { users } from "./users";
import { createdAt } from "./common";

export const bookingParticipants = pgTable(
  "booking_participants",
  {
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.bookingId, table.userId] }),
    index("booking_participants_user_id_idx").on(table.userId),
  ],
);

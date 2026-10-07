import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { tstzrange } from "../range";
import { createdAt, id } from "./common";
import { bookingStatus } from "./enums";
import { spaces } from "./spaces";
import { teams } from "./teams";
import { users } from "./users";

export const bookings = pgTable(
  "bookings",
  {
    id: id(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    teamId: uuid("team_id").references(() => teams.id, {
      onDelete: "restrict",
    }),
    during: tstzrange("during").notNull(),
    title: text("title"),
    status: bookingStatus("status").notNull().default("confirmed"),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      "bookings_during_valid",
      sql`NOT isempty(${table.during}) AND NOT lower_inf(${table.during}) AND NOT upper_inf(${table.during}) AND lower_inc(${table.during}) AND NOT upper_inc(${table.during})`,
    ),
    index("bookings_user_id_idx").on(table.userId),
    index("bookings_team_id_idx").on(table.teamId),
  ],
);

export const spaceBlocks = pgTable(
  "space_blocks",
  {
    id: id(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "restrict" }),
    during: tstzrange("during").notNull(),
    reason: text("reason"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      "space_blocks_during_valid",
      sql`NOT isempty(${table.during}) AND NOT lower_inf(${table.during}) AND NOT upper_inf(${table.during}) AND lower_inc(${table.during}) AND NOT upper_inc(${table.during})`,
    ),
    index("space_blocks_space_id_during_idx").using(
      "gist",
      table.spaceId,
      table.during,
    ),
  ],
);

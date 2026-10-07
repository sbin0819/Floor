import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { floors } from "./branches";
import { createdAt, id } from "./common";
import { accessScope, spaceType } from "./enums";

export const spaces = pgTable(
  "spaces",
  {
    id: id(),
    floorId: uuid("floor_id")
      .notNull()
      .references(() => floors.id, { onDelete: "restrict" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => spaces.id, {
      onDelete: "restrict",
    }),
    type: spaceType("type").notNull(),
    name: text("name").notNull(),
    capacity: integer("capacity"),
    bookable: boolean("bookable").notNull().default(true),
    amenities: text("amenities").array().notNull().default([]),
    bookingRules: jsonb("booking_rules")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    access: accessScope("access"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    index("spaces_floor_id_idx").on(table.floorId),
    index("spaces_parent_id_idx").on(table.parentId),
  ],
);

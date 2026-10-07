import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { id } from "./common";
import { spaces } from "./spaces";

export const spacePhotos = pgTable(
  "space_photos",
  {
    id: id(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    alt: text("alt").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    unique("space_photos_space_order_unique").on(
      table.spaceId,
      table.sortOrder,
    ),
    check(
      "space_photos_sort_order_range",
      sql`${table.sortOrder} between 0 and 9`,
    ),
    check(
      "space_photos_path_format",
      sql`${table.path} ~ '^/[a-z0-9/_-]+\\.(webp|png|jpg)$' and ${table.path} !~ '//'`,
    ),
    check(
      "space_photos_alt_length",
      sql`char_length(${table.alt}) between 1 and 120`,
    ),
  ],
);

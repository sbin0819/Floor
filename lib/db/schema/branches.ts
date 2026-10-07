import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id } from "./common";
import { accessScope } from "./enums";
import { floorPlans } from "./floor-plans";
import type { OpenHours } from "@/lib/time/open-hours";

export const branches = pgTable(
  "branches",
  {
    id: id(),
    name: text("name").notNull(),
    address: text("address"),
    timezone: text("timezone").notNull().default("Asia/Seoul"),
    openHours: jsonb("open_hours").$type<OpenHours>().notNull().default({}),
    coverPhotoPath: text("cover_photo_path"),
    coverPhotoAlt: text("cover_photo_alt"),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      "branches_cover_photo_pair",
      sql`(${table.coverPhotoPath} is null) = (${table.coverPhotoAlt} is null)`,
    ),
    check(
      "branches_cover_photo_path_format",
      sql`${table.coverPhotoPath} is null or (${table.coverPhotoPath} ~ '^/[a-z0-9/_-]+\\.(webp|png|jpg)$' and ${table.coverPhotoPath} !~ '//')`,
    ),
    check(
      "branches_cover_photo_alt_length",
      sql`${table.coverPhotoAlt} is null or char_length(${table.coverPhotoAlt}) between 1 and 120`,
    ),
  ],
);

export const floors = pgTable(
  "floors",
  {
    id: id(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    level: integer("level").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    publishedPlanId: uuid("published_plan_id").references(
      (): AnyPgColumn => floorPlans.id,
      { onDelete: "restrict" },
    ),
    access: accessScope("access").notNull().default("everyone"),
    createdAt: createdAt(),
  },
  (table) => [
    unique("floors_branch_id_level_unique").on(table.branchId, table.level),
  ],
);

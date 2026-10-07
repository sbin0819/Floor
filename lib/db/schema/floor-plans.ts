import { sql } from "drizzle-orm";
import {
  jsonb,
  pgTable,
  integer,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";
import { floors } from "./branches";
import { createdAt, id } from "./common";
import { planStatus } from "./enums";
import { users } from "./users";

export const floorPlans = pgTable(
  "floor_plans",
  {
    id: id(),
    floorId: uuid("floor_id")
      .notNull()
      .references(() => floors.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    status: planStatus("status").notNull().default("draft"),
    document: jsonb("document").$type<FloorPlanDocument>().notNull(),
    backgroundImage: text("background_image"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    unique("floor_plans_floor_id_version_unique").on(
      table.floorId,
      table.version,
    ),
    uniqueIndex("floor_plans_one_draft")
      .on(table.floorId)
      .where(sql`${table.status} = 'draft'`),
    uniqueIndex("floor_plans_one_published")
      .on(table.floorId)
      .where(sql`${table.status} = 'published'`),
  ],
);

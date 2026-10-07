import {
  type AnyPgColumn,
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

export const branches = pgTable("branches", {
  id: id(),
  name: text("name").notNull(),
  address: text("address"),
  timezone: text("timezone").notNull().default("Asia/Seoul"),
  openHours: jsonb("open_hours")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  createdAt: createdAt(),
});

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

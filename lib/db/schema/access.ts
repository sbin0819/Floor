import {
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { RoleLimits } from "@/lib/permissions/types";
import { branches } from "./branches";
import { createdAt, id } from "./common";
import { appRole, grantTarget } from "./enums";
import { teams } from "./teams";
import { users } from "./users";

export const branchStaff = pgTable(
  "branch_staff",
  {
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.branchId, table.userId] })],
);

export const roleSettings = pgTable(
  "role_settings",
  {
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    role: appRole("role").notNull(),
    permissions: text("permissions").array().notNull(),
    limits: jsonb("limits").$type<Partial<RoleLimits>>().notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.branchId, table.role] })],
);

export const accessGrants = pgTable(
  "access_grants",
  {
    id: id(),
    targetType: grantTarget("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (table) => [
    unique("access_grants_target_type_target_id_team_id_unique").on(
      table.targetType,
      table.targetId,
      table.teamId,
    ),
  ],
);

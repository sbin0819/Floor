import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { branches } from "./branches";
import { createdAt, id } from "./common";

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    name: text("name").notNull(),
    avatarUrl: text("avatar_url"),
    username: text("username").unique("users_username_unique"),
    usernameChangedAt: timestamp("username_changed_at", { withTimezone: true }),
    defaultBranchId: uuid("default_branch_id").references(() => branches.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check(
      "users_username_format",
      sql`${table.username} ~ '^[a-z0-9._]{3,20}$'`,
    ),
  ],
);

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { branches } from "./branches";
import { createdAt, id } from "./common";
import { avatarColor, userStatus } from "./enums";

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    name: text("name").notNull(),
    avatarUrl: text("avatar_url"),
    avatarColor: avatarColor("avatar_color"),
    avatarPhoto: boolean("avatar_photo").notNull().default(false),
    chatToasts: boolean("chat_toasts").notNull().default(true),
    tabBadge: boolean("tab_badge").notNull().default(true),
    reminderMinutes: smallint("reminder_minutes")
      .array()
      .notNull()
      .default(sql`'{30,10,5,0}'::smallint[]`),
    username: text("username").unique("users_username_unique"),
    usernameChangedAt: timestamp("username_changed_at", { withTimezone: true }),
    status: userStatus("status").notNull().default("online"),
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
      "users_reminder_minutes_valid",
      sql`${table.reminderMinutes} <@ '{30,10,5,0}'::smallint[]`,
    ),
    check(
      "users_username_format",
      sql`${table.username} ~ '^[a-z0-9._]{3,20}$'`,
    ),
  ],
);

import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { branches } from "./branches";
import { createdAt, id } from "./common";

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  defaultBranchId: uuid("default_branch_id").references(() => branches.id, {
    onDelete: "set null",
  }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

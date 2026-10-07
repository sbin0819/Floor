import { pgTable, text } from "drizzle-orm/pg-core";
import { createdAt, id } from "./common";

export const users = pgTable("users", {
  id: id(),
  authId: text("auth_id").unique(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: createdAt(),
});

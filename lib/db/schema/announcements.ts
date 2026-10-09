import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import type { AnnouncementAudience } from "@/features/admin/announcement-types";
import { branches } from "./branches";
import { messages } from "./chat";
import { createdAt, id } from "./common";
import { users } from "./users";

export const announcements = pgTable(
  "announcements",
  {
    id: id(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    loungeMessageId: uuid("lounge_message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
    audience: jsonb("audience").$type<AnnouncementAudience>(),
    recipientCount: integer("recipient_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      "announcements_text_length",
      sql`char_length(${table.title}) between 1 and 60 and char_length(${table.body}) between 1 and 500`,
    ),
    index("announcements_branch_created_idx").on(
      table.branchId,
      table.createdAt.desc(),
    ),
  ],
);

import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id } from "./common";
import { branches } from "./branches";
import { joinRequestStatus, teamRole } from "./enums";
import { users } from "./users";

export const teams = pgTable(
  "teams",
  {
    id: id(),
    name: text("name").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    homeBranchId: uuid("home_branch_id").references(() => branches.id, {
      onDelete: "restrict",
    }),
    headcount: integer("headcount"),
    contactPhone: text("contact_phone"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("teams_name_unique").on(sql`lower(${table.name})`),
    check(
      "teams_headcount_valid",
      sql`${table.headcount} is null or ${table.headcount} between 1 and 1000`,
    ),
  ],
);

export const teamMembers = pgTable(
  "team_members",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    role: teamRole("role").notNull().default("member"),
    title: text("title"),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.userId] }),
    index("team_members_user_id_idx").on(table.userId),
  ],
);

export const teamInvites = pgTable(
  "team_invites",
  {
    id: id(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    email: text("email"),
    token: text("token").notNull().unique(),
    message: text("message"),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '7 days'`),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    declinedAt: timestamp("declined_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("team_invites_one_pending")
      .on(table.teamId, table.email)
      .where(
        sql`${table.email} is not null and ${table.acceptedAt} is null and ${table.declinedAt} is null and ${table.revokedAt} is null`,
      ),
    index("team_invites_email_idx").on(table.email),
  ],
);

export const teamJoinRequests = pgTable(
  "team_join_requests",
  {
    id: id(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    message: text("message"),
    status: joinRequestStatus("status").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("team_join_requests_one_pending")
      .on(table.teamId, table.userId)
      .where(sql`${table.status} = 'pending'`),
    index("team_join_requests_user_id_idx").on(table.userId),
  ],
);

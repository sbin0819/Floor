import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  isNull,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db/client";
import {
  branches,
  teamJoinRequests,
  teamMembers,
  teams,
} from "@/lib/db/schema";
import type { DalDatabase } from "./database";
import { teamDisplayName } from "./team-name";

export function listMyTeamSummaries(
  userId: string,
  database: DalDatabase = getDb(),
) {
  const members = alias(teamMembers, "counted_members");
  const memberCount = database
    .select({ count: count() })
    .from(members)
    .where(eq(members.teamId, teams.id));
  return database
    .select({
      id: teams.id,
      name: teamDisplayName(teams),
      role: teamMembers.role,
      homeBranchName: branches.name,
      memberCount: sql<number>`(${memberCount})`.mapWith(Number),
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .leftJoin(branches, eq(teams.homeBranchId, branches.id))
    .where(and(eq(teamMembers.userId, userId), isNull(teams.deletedAt)))
    .orderBy(asc(teams.name), asc(teams.id));
}

export function listTeamHubRequests(
  userId: string,
  now: Date,
  database: DalDatabase = getDb(),
) {
  const newer = alias(teamJoinRequests, "newer_request");
  const newerRequest = database
    .select({ id: newer.id })
    .from(newer)
    .where(
      and(
        eq(newer.userId, userId),
        eq(newer.teamId, teamJoinRequests.teamId),
        or(
          sql`${newer.createdAt} > ${teamJoinRequests.createdAt}`,
          and(
            eq(newer.createdAt, teamJoinRequests.createdAt),
            sql`${newer.id} > ${teamJoinRequests.id}`,
          ),
        ),
      ),
    );
  const membership = database
    .select({ id: teamMembers.userId })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.teamId, teamJoinRequests.teamId),
        eq(teamMembers.userId, userId),
      ),
    );
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return database
    .select({
      id: teamJoinRequests.id,
      teamId: teams.id,
      teamName: teamDisplayName(teams),
      message: teamJoinRequests.message,
      createdAt: teamJoinRequests.createdAt,
      status: teamJoinRequests.status,
      decidedAt: teamJoinRequests.decidedAt,
    })
    .from(teamJoinRequests)
    .innerJoin(teams, eq(teamJoinRequests.teamId, teams.id))
    .where(
      and(
        eq(teamJoinRequests.userId, userId),
        isNull(teams.deletedAt),
        notExists(newerRequest),
        or(
          eq(teamJoinRequests.status, "pending"),
          and(
            eq(teamJoinRequests.status, "rejected"),
            gte(teamJoinRequests.decidedAt, cutoff),
            notExists(membership),
          ),
        ),
      ),
    )
    .orderBy(desc(teamJoinRequests.createdAt), desc(teamJoinRequests.id));
}

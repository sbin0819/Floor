import "server-only";

import { and, asc, desc, eq, gt, ilike, isNull, sql } from "drizzle-orm";
import type { DalDatabase } from "@/lib/dal/database";
import { getDb } from "@/lib/db/client";
import {
  branches,
  teamInvites,
  teamJoinRequests,
  teamMembers,
  teams,
  users,
} from "@/lib/db/schema";
import { normalizeTeamName } from "@/lib/teams/normalize";
import { isQueryableInviteToken } from "@/lib/teams/invite-token";

export function pendingInvite() {
  return and(
    isNull(teamInvites.acceptedAt),
    isNull(teamInvites.declinedAt),
    isNull(teamInvites.revokedAt),
  );
}

export function usableInvite(email: string, now?: Date) {
  return and(
    pendingInvite(),
    eq(teamInvites.email, email.toLowerCase()),
    gt(teamInvites.expiresAt, now ?? sql`statement_timestamp()`),
  );
}

export async function getTeamIdentity(
  teamId: string,
  database: DalDatabase = getDb(),
) {
  const [team] = await database
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  return team ?? null;
}

export async function getTeamById(
  teamId: string,
  database: DalDatabase = getDb(),
) {
  const [team] = await database
    .select({
      id: teams.id,
      name: teams.name,
      homeBranchId: teams.homeBranchId,
      headcount: teams.headcount,
      createdBy: teams.createdBy,
      createdAt: teams.createdAt,
    })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  return team ?? null;
}

export async function getTeamContact(
  teamId: string,
  database: DalDatabase = getDb(),
) {
  const [team] = await database
    .select({ contactPhone: teams.contactPhone })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  return team ?? null;
}

export async function getTeamMember(
  teamId: string,
  userId: string,
  database: DalDatabase = getDb(),
) {
  const [member] = await database
    .select({ role: teamMembers.role, title: teamMembers.title })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .limit(1);
  return member ?? null;
}

export function listMyTeams(userId: string, database: DalDatabase = getDb()) {
  return database
    .select({ id: teams.id, name: teams.name, role: teamMembers.role })
    .from(teamMembers)
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .where(eq(teamMembers.userId, userId))
    .orderBy(asc(teams.name), asc(teams.id));
}

export function listTeamMembers(
  teamId: string,
  database: DalDatabase = getDb(),
) {
  return database
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: teamMembers.role,
      title: teamMembers.title,
    })
    .from(teamMembers)
    .innerJoin(users, eq(teamMembers.userId, users.id))
    .where(eq(teamMembers.teamId, teamId))
    .orderBy(asc(users.name), asc(users.id));
}

export function searchTeams(query: string, database: DalDatabase = getDb()) {
  const literal = normalizeTeamName(query).replace(/[\\%_]/g, "\\$&");
  return database
    .select({ id: teams.id, name: teams.name, homeBranchName: branches.name })
    .from(teams)
    .leftJoin(branches, eq(teams.homeBranchId, branches.id))
    .where(ilike(teams.name, `%${literal}%`))
    .orderBy(asc(teams.name), asc(teams.id))
    .limit(10);
}

export async function getJoinRequestById(
  requestId: string,
  database: DalDatabase = getDb(),
) {
  const [request] = await database
    .select()
    .from(teamJoinRequests)
    .where(eq(teamJoinRequests.id, requestId))
    .limit(1);
  return request ?? null;
}

export async function getTeamInviteById(
  inviteId: string,
  database: DalDatabase = getDb(),
) {
  const [invite] = await database
    .select({
      id: teamInvites.id,
      teamId: teamInvites.teamId,
      email: teamInvites.email,
      createdBy: teamInvites.createdBy,
      acceptedAt: teamInvites.acceptedAt,
      declinedAt: teamInvites.declinedAt,
      revokedAt: teamInvites.revokedAt,
      expiresAt: teamInvites.expiresAt,
    })
    .from(teamInvites)
    .where(eq(teamInvites.id, inviteId))
    .limit(1);
  return invite ?? null;
}

const receivedFields = {
  id: teamInvites.id,
  token: teamInvites.token,
  teamId: teams.id,
  teamName: teams.name,
  senderName: users.name,
  message: teamInvites.message,
  expiresAt: teamInvites.expiresAt,
};

export function listReceivedInvites(
  email: string,
  database: DalDatabase = getDb(),
  now: Date = new Date(),
) {
  return database
    .select(receivedFields)
    .from(teamInvites)
    .innerJoin(teams, eq(teamInvites.teamId, teams.id))
    .innerJoin(users, eq(teamInvites.createdBy, users.id))
    .where(usableInvite(email, now))
    .orderBy(desc(teamInvites.createdAt), asc(teamInvites.id));
}

export async function getInviteForRecipient(
  token: string,
  email: string,
  database: DalDatabase = getDb(),
  now: Date = new Date(),
) {
  if (!isQueryableInviteToken(token)) return null;
  const [invite] = await database
    .select(receivedFields)
    .from(teamInvites)
    .innerJoin(teams, eq(teamInvites.teamId, teams.id))
    .innerJoin(users, eq(teamInvites.createdBy, users.id))
    .where(and(eq(teamInvites.token, token), usableInvite(email, now)))
    .limit(1);
  return invite ?? null;
}

export function listSentInvites(
  teamId: string,
  database: DalDatabase = getDb(),
) {
  return database
    .select({
      id: teamInvites.id,
      email: teamInvites.email,
      message: teamInvites.message,
      expiresAt: teamInvites.expiresAt,
      createdAt: teamInvites.createdAt,
    })
    .from(teamInvites)
    .where(and(eq(teamInvites.teamId, teamId), pendingInvite()))
    .orderBy(desc(teamInvites.createdAt), asc(teamInvites.id));
}

export function listTeamJoinRequests(
  teamId: string,
  database: DalDatabase = getDb(),
) {
  return database
    .select({
      id: teamJoinRequests.id,
      userId: users.id,
      name: users.name,
      email: users.email,
      message: teamJoinRequests.message,
      createdAt: teamJoinRequests.createdAt,
    })
    .from(teamJoinRequests)
    .innerJoin(users, eq(teamJoinRequests.userId, users.id))
    .where(
      and(
        eq(teamJoinRequests.teamId, teamId),
        eq(teamJoinRequests.status, "pending"),
      ),
    )
    .orderBy(asc(teamJoinRequests.createdAt), asc(teamJoinRequests.id));
}

export function listMyJoinRequests(
  userId: string,
  database: DalDatabase = getDb(),
) {
  return database
    .select({
      id: teamJoinRequests.id,
      teamId: teams.id,
      teamName: teams.name,
      message: teamJoinRequests.message,
      createdAt: teamJoinRequests.createdAt,
    })
    .from(teamJoinRequests)
    .innerJoin(teams, eq(teamJoinRequests.teamId, teams.id))
    .where(
      and(
        eq(teamJoinRequests.userId, userId),
        eq(teamJoinRequests.status, "pending"),
      ),
    )
    .orderBy(desc(teamJoinRequests.createdAt), asc(teamJoinRequests.id));
}

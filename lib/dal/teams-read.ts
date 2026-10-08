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
import { avatarColumns } from "./avatar";
import { toAvatar } from "@/lib/avatar";
import { teamDisplayName } from "./team-name";

function activeTeam(
  teamId:
    | typeof teams.id
    | typeof teamInvites.teamId
    | typeof teamJoinRequests.teamId
    | typeof teamMembers.teamId,
) {
  return sql`exists (select 1 from teams active_team where active_team.id = ${teamId} and active_team.deleted_at is null)`;
}

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
    activeTeam(teamInvites.teamId),
  );
}

export async function getTeamIdentity(
  teamId: string,
  database: DalDatabase = getDb(),
) {
  const [team] = await database
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.id, teamId), isNull(teams.deletedAt)))
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
      name: teamDisplayName(teams),
      homeBranchId: teams.homeBranchId,
      headcount: teams.headcount,
      createdBy: teams.createdBy,
      createdAt: teams.createdAt,
    })
    .from(teams)
    .where(and(eq(teams.id, teamId), isNull(teams.deletedAt)))
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
    .where(and(eq(teams.id, teamId), isNull(teams.deletedAt)))
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
    .where(
      and(
        eq(teamMembers.teamId, teamId),
        eq(teamMembers.userId, userId),
        activeTeam(teamMembers.teamId),
      ),
    )
    .limit(1);
  return member ?? null;
}

export function listMyTeams(userId: string, database: DalDatabase = getDb()) {
  return database
    .select({
      id: teams.id,
      name: teamDisplayName(teams),
      role: teamMembers.role,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .where(and(eq(teamMembers.userId, userId), isNull(teams.deletedAt)))
    .orderBy(asc(teams.name), asc(teams.id));
}

export async function listTeamMembers(
  teamId: string,
  database: DalDatabase = getDb(),
) {
  const rows = await database
    .select({
      userId: users.id,
      name: users.name,
      username: users.username,
      avatar: avatarColumns(users),
      email: users.email,
      role: teamMembers.role,
      title: teamMembers.title,
    })
    .from(teamMembers)
    .innerJoin(users, eq(teamMembers.userId, users.id))
    .where(and(eq(teamMembers.teamId, teamId), activeTeam(teamMembers.teamId)))
    .orderBy(asc(teamMembers.role), asc(users.name), asc(users.id));
  return rows.map(({ avatar, ...row }) => ({
    ...row,
    avatar: toAvatar(avatar),
  }));
}

export function searchTeams(query: string, database: DalDatabase = getDb()) {
  const literal = normalizeTeamName(query).replace(/[\\%_]/g, "\\$&");
  return database
    .select({
      id: teams.id,
      name: teamDisplayName(teams),
      homeBranchName: branches.name,
    })
    .from(teams)
    .leftJoin(branches, eq(teams.homeBranchId, branches.id))
    .where(and(ilike(teams.name, `%${literal}%`), isNull(teams.deletedAt)))
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
    .where(
      and(
        eq(teamJoinRequests.id, requestId),
        activeTeam(teamJoinRequests.teamId),
      ),
    )
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
    .where(and(eq(teamInvites.id, inviteId), activeTeam(teamInvites.teamId)))
    .limit(1);
  return invite ?? null;
}

const receivedFields = {
  id: teamInvites.id,
  token: teamInvites.token,
  teamId: teams.id,
  teamName: teamDisplayName(teams),
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
    .where(
      and(
        eq(teamInvites.teamId, teamId),
        pendingInvite(),
        activeTeam(teamInvites.teamId),
      ),
    )
    .orderBy(desc(teamInvites.createdAt), asc(teamInvites.id));
}

export async function listTeamJoinRequests(
  teamId: string,
  database: DalDatabase = getDb(),
) {
  const rows = await database
    .select({
      id: teamJoinRequests.id,
      userId: users.id,
      name: users.name,
      avatar: avatarColumns(users),
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
        activeTeam(teamJoinRequests.teamId),
      ),
    )
    .orderBy(asc(teamJoinRequests.createdAt), asc(teamJoinRequests.id));
  return rows.map(({ avatar, ...row }) => ({
    ...row,
    avatar: toAvatar(avatar),
  }));
}

export function listMyJoinRequests(
  userId: string,
  database: DalDatabase = getDb(),
) {
  return database
    .select({
      id: teamJoinRequests.id,
      teamId: teams.id,
      teamName: teamDisplayName(teams),
      message: teamJoinRequests.message,
      createdAt: teamJoinRequests.createdAt,
    })
    .from(teamJoinRequests)
    .innerJoin(teams, eq(teamJoinRequests.teamId, teams.id))
    .where(
      and(
        eq(teamJoinRequests.userId, userId),
        eq(teamJoinRequests.status, "pending"),
        isNull(teams.deletedAt),
      ),
    )
    .orderBy(desc(teamJoinRequests.createdAt), asc(teamJoinRequests.id));
}

import "server-only";

import { randomBytes } from "node:crypto";
import { createTeamSpace } from "@/lib/dal/chat-write";
import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { getPostgresError } from "@/lib/actions/errors";
import { ActionError } from "@/lib/actions/result";
import {
  withTransaction,
  type DalDatabase,
  type TransactionDatabase,
} from "@/lib/dal/database";
import {
  getJoinRequestById,
  getTeamInviteById,
  getTeamMember,
  pendingInvite,
  usableInvite,
} from "@/lib/dal/teams-read";
import { getUserByEmail } from "@/lib/dal/users";
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
import { can } from "@/lib/permissions/can";

async function requireLockedTeamManager(
  teamId: string,
  userId: string,
  database: DalDatabase,
) {
  // 팀 행을 잠근 뒤 다시 읽는다. 트랜잭션 밖 authorize의 역할은 바뀔 수 있다.
  const membership = await getTeamMember(teamId, userId, database);
  if (!membership) throw new ActionError("NOT_FOUND");
  if (
    !can(
      {
        userId,
        teams: [{ teamId, role: membership.role }],
        staffBranchIds: [],
        roleSettings: {},
      },
      "team.manage_members",
      { teamId },
    )
  )
    throw new ActionError("FORBIDDEN");
}

// FK의 KEY SHARE도 잠금에 참여하므로 사용자 전체를 먼저 같은 순서로 잠근다.
async function lockUsers(userIds: string[], database: DalDatabase) {
  return database
    .select({
      id: users.id,
      email: users.email,
      emailVerified: users.emailVerified,
      name: users.name,
    })
    .from(users)
    .where(inArray(users.id, [...new Set(userIds)]))
    .orderBy(asc(users.id))
    .for("update");
}

export async function lockTeam(teamId: string, database: DalDatabase) {
  const [team] = await database
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(and(eq(teams.id, teamId), isNull(teams.deletedAt)))
    .for("update");
  return team ?? null;
}

async function addMember(
  teamId: string,
  userId: string,
  database: DalDatabase,
) {
  await database
    .insert(teamMembers)
    .values({ teamId, userId, role: "member" })
    .onConflictDoNothing({ target: [teamMembers.teamId, teamMembers.userId] });
}

export async function createTeam(
  input: {
    userId: string;
    name: string;
    homeBranchId: string | null;
    headcount: number;
    contactPhone: string;
    title: string | null;
  },
  database?: TransactionDatabase,
) {
  return withTransaction(async (transaction) => {
    await lockUsers([input.userId], transaction);
    const [anyBranch] = await transaction
      .select({ id: branches.id })
      .from(branches)
      .limit(1);
    if (anyBranch && !input.homeBranchId)
      throw new ActionError("INVALID_INPUT");
    if (input.homeBranchId) {
      const [branch] = await transaction
        .select({ id: branches.id })
        .from(branches)
        .where(eq(branches.id, input.homeBranchId))
        .limit(1);
      if (!branch) throw new ActionError("INVALID_INPUT");
    }
    const [team] = await transaction
      .insert(teams)
      .values({
        name: normalizeTeamName(input.name),
        createdBy: input.userId,
        homeBranchId: input.homeBranchId,
        headcount: input.headcount,
        contactPhone: input.contactPhone,
      })
      .returning({ id: teams.id });
    if (!team) throw new ActionError("INTERNAL");
    await transaction.insert(teamMembers).values({
      teamId: team.id,
      userId: input.userId,
      role: "admin",
      title: input.title,
    });
    // 삽입으로 이름 중복을 먼저 판정하고, 한도 초과면 두 행을 함께 되돌린다.
    const [total] = await transaction
      .select({ value: count() })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(
        and(
          eq(teamMembers.userId, input.userId),
          eq(teamMembers.role, "admin"),
          isNull(teams.deletedAt),
        ),
      );
    if (total!.value > 5) throw new ActionError("LIMIT_EXCEEDED");
    await createTeamSpace(team.id, transaction);
    return team;
  }, database);
}

export async function createJoinRequest(
  input: { teamId: string; userId: string; message: string | null },
  database?: TransactionDatabase,
) {
  return withTransaction(async (transaction) => {
    await lockUsers([input.userId], transaction);
    if (!(await lockTeam(input.teamId, transaction)))
      throw new ActionError("NOT_FOUND");
    if (await getTeamMember(input.teamId, input.userId, transaction))
      throw new ActionError("ALREADY_MEMBER");
    const [request] = await transaction
      .insert(teamJoinRequests)
      .values(input)
      .returning({ id: teamJoinRequests.id, teamId: teamJoinRequests.teamId });
    const [total] = await transaction
      .select({ value: count() })
      .from(teamJoinRequests)
      .where(
        and(
          eq(teamJoinRequests.userId, input.userId),
          eq(teamJoinRequests.status, "pending"),
        ),
      );
    if (total!.value > 10) throw new ActionError("LIMIT_EXCEEDED");
    if (!request) throw new ActionError("INTERNAL");
    return request;
  }, database);
}

export async function cancelJoinRequest(
  input: { requestId: string; userId: string },
  database?: TransactionDatabase,
) {
  return withTransaction(async (transaction) => {
    const metadata = await getJoinRequestById(input.requestId, transaction);
    if (!metadata) throw new ActionError("NOT_FOUND");
    await lockUsers([input.userId], transaction);
    if (!(await lockTeam(metadata.teamId, transaction)))
      throw new ActionError("NOT_FOUND");
    const [request] = await transaction
      .update(teamJoinRequests)
      .set({
        status: "cancelled",
        decidedAt: null,
        decidedBy: null,
      })
      .where(
        and(
          eq(teamJoinRequests.id, input.requestId),
          eq(teamJoinRequests.userId, input.userId),
          eq(teamJoinRequests.status, "pending"),
        ),
      )
      .returning({ teamId: teamJoinRequests.teamId });
    if (!request) throw new ActionError("NOT_FOUND");
    return request;
  }, database);
}

async function decideJoinRequest(
  input: { requestId: string; actorUserId: string },
  status: "approved" | "rejected",
  database?: TransactionDatabase,
) {
  return withTransaction(async (transaction) => {
    const metadata = await getJoinRequestById(input.requestId, transaction);
    if (!metadata) throw new ActionError("NOT_FOUND");
    const lockedUsers = await lockUsers(
      [input.actorUserId, metadata.userId],
      transaction,
    );
    if (!(await lockTeam(metadata.teamId, transaction)))
      throw new ActionError("NOT_FOUND");
    await requireLockedTeamManager(
      metadata.teamId,
      input.actorUserId,
      transaction,
    );
    const [request] = await transaction
      .update(teamJoinRequests)
      .set({
        status,
        decidedBy: input.actorUserId,
        decidedAt: sql`statement_timestamp()`,
      })
      .where(
        and(
          eq(teamJoinRequests.id, input.requestId),
          eq(teamJoinRequests.status, "pending"),
        ),
      )
      .returning({
        teamId: teamJoinRequests.teamId,
        userId: teamJoinRequests.userId,
      });
    if (!request) throw new ActionError("NOT_FOUND");
    if (status === "approved") {
      await addMember(request.teamId, request.userId, transaction);
      const applicant = lockedUsers.find(({ id }) => id === request.userId);
      if (!applicant) throw new ActionError("NOT_FOUND");
      await transaction
        .update(teamInvites)
        .set({ acceptedAt: sql`statement_timestamp()` })
        .where(
          and(
            eq(teamInvites.teamId, request.teamId),
            eq(teamInvites.email, applicant.email),
            pendingInvite(),
          ),
        );
    }
    return { teamId: request.teamId };
  }, database);
}

export function approveJoinRequest(
  input: { requestId: string; actorUserId: string },
  database?: TransactionDatabase,
) {
  return decideJoinRequest(input, "approved", database);
}

export function rejectJoinRequest(
  input: { requestId: string; actorUserId: string },
  database?: TransactionDatabase,
) {
  return decideJoinRequest(input, "rejected", database);
}

export async function createTeamInvite(
  input: {
    teamId: string;
    actorUserId: string;
    email: string;
    message: string | null;
  },
  database?: TransactionDatabase,
) {
  const email = input.email.toLowerCase();
  for (let attempt = 0; ; attempt++) {
    try {
      return await withTransaction(async (transaction) => {
        const recipient = await getUserByEmail(email, transaction);
        const lockedUsers = await lockUsers(
          [input.actorUserId, ...(recipient ? [recipient.id] : [])],
          transaction,
        );
        const team = await lockTeam(input.teamId, transaction);
        if (!team) throw new ActionError("NOT_FOUND");
        await requireLockedTeamManager(
          input.teamId,
          input.actorUserId,
          transaction,
        );
        if (
          recipient &&
          (await getTeamMember(input.teamId, recipient.id, transaction))
        )
          throw new ActionError("ALREADY_MEMBER");
        await transaction
          .update(teamInvites)
          .set({ revokedAt: sql`statement_timestamp()` })
          .where(
            and(
              eq(teamInvites.teamId, input.teamId),
              eq(teamInvites.email, email),
              pendingInvite(),
            ),
          );
        const [total] = await transaction
          .select({ value: count() })
          .from(teamInvites)
          .where(and(eq(teamInvites.teamId, input.teamId), pendingInvite()));
        if (total!.value >= 50) throw new ActionError("LIMIT_EXCEEDED");
        const [invite] = await transaction
          .insert(teamInvites)
          .values({
            teamId: input.teamId,
            email,
            message: input.message,
            createdBy: input.actorUserId,
            token: randomBytes(32).toString("base64url"),
            expiresAt: sql`statement_timestamp() + interval '7 days'`,
          })
          .returning({
            id: teamInvites.id,
            token: teamInvites.token,
            teamId: teamInvites.teamId,
            email: teamInvites.email,
            message: teamInvites.message,
            expiresAt: teamInvites.expiresAt,
          });
        const sender = lockedUsers.find(({ id }) => id === input.actorUserId);
        if (!invite || !sender) throw new ActionError("INTERNAL");
        return {
          ...invite,
          email,
          teamName: team.name,
          senderName: sender.name,
        };
      }, database);
    } catch (error) {
      const postgres = getPostgresError(error);
      if (
        attempt !== 0 ||
        postgres?.code !== "23505" ||
        postgres.constraint !== "team_invites_one_pending"
      )
        throw error;
      // 23505로 중단된 트랜잭션 밖에서만 새 트랜잭션을 한 번 시작한다.
    }
  }
}

export async function revokeTeamInvite(
  input: { inviteId: string; actorUserId: string },
  database?: TransactionDatabase,
) {
  return withTransaction(async (transaction) => {
    const metadata = await getTeamInviteById(input.inviteId, transaction);
    if (!metadata) throw new ActionError("INVITE_INVALID");
    await lockUsers([input.actorUserId, metadata.createdBy], transaction);
    if (!(await lockTeam(metadata.teamId, transaction)))
      throw new ActionError("INVITE_INVALID");
    await requireLockedTeamManager(
      metadata.teamId,
      input.actorUserId,
      transaction,
    );
    const [invite] = await transaction
      .update(teamInvites)
      .set({ revokedAt: sql`statement_timestamp()` })
      .where(and(eq(teamInvites.id, input.inviteId), pendingInvite()))
      .returning({ teamId: teamInvites.teamId });
    if (!invite) throw new ActionError("INVITE_INVALID");
    return invite;
  }, database);
}

async function respondToInvite(
  input: { token: string; userId: string },
  response: "accepted" | "declined",
  database?: TransactionDatabase,
) {
  if (!isQueryableInviteToken(input.token))
    throw new ActionError("INVITE_INVALID");
  return withTransaction(async (transaction) => {
    const [metadata] = await transaction
      .select({
        id: teamInvites.id,
        teamId: teamInvites.teamId,
        createdBy: teamInvites.createdBy,
      })
      .from(teamInvites)
      .where(eq(teamInvites.token, input.token))
      .limit(1);
    if (!metadata) throw new ActionError("INVITE_INVALID");
    const lockedUsers = await lockUsers(
      [input.userId, metadata.createdBy],
      transaction,
    );
    const recipient = lockedUsers.find(({ id }) => id === input.userId);
    if (!recipient?.emailVerified) throw new ActionError("INVITE_INVALID");
    if (!(await lockTeam(metadata.teamId, transaction)))
      throw new ActionError("INVITE_INVALID");
    const [invite] = await transaction
      .update(teamInvites)
      .set(
        response === "accepted"
          ? { acceptedAt: sql`statement_timestamp()` }
          : { declinedAt: sql`statement_timestamp()` },
      )
      .where(
        and(eq(teamInvites.id, metadata.id), usableInvite(recipient.email)),
      )
      .returning({
        teamId: teamInvites.teamId,
        createdBy: teamInvites.createdBy,
      });
    if (!invite) throw new ActionError("INVITE_INVALID");
    if (response === "accepted") {
      await addMember(invite.teamId, input.userId, transaction);
      await transaction
        .update(teamJoinRequests)
        .set({
          status: "approved",
          decidedBy: invite.createdBy,
          decidedAt: sql`statement_timestamp()`,
        })
        .where(
          and(
            eq(teamJoinRequests.teamId, invite.teamId),
            eq(teamJoinRequests.userId, input.userId),
            eq(teamJoinRequests.status, "pending"),
          ),
        );
    }
    return { teamId: invite.teamId };
  }, database);
}

export function acceptTeamInvite(
  input: { token: string; userId: string },
  database?: TransactionDatabase,
) {
  return respondToInvite(input, "accepted", database);
}

export function declineTeamInvite(
  input: { token: string; userId: string },
  database?: TransactionDatabase,
) {
  return respondToInvite(input, "declined", database);
}

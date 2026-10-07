import { z } from "zod";
import { canManageTeam } from "@/features/teams/action-factory";
import { teamSearchSchema } from "@/features/teams/schema";
import type {
  HomeData,
  InvitePageData,
  ReceivedInvite,
  TeamPageData,
  TeamStartData,
} from "@/features/teams/types";
import { requireSession } from "@/lib/auth/session";
import type { Session } from "@/lib/auth/types";
import {
  getInviteForRecipient,
  getOperatorBranches,
  getTeamById,
  getTeamContact,
  getTeamMember,
  getUserById,
  listBranches,
  listMyJoinRequests,
  listMyTeams,
  listReceivedInvites,
  listSentInvites,
  listTeamJoinRequests,
  listTeamMembers,
  searchTeams,
  type DalDatabase,
} from "@/lib/dal";
import { canSendEmail } from "@/lib/email";
import { normalizeTeamName } from "@/lib/teams/normalize";

export type TeamQueryDependencies = {
  database?: DalDatabase;
  requireSession?: () => Promise<Session>;
  canSendEmail?: () => boolean;
};

function receivedInvite(
  invite: Awaited<ReturnType<typeof listReceivedInvites>>[number],
): ReceivedInvite {
  return {
    token: invite.token,
    teamId: invite.teamId,
    teamName: invite.teamName,
    inviterName: invite.senderName,
    message: invite.message,
    expiresAt: invite.expiresAt.toISOString(),
  };
}

export function createTeamQueries(dependencies: TeamQueryDependencies = {}) {
  const database = dependencies.database;
  const readSession = dependencies.requireSession ?? requireSession;
  async function receivedInvites(session: Session) {
    const user = await getUserById(session.userId, database);
    return user?.emailVerified ? listReceivedInvites(user.email, database) : [];
  }
  return {
    async getHomeData(): Promise<HomeData> {
      const session = await readSession();
      const [myTeams, invites, branches] = await Promise.all([
        listMyTeams(session.userId, database),
        receivedInvites(session),
        getOperatorBranches(session.userId, database),
      ]);
      return {
        name: session.name,
        teams: myTeams,
        pendingInviteCount: invites.length,
        isOperator: branches.length > 0,
      };
    },
    async getTeamStartData(query?: unknown): Promise<TeamStartData> {
      const session = await readSession();
      const normalized =
        typeof query === "string" ? normalizeTeamName(query) : "";
      const parsed = teamSearchSchema.safeParse(normalized);
      const [branches, invites, myTeams, requests, results] = await Promise.all(
        [
          listBranches(database),
          receivedInvites(session),
          listMyTeams(session.userId, database),
          listMyJoinRequests(session.userId, database),
          parsed.success ? searchTeams(parsed.data, database) : [],
        ],
      );
      return {
        branches,
        invites: invites.map(receivedInvite),
        search: {
          query: normalized,
          results: results.map((team) => ({
            ...team,
            isMember: myTeams.some((membership) => membership.id === team.id),
            hasInvite: invites.some((invite) => invite.teamId === team.id),
          })),
          ...(!parsed.success &&
          (typeof query === "string"
            ? normalized.length > 0
            : query !== undefined)
            ? { error: "검색어는 2자 이상 40자 이하로 입력해 주세요" }
            : {}),
        },
        requests: requests.map((request) => ({
          id: request.id,
          teamId: request.teamId,
          teamName: request.teamName,
          message: request.message,
          createdAt: request.createdAt.toISOString(),
        })),
      };
    },
    async getTeamPageData(teamId: string): Promise<TeamPageData | null> {
      const session = await readSession();
      if (!z.uuid().safeParse(teamId).success) return null;
      teamId = teamId.toLowerCase();
      const [membership, isManager] = await Promise.all([
        getTeamMember(teamId, session.userId, database),
        canManageTeam(session, teamId, database),
      ]);
      if (!membership) return null;
      // 소속과 권한을 먼저 확인해야 관리자 전용 조회가 시작될 수 있다.
      const [team, memberRows, contact, invites, requests] = await Promise.all([
        getTeamById(teamId, database),
        listTeamMembers(teamId, database),
        isManager ? getTeamContact(teamId, database) : null,
        isManager ? listSentInvites(teamId, database) : [],
        isManager ? listTeamJoinRequests(teamId, database) : [],
      ]);
      if (!team) return null;
      const members = memberRows.map((member) => ({
        id: member.userId,
        name: member.name,
        email: member.email,
        role: member.role,
        title: member.title,
      }));
      const publicData = {
        id: team.id,
        name: team.name,
        memberCount: members.length,
        members,
      };
      if (!isManager) return { ...publicData, role: "member" };
      return {
        ...publicData,
        role: "admin",
        contactPhone: contact?.contactPhone ?? null,
        sentInvites: invites.map((invite) => ({
          id: invite.id,
          email: invite.email,
          message: invite.message,
          expiresAt: invite.expiresAt.toISOString(),
          createdAt: invite.createdAt.toISOString(),
        })),
        joinRequests: requests.map((request) => ({
          id: request.id,
          name: request.name,
          email: request.email,
          message: request.message,
          createdAt: request.createdAt.toISOString(),
        })),
        canSendEmail: (dependencies.canSendEmail ?? canSendEmail)(),
      };
    },
    async getInvitePageData(token: string): Promise<InvitePageData | null> {
      const session = await readSession();
      const user = await getUserById(session.userId, database);
      if (!user?.emailVerified) return null;
      const invite = await getInviteForRecipient(token, user.email, database);
      return invite ? receivedInvite(invite) : null;
    },
  };
}

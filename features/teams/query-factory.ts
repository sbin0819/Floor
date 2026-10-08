import { z } from "zod";
import { ActionError } from "@/lib/actions/result";
import { canManageTeam } from "@/features/teams/action-factory";
import { teamSearchSchema } from "@/features/teams/schema";
import type {
  HomeData,
  HomeTeamsData,
  TeamsData,
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
  getTeamMember,
  getUserById,
  listBranches,
  listMyJoinRequests,
  listMyTeams,
  listMyTeamSummaries,
  listTeamHubRequests,
  listReceivedInvites,
  listSentInvites,
  listTeamJoinRequests,
  listTeamMembers,
  searchTeams,
  type DalDatabase,
} from "@/lib/dal";
import { canSendEmail } from "@/lib/email";
import { normalizeTeamName } from "@/lib/teams/normalize";
import type { TeamStartMode } from "./start-mode";
import { createTeamManagementQueries } from "./manage-query-factory";
import {
  listPublicTeamMembers,
  readTeamPageHeader,
  readTeamSettings,
} from "@/lib/dal/teams-management-read";

export type TeamQueryDependencies = {
  database?: DalDatabase;
  requireSession?: () => Promise<Session>;
  canSendEmail?: () => boolean;
  now?: () => Date;
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
  const now = dependencies.now ?? (() => new Date());
  async function receivedInvites(session: Session, current = now()) {
    const user = await getUserById(session.userId, database);
    return user?.emailVerified
      ? listReceivedInvites(user.email, database, current)
      : [];
  }
  return {
    ...createTeamManagementQueries(dependencies),
    async getHomeTeams(): Promise<HomeTeamsData> {
      const session = await readSession();
      const [myTeams, invites] = await Promise.all([
        listMyTeams(session.userId, database),
        receivedInvites(session),
      ]);
      return { teams: myTeams, pendingInviteCount: invites.length };
    },
    async getTeamsData(): Promise<TeamsData> {
      const session = await readSession();
      const current = now();
      const [myTeams, invites, requests] = await Promise.all([
        listMyTeamSummaries(session.userId, database),
        receivedInvites(session, current),
        listTeamHubRequests(session.userId, current, database),
      ]);
      return {
        teams: myTeams,
        invites: invites.map(receivedInvite),
        requests: requests.flatMap((request) =>
          request.status === "pending" || request.status === "rejected"
            ? [
                {
                  id: request.id,
                  teamId: request.teamId,
                  teamName: request.teamName,
                  message: request.message,
                  createdAt: request.createdAt.toISOString(),
                  status: request.status,
                  decidedAt: request.decidedAt?.toISOString() ?? null,
                },
              ]
            : [],
        ),
      };
    },
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
    async getTeamStartData(
      query?: unknown,
      mode?: TeamStartMode,
    ): Promise<TeamStartData> {
      const session = await readSession();
      const normalized =
        typeof query === "string" ? normalizeTeamName(query) : "";
      const parsed = teamSearchSchema.safeParse(normalized);
      const searchRequested =
        (mode === undefined || mode === "join") && parsed.success;
      const [branches, invites, myTeams, requests, results] = await Promise.all(
        [
          mode === undefined || mode === "create" ? listBranches(database) : [],
          mode === undefined || mode === "choose" || searchRequested
            ? receivedInvites(session)
            : [],
          mode === undefined || searchRequested
            ? listMyTeams(session.userId, database)
            : [],
          mode === undefined || searchRequested
            ? listMyJoinRequests(session.userId, database)
            : [],
          searchRequested && parsed.success
            ? searchTeams(parsed.data, database)
            : [],
        ],
      );
      return {
        branches,
        invites: invites.map(({ teamName }) => ({ teamName })),
        search: {
          query: normalized,
          results: results.map((team) => ({
            ...team,
            isMember: myTeams.some((membership) => membership.id === team.id),
            hasInvite: invites.some((invite) => invite.teamId === team.id),
            hasRequest: requests.some((request) => request.teamId === team.id),
          })),
          ...(!parsed.success &&
          (typeof query === "string"
            ? normalized.length > 0
            : query !== undefined)
            ? { error: "검색어는 2자 이상 40자 이하로 입력해 주세요" }
            : {}),
        },
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
      const [team, memberRows, settings, invites, requests, branches] =
        await Promise.all([
          readTeamPageHeader(teamId, now(), database),
          isManager
            ? listTeamMembers(teamId, database)
            : listPublicTeamMembers(teamId, database),
          isManager ? readTeamSettings(teamId, database) : null,
          isManager ? listSentInvites(teamId, database) : [],
          isManager ? listTeamJoinRequests(teamId, database) : [],
          isManager ? listBranches(database) : [],
        ]);
      if (!team) return null;
      const members = memberRows.map((member) => ({
        id: member.userId,
        name: member.name,
        username: member.username,
        avatar: member.avatar,
        role: member.role,
        title: member.title,
      }));
      const publicData = {
        id: team.id,
        name: team.name,
        userId: session.userId,
        homeBranchName: team.homeBranchName,
        space: team.space
          ? { ...team.space, initial: Array.from(team.name)[0] ?? "" }
          : null,
        upcomingBookingCount: team.upcomingBookingCount,
        memberCount: members.length,
        members,
      };
      if (!isManager) return { ...publicData, role: "member" };
      return {
        ...publicData,
        role: "admin",
        members: members.map((member, index) => {
          const row = memberRows[index]!;
          if (!("email" in row) || typeof row.email !== "string")
            throw new ActionError("INTERNAL");
          return { ...member, email: row.email };
        }),
        homeBranchId: settings?.homeBranchId ?? null,
        headcount: settings?.headcount ?? null,
        branches,
        pendingJoinRequestCount: requests.length,
        contactPhone: settings?.contactPhone ?? null,
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
          avatar: request.avatar,
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
      const invite = await getInviteForRecipient(
        token,
        user.email,
        database,
        now(),
      );
      return invite ? receivedInvite(invite) : null;
    },
  };
}

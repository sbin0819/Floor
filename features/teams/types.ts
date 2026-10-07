export type TeamRole = "admin" | "member";

export type MyTeam = { id: string; name: string; role: TeamRole };
export type MyTeamSummary = MyTeam & {
  memberCount: number;
  homeBranchName: string | null;
};
export type HomeTeamsData = { teams: MyTeam[]; pendingInviteCount: number };
export type ReceivedInvite = {
  token: string;
  teamId: string;
  teamName: string;
  inviterName: string;
  message: string | null;
  expiresAt: string;
};
export type MyJoinRequest = {
  id: string;
  teamId: string;
  teamName: string;
  message: string | null;
  createdAt: string;
};
export type TeamHubRequest = MyJoinRequest & {
  status: "pending" | "rejected";
  decidedAt: string | null;
};
export type TeamsData = {
  teams: MyTeamSummary[];
  invites: ReceivedInvite[];
  requests: TeamHubRequest[];
};
export type TeamSearchResult = {
  id: string;
  name: string;
  homeBranchName: string | null;
  isMember: boolean;
  hasInvite: boolean;
  hasRequest: boolean;
};
export type HomeData = {
  name: string;
  teams: MyTeam[];
  pendingInviteCount: number;
  isOperator: boolean;
};
export type TeamStartData = {
  branches: { id: string; name: string }[];
  invites: { teamName: string }[];
  search: { query: string; results: TeamSearchResult[]; error?: string };
};
export type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  title: string | null;
};
export type SentInvite = {
  id: string;
  email: string | null;
  message: string | null;
  expiresAt: string;
  createdAt: string;
};
export type PendingJoinRequest = {
  id: string;
  name: string;
  email: string;
  message: string | null;
  createdAt: string;
};
type TeamPageCommon = {
  id: string;
  name: string;
  memberCount: number;
  members: TeamMember[];
};
export type TeamPageData = TeamPageCommon &
  (
    | { role: "member" }
    | {
        role: "admin";
        contactPhone: string | null;
        sentInvites: SentInvite[];
        joinRequests: PendingJoinRequest[];
        canSendEmail: boolean;
      }
  );
export type InvitePageData = ReceivedInvite;

import type { Avatar } from "@/lib/avatar";
import type { SpaceIconColor } from "@/features/chat/space-schema";

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
  username: string | null;
  avatar: Avatar;
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
  avatar: Avatar;
  email: string;
  message: string | null;
  createdAt: string;
};
type TeamPageCommon = {
  id: string;
  name: string;
  userId: string;
  homeBranchName: string | null;
  space: { id: string; iconColor: SpaceIconColor; initial: string } | null;
  upcomingBookingCount: number;
  memberCount: number;
};
export type TeamPageData = TeamPageCommon &
  (
    | { role: "member"; members: TeamMember[] }
    | {
        role: "admin";
        members: (TeamMember & { email: string })[];
        homeBranchId: string | null;
        headcount: number | null;
        branches: { id: string; name: string }[];
        pendingJoinRequestCount: number;
        contactPhone: string | null;
        sentInvites: SentInvite[];
        joinRequests: PendingJoinRequest[];
        canSendEmail: boolean;
      }
  );
export type InvitePageData = ReceivedInvite;

export type TeamBookingView = "upcoming" | "past" | "cancelled";
export type TeamBooking = {
  id: string;
  kind: "time" | "desk";
  startAt: string;
  endAt: string;
  title: string | null;
  spaceName: string;
  floorName: string;
  branchName: string;
  timezone: string;
  restricted: boolean;
  booker: { id: string; name: string; avatar: Avatar };
  participantCount: number;
  canChat: boolean;
  canCancel: boolean;
};
export type TeamBookingsData = {
  teamId: string;
  view: TeamBookingView;
  branchId: string | null;
  branches: { id: string; name: string }[];
  bookings: TeamBooking[];
  now: string;
};
export type TeamRemovalPreview = {
  teamId: string;
  userId: string;
  bookingCount: number;
  firstBooking: Pick<
    TeamBooking,
    | "id"
    | "startAt"
    | "endAt"
    | "spaceName"
    | "floorName"
    | "branchName"
    | "timezone"
  > | null;
};
export type TeamDeletePreview = {
  teamId: string;
  memberCount: number;
  inviteCount: number;
  requestCount: number;
  bookingCount: number;
  accessGrants: {
    targetType: "floor" | "space";
    floorId: string;
    spaceId: string | null;
    branchName: string;
    floorName: string;
    spaceName: string | null;
  }[];
};

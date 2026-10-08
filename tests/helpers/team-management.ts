import type { TeamPageData, TeamBookingsData } from "@/features/teams/types";

export const managedTeamId = "00000000-0000-4000-8000-000000000031";
export const adminId = "00000000-0000-4000-8000-000000000001";
export const memberId = "00000000-0000-4000-8000-000000000002";
export const teamAdmin: Extract<TeamPageData, { role: "admin" }> = {
  id: managedTeamId,
  name: "디자인팀",
  userId: adminId,
  role: "admin",
  memberCount: 2,
  homeBranchName: "강남점",
  homeBranchId: "00000000-0000-4000-8000-000000000011",
  headcount: 8,
  contactPhone: "01012345678",
  branches: [{ id: "00000000-0000-4000-8000-000000000011", name: "강남점" }],
  space: {
    id: "00000000-0000-4000-8000-000000000041",
    iconColor: "blue",
    initial: "디",
  },
  upcomingBookingCount: 3,
  pendingJoinRequestCount: 0,
  sentInvites: [],
  joinRequests: [],
  canSendEmail: true,
  members: [
    {
      id: adminId,
      name: "박지훈",
      username: "jihoon",
      avatar: { color: "blue", photoUrl: null },
      role: "admin",
      title: "디자인 리드",
      email: "admin@example.test",
    },
    {
      id: memberId,
      name: "이서연",
      username: "seoyeon",
      avatar: { color: "pink", photoUrl: null },
      role: "member",
      title: null,
      email: "member@example.test",
    },
  ],
};
export const teamMember: Extract<TeamPageData, { role: "member" }> = {
  id: managedTeamId,
  name: teamAdmin.name,
  userId: memberId,
  role: "member",
  memberCount: 2,
  homeBranchName: teamAdmin.homeBranchName,
  space: teamAdmin.space,
  upcomingBookingCount: 3,
  members: teamAdmin.members.map(
    ({ id, name, username, avatar, role, title }) => ({
      id,
      name,
      username,
      avatar,
      role,
      title,
    }),
  ),
};
export const teamBookings: TeamBookingsData = {
  teamId: managedTeamId,
  view: "upcoming",
  branchId: null,
  branches: teamAdmin.branches,
  now: "2026-10-09T03:00:00.000Z",
  bookings: [
    {
      id: "00000000-0000-4000-8000-000000000051",
      kind: "time",
      startAt: "2026-10-09T03:20:00.000Z",
      endAt: "2026-10-09T04:00:00.000Z",
      title: "디자인 점검",
      spaceName: "회의실 A",
      floorName: "2F",
      branchName: "강남점",
      timezone: "Asia/Seoul",
      restricted: true,
      booker: {
        id: adminId,
        name: "박지훈",
        avatar: { color: "blue", photoUrl: null },
      },
      participantCount: 3,
      canChat: true,
      canCancel: true,
    },
  ],
};

import { Suspense, useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TeamHeader } from "@/features/teams/components/team-header";
import { TeamTabs } from "@/features/teams/components/team-tabs";
import { TeamMembers } from "@/features/teams/components/team-members";
import { TeamRequests } from "@/features/teams/components/team-requests";
import { TeamBookings } from "@/features/teams/components/team-bookings";
import { TeamSettings } from "@/features/teams/components/team-settings";
import { TeamRouteDialog } from "@/features/teams/components/team-route-dialog";
import { TeamRemoval } from "@/features/teams/components/team-removal";
import { TeamDelete } from "@/features/teams/components/team-delete";
import { TeamTabSkeleton } from "@/features/teams/components/team-tab-skeleton";
import type {
  TeamPageData,
  TeamBookingsData,
  TeamBooking,
} from "@/features/teams/types";
import type { ReadPersonProfile } from "@/features/people/components/person-card";

const id = "00000000-0000-4000-8000-000000000031";
const admin: Extract<TeamPageData, { role: "admin" }> = {
  id,
  name: "디자인팀",
  userId: "00000000-0000-4000-8000-000000000001",
  role: "admin",
  memberCount: 4,
  homeBranchName: "강남점",
  homeBranchId: "00000000-0000-4000-8000-000000000011",
  headcount: 8,
  contactPhone: "01012345678",
  branches: [{ id: "00000000-0000-4000-8000-000000000011", name: "강남점" }],
  space: {
    id: "00000000-0000-4000-8000-000000000041",
    iconColor: "purple",
    initial: "디",
  },
  upcomingBookingCount: 3,
  pendingJoinRequestCount: 1,
  sentInvites: [
    {
      id: "00000000-0000-4000-8000-000000000071",
      email: "invitee@example.test",
      message: "함께 프로젝트를 시작해요",
      createdAt: "2026-10-08T00:00:00Z",
      expiresAt: "2026-10-15T00:00:00Z",
    },
  ],
  joinRequests: [
    {
      id: "00000000-0000-4000-8000-000000000072",
      name: "김하은",
      avatar: { color: "teal", photoUrl: null },
      email: "haeun@example.test",
      message: "팀에 함께하고 싶어요",
      createdAt: "2026-10-08T00:00:00Z",
    },
  ],
  canSendEmail: false,
  members: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      name: "박지훈",
      username: "jihoon",
      avatar: { color: "purple", photoUrl: null },
      role: "admin",
      title: "디자인 리드",
      email: "jihoon@example.test",
    },
    {
      id: "00000000-0000-4000-8000-000000000002",
      name: "이서연",
      username: "seoyeon",
      avatar: { color: "blue", photoUrl: null },
      role: "member",
      title: "프로덕트 디자이너",
      email: "seoyeon@example.test",
    },
    {
      id: "00000000-0000-4000-8000-000000000003",
      name: "정유나",
      username: "yuna",
      avatar: { color: "pink", photoUrl: null },
      role: "member",
      title: "UX 리서처",
      email: "yuna@example.test",
    },
    {
      id: "00000000-0000-4000-8000-000000000004",
      name: "최도윤",
      username: "doyun",
      avatar: { color: "green", photoUrl: null },
      role: "member",
      title: null,
      email: "doyun@example.test",
    },
  ],
};
const member: TeamPageData = {
  id,
  name: admin.name,
  userId: admin.members[1]!.id,
  role: "member",
  memberCount: 4,
  homeBranchName: admin.homeBranchName,
  space: admin.space,
  upcomingBookingCount: 3,
  members: admin.members.map(({ id, name, username, avatar, role, title }) => ({
    id,
    name,
    username,
    avatar,
    role,
    title,
  })),
};
const readPerson: ReadPersonProfile = async (userId) => {
  const person = admin.members.find((person) => person.id === userId);
  return person
    ? {
        userId,
        name: person.name,
        avatar: person.avatar,
        username: person.username,
        isMe: userId === admin.userId,
        relation: userId === admin.userId ? null : "friend",
        sharedSpaces: [{ id: admin.space!.id, name: admin.name }],
        directRoomId: null,
        canDirectMessage: true,
      }
    : null;
};
function Frame({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <div className="mx-auto max-w-[880px] space-y-6 p-4 sm:p-6">
        {children}
      </div>
    </QueryClientProvider>
  );
}
function TeamFrame({
  data,
  children,
}: {
  data: TeamPageData;
  children: ReactNode;
}) {
  return (
    <>
      <TeamHeader data={data} />
      <Suspense fallback={<TeamTabSkeleton />}>
        <TeamTabs
          teamId={id}
          role={data.role}
          memberCount={data.memberCount}
          bookingCount={data.upcomingBookingCount}
          requestCount={
            data.role === "admin" ? data.pendingJoinRequestCount : 0
          }
        >
          {children}
        </TeamTabs>
      </Suspense>
    </>
  );
}
const booking: TeamBooking = {
  id: "00000000-0000-4000-8000-000000000051",
  kind: "time",
  startAt: "2026-10-09T03:20:00Z",
  endAt: "2026-10-09T04:00:00Z",
  title: "주간 디자인 리뷰",
  spaceName: "회의실 A",
  floorName: "2F",
  branchName: "강남점",
  timezone: "Asia/Seoul",
  restricted: true,
  booker: {
    id: admin.userId,
    name: "박지훈",
    avatar: admin.members[0]!.avatar,
  },
  participantCount: 3,
  canChat: true,
  canCancel: true,
};
const bookings: TeamBookingsData = {
  teamId: id,
  view: "upcoming",
  branchId: null,
  branches: admin.branches,
  now: "2026-10-09T03:00:00Z",
  bookings: [
    booking,
    {
      ...booking,
      id: "00000000-0000-4000-8000-000000000052",
      title: "고객 경험 점검",
      startAt: "2026-10-09T05:00:00Z",
      endAt: "2026-10-09T06:00:00Z",
      canChat: false,
      canCancel: false,
      restricted: false,
    },
    {
      ...booking,
      id: "00000000-0000-4000-8000-000000000053",
      kind: "desk",
      title: null,
      spaceName: "오픈 데스크 A-01",
      startAt: "2026-10-10T00:00:00Z",
      endAt: "2026-10-10T09:00:00Z",
      participantCount: 0,
      canChat: false,
      canCancel: true,
    },
  ],
};
const meta = {
  title: "Teams/Management",
  decorators: [
    (Story) => (
      <Frame>
        <Story />
      </Frame>
    ),
  ],
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: { pathname: `/teams/${id}`, query: { tab: "members" } },
    },
  },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const Administrator: Story = {
  render: () => (
    <TeamFrame data={admin}>
      <TeamMembers data={admin} readPerson={readPerson} />
    </TeamFrame>
  ),
};
export const Member: Story = {
  render: () => (
    <TeamFrame data={member}>
      <TeamMembers data={member} readPerson={readPerson} />
    </TeamFrame>
  ),
};
export const LastAdministrator: Story = Administrator;
export const Requests: Story = {
  parameters: { nextjs: { navigation: { query: { tab: "requests" } } } },
  render: () => (
    <TeamFrame data={admin}>
      <TeamRequests data={admin} />
    </TeamFrame>
  ),
};
export const Bookings: Story = {
  parameters: { nextjs: { navigation: { query: { tab: "bookings" } } } },
  render: () => (
    <TeamFrame data={admin}>
      <TeamBookings data={bookings} />
    </TeamFrame>
  ),
};
export const Settings: Story = {
  parameters: { nextjs: { navigation: { query: { tab: "settings" } } } },
  render: () => (
    <TeamFrame data={admin}>
      <TeamSettings data={admin} />
    </TeamFrame>
  ),
};
export const RemoveMember: Story = {
  render: () => (
    <TeamFrame data={admin}>
      <TeamMembers data={admin} readPerson={readPerson} />
      <TeamRouteDialog
        teamId={id}
        title="이서연 님을 디자인팀에서 내보낼까요?"
        description="내보낸 뒤 다시 들이려면 초대를 보내야 해요."
        returnMemberId={member.userId}
      >
        <TeamRemoval
          teamName="디자인팀"
          name="이서연"
          leaving={false}
          preview={{
            teamId: id,
            userId: member.userId,
            bookingCount: 2,
            firstBooking: booking,
          }}
        />
      </TeamRouteDialog>
    </TeamFrame>
  ),
};
export const DeleteTeam: Story = {
  parameters: { nextjs: { navigation: { query: { tab: "settings" } } } },
  render: () => (
    <TeamFrame data={admin}>
      <TeamSettings data={admin} />
      <TeamRouteDialog
        teamId={id}
        title="디자인팀을(를) 지울까요?"
        description="되돌릴 수 없어요. 아래 내용을 확인해 주세요."
      >
        <TeamDelete
          teamName={admin.name}
          preview={{
            teamId: id,
            memberCount: 4,
            inviteCount: 1,
            requestCount: 1,
            bookingCount: 3,
            accessGrants: [
              {
                targetType: "floor",
                floorId: "floor",
                spaceId: null,
                branchName: "강남점",
                floorName: "2F",
                spaceName: null,
              },
            ],
          }}
        />
      </TeamRouteDialog>
    </TeamFrame>
  ),
};

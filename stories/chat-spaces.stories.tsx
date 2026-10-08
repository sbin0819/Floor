import { useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChatRailNavigation } from "@/components/chat-navigation";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CreateSpaceForm } from "@/features/chat/components/space-add";
import { SpaceInviteDialog } from "@/features/chat/components/space-invite-dialog";
import { SpaceInvitesList } from "@/features/chat/components/space-invites-list";
import { SpaceJoin } from "@/features/chat/components/space-join";
import { SpaceMembers } from "@/features/chat/components/space-members";
import { SpaceMenu } from "@/features/chat/components/space-menu";
import {
  SpaceOverview,
  SpaceSettingsTabs,
} from "@/features/chat/components/space-settings";
import { ChannelDialog } from "@/features/chat/components/channel-dialog";
import type { ChatNav, ChatSpaceNav } from "@/features/chat/types";
import type {
  SpaceMember,
  SpaceMembersView,
} from "@/features/chat/space-members-queries";
import type { SpaceSettings } from "@/features/chat/space-settings-queries";
import type { PersonProfile } from "@/features/people/types";

const me = "00000000-0000-4000-8000-000000000001";
const communityId = "00000000-0000-4000-8000-000000000013";
const members: SpaceMember[] = [
  {
    userId: me,
    name: "김하은",
    username: "haeun",
    role: "owner",
    sharesSpace: true,
  },
  {
    userId: "00000000-0000-4000-8000-000000000002",
    name: "박지훈",
    username: "jihoon",
    role: "admin",
    sharesSpace: true,
  },
  {
    userId: "00000000-0000-4000-8000-000000000003",
    name: "이서연",
    username: "seoyeon",
    role: "member",
    sharesSpace: true,
  },
];
const spaces: ChatSpaceNav[] = [
  {
    voiceChannels: [],
    id: "00000000-0000-4000-8000-000000000011",
    kind: "team",
    iconColor: "blue",
    role: "admin",
    name: "디자인 팀",
    initial: "디",
    unread: true,
    unreadMentions: 2,
    muted: false,
    channels: [],
  },
  {
    voiceChannels: [],
    id: "00000000-0000-4000-8000-000000000012",
    kind: "branch",
    iconColor: "blue",
    role: "member",
    name: "강남점 라운지",
    initial: "강",
    unread: false,
    unreadMentions: 0,
    muted: false,
    channels: [],
  },
  {
    voiceChannels: [],
    id: communityId,
    kind: "community",
    iconColor: "green",
    role: "owner",
    name: "주말 러닝 크루",
    initial: "주",
    unread: true,
    unreadMentions: 1,
    muted: false,
    channels: [],
  },
];
const community: SpaceSettings = {
  id: communityId,
  kind: "community",
  name: "주말 러닝 크루",
  iconColor: "green",
  role: "owner",
  channels: [
    {
      id: "00000000-0000-4000-8000-000000000021",
      name: "일반",
      topic: "같이 뛰고 이야기해요",
      adminOnly: false,
    },
    {
      id: "00000000-0000-4000-8000-000000000022",
      name: "모임-공지",
      topic: "이번 주 모임 소식",
      adminOnly: true,
    },
  ],
};
const membersData: SpaceMembersView = {
  space: community,
  memberCount: members.length,
  view: "full",
  members,
  banned: [
    {
      userId: "00000000-0000-4000-8000-000000000004",
      name: "최도윤",
      username: "doyun",
      role: "member",
      sharesSpace: false,
    },
  ],
};
const nav: ChatNav = {
  filesEnabled: false,
  callsEnabled: false,
  calls: [],
  myCall: null,
  spaces,
  meetings: [],
  directMessages: [],
  myStatus: "online",
  blockedUserIds: [],
  now: "2026-10-09T03:00:00.000Z",
};
const candidates = Promise.resolve(
  members
    .slice(1)
    .map(({ userId, name, username }) => ({ userId, name, username })),
);
const code = "storybook-preview-code";

function Preview({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          enabled: false,
          retry: false,
          staleTime: Infinity,
          gcTime: Infinity,
        },
        mutations: { retry: false },
      },
    });
    client.setQueryData(["chat", "nav"], nav);
    for (const member of [
      ...members,
      ...(membersData.view === "full" ? membersData.banned : []),
    ]) {
      const profile: PersonProfile = {
        userId: member.userId,
        name: member.name,
        username: member.username,
        isMe: member.userId === me,
        relation: member.userId === me ? null : "friend",
        sharedSpaces: member.sharesSpace
          ? [{ id: community.id, name: community.name }]
          : [],
        directRoomId: null,
        canDirectMessage: false,
      };
      client.setQueryData(["people", member.userId], profile);
    }
    return client;
  });
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <div className="mx-auto w-full max-w-4xl p-6">{children}</div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
function CreateDialogPreview() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button onClick={() => setOpen(true)}>스페이스 만들기</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>스페이스 만들기</DialogTitle>
            <DialogDescription>
              함께 이야기할 커뮤니티를 만들어요
            </DialogDescription>
          </DialogHeader>
          <CreateSpaceForm onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}
function Overview({ space }: { space: SpaceSettings }) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{space.name} 설정</h1>
      <SpaceSettingsTabs space={space} selected="overview" />
      <SpaceOverview space={space} />
    </div>
  );
}

const meta = {
  title: "채팅/스페이스와 관리",
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <Preview>
        <Story />
      </Preview>
    ),
  ],
  parameters: {
    layout: "fullscreen",
    nextjs: {
      appDirectory: true,
      navigation: { pathname: `/s/${communityId}/settings` },
    },
    docs: {
      description: {
        component:
          "가상의 팀·라운지·커뮤니티예요. 쓰기는 Storybook 전용 거절 응답으로 대체하고 프로필은 메모리 데이터만 사용해요.",
      },
    },
  },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const RailKindsAndAdd: Story = {
  render: () => (
    <div className="flex gap-6">
      <aside className="w-16 shrink-0 rounded-xl bg-sidebar py-4">
        <ChatRailNavigation spaces={spaces} />
      </aside>
      <div className="space-y-2 pt-4">
        <h1 className="text-xl font-bold">스페이스</h1>
        <p>팀 → 지점 라운지 → 커뮤니티 순서예요.</p>
        <p className="text-sm text-muted-foreground">
          + 메뉴에서 스페이스 만들기와 초대 링크 참여를 열 수 있어요.
        </p>
      </div>
    </div>
  ),
};
export const CreateCommunity: Story = { render: () => <CreateDialogPreview /> };
export const InvitePeopleAndLink: Story = {
  render: () => (
    <SpaceInviteDialog
      spaceId={community.id}
      spaceName={community.name}
      candidates={candidates}
      returnHref={`/s/${community.id}/settings`}
    />
  ),
};
export const JoinOpen: Story = {
  render: () => (
    <SpaceJoin
      code={code}
      preview={{
        state: "open",
        spaceName: community.name,
        iconColor: "green",
        memberCount: 12,
      }}
    />
  ),
};
export const JoinAlreadyMember: Story = {
  render: () => (
    <SpaceJoin
      code={code}
      preview={{ state: "member", spaceId: community.id }}
    />
  ),
};
export const JoinInvalid: Story = {
  render: () => <SpaceJoin code={code} preview={{ state: "invalid" }} />,
};
export const CommunityOwnerMembers: Story = {
  render: () => <SpaceMembers data={membersData} currentUserId={me} />,
};
export const CommunityAdminMembers: Story = {
  render: () => (
    <SpaceMembers
      data={{ ...membersData, space: { ...community, role: "admin" } }}
      currentUserId={members[1]!.userId}
    />
  ),
};
export const LoungeLimitedMembers: Story = {
  render: () => (
    <SpaceMembers
      data={{
        view: "limited",
        space: { ...community, kind: "branch", name: "강남점", role: "member" },
        memberCount: 48,
        admins: [{ ...members[1]!, sharesSpace: false }],
      }}
      currentUserId={me}
    />
  ),
};
export const BannedMembers: Story = {
  render: () => <SpaceMembers data={membersData} currentUserId={me} banned />,
};
export const CommunitySettings: Story = {
  render: () => <Overview space={community} />,
};
export const TeamSettings: Story = {
  render: () => (
    <Overview
      space={{
        ...community,
        id: spaces[0]!.id,
        kind: "team",
        name: "디자인 팀",
        role: "admin",
      }}
    />
  ),
};
export const LoungeSettings: Story = {
  render: () => (
    <Overview
      space={{
        ...community,
        id: spaces[1]!.id,
        kind: "branch",
        name: "강남점",
        role: "member",
      }}
    />
  ),
};
export const SpaceMenus: Story = {
  render: () => (
    <div className="grid gap-6 md:grid-cols-3">
      {spaces.map((space) => (
        <div
          key={space.id}
          className="min-w-0 rounded-xl border border-border p-4"
        >
          <SpaceMenu space={space} />
        </div>
      ))}
    </div>
  ),
};
export const CreateChannel: Story = {
  render: () => (
    <ChannelDialog
      spaceId={community.id}
      returnHref={`/s/${community.id}/settings`}
    />
  ),
};
export const EditChannel: Story = {
  render: () => (
    <ChannelDialog
      spaceId={community.id}
      channel={community.channels[1]}
      returnHref={`/s/${community.id}/settings`}
    />
  ),
};
export const InviteLinks: Story = {
  render: () => (
    <SpaceInvitesList
      rows={[
        {
          inviteId: "00000000-0000-4000-8000-000000000031",
          codePrefix: "story1",
          createdByName: "김하은",
          expiresAt: "2026-10-16T03:00:00.000Z",
          useCount: 3,
          maxUses: 10,
        },
        {
          inviteId: "00000000-0000-4000-8000-000000000032",
          codePrefix: "story2",
          createdByName: "박지훈",
          expiresAt: null,
          useCount: 0,
          maxUses: null,
        },
      ]}
    />
  ),
};

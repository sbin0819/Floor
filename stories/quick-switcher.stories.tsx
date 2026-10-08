import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  QuickSwitcher,
  QuickSwitchButton,
} from "@/features/chat/components/quick-switcher";
import type { ChatNav } from "@/features/chat/types";
import type { MessageContact } from "@/features/people/types";

const id = (n: number) =>
  `76000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const data: ChatNav = {
  chatToasts: true,
  tabBadge: true,
  filesEnabled: false,
  callsEnabled: false,
  calls: [],
  myCall: null,
  spaces: [
    {
      voiceChannels: [],
      id: id(1),
      name: "책 읽는 모임",
      initial: "책",
      kind: "community",
      iconColor: "green",
      role: "member",
      unread: true,
      unreadMentions: 0,
      muted: false,
      channels: [
        {
          id: id(2),
          name: "일반",
          unread: true,
          unreadMentions: 0,
          muted: false,
        },
      ],
    },
  ],
  directMessages: [
    {
      roomId: id(3),
      kind: "dm",
      other: {
        avatar: { color: "blue" as const, photoUrl: null },
        userId: id(4),
        name: "김하은",
        username: "haeun",
      },
      lastSeq: 1,
      lastMessageAt: "2026-10-09T03:00:00.000Z",
      unread: true,
      unreadCount: 1,
      unreadMentions: 0,
      muted: false,
    },
  ],
  meetings: [
    {
      roomId: id(5),
      bookingId: id(6),
      title: "제품 리뷰",
      spaceName: "회의실 A",
      start: "2026-10-09T04:00:00.000Z",
      end: "2026-10-09T05:00:00.000Z",
      timezone: "Asia/Seoul",
      phase: "upcoming",
      unread: true,
      unreadMentions: 0,
      muted: false,
    },
  ],
  myStatus: "online",
  blockedUserIds: [],
  now: "2026-10-09T03:00:00.000Z",
};
const people: MessageContact[] = [
  {
    avatar: { color: "blue" as const, photoUrl: null },
    userId: id(4),
    name: "김하은",
    username: "haeun",
    sharedTeamNames: [],
    directRoomId: id(3),
    isFriend: true,
  },
  {
    avatar: { color: "blue" as const, photoUrl: null },
    userId: id(7),
    name: "정유나",
    username: "yuna",
    sharedTeamNames: ["가상 팀"],
    directRoomId: null,
    isFriend: false,
  },
];
function Example() {
  const [client] = useState(() => {
    const client = new QueryClient();
    client.setQueryData(["chat", "nav"], data);
    return client;
  });
  return (
    <QueryClientProvider client={client}>
      <div className="w-60">
        <QuickSwitchButton />
      </div>
      <QuickSwitcher
        userId={id(100)}
        readContacts={async () => people}
        openConversation={async () => ({ ok: false, code: "FORBIDDEN" })}
      />
    </QueryClientProvider>
  );
}
const meta = {
  title: "Chat/Quick switcher",
  component: Example,
  parameters: { nextjs: { appDirectory: true, navigation: { pathname: "/" } } },
} satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const RecentAndUnread: Story = {
  play: async ({ canvasElement }) => {
    canvasElement
      .querySelector<HTMLButtonElement>('button[aria-label="찾기"]')
      ?.click();
  },
};

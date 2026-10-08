import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DirectMessageScreen } from "@/features/chat/components/channel-screen";
import {
  emptyMessageDetails,
  type DirectMessageView,
} from "@/features/chat/types";

const me = "00000000-0000-4000-8000-000000000001";
const peer = "00000000-0000-4000-8000-000000000002";
const data: Extract<DirectMessageView, { kind: "dm" }> = {
  call: null,
  canCall: false,
  kind: "dm",
  request: null,
  blockedByMe: false,
  room: {
    id: "story-direct-message",
    archived: false,
    lastSeq: 4,
    muted: false,
    unreadMentions: 0,
  },
  other: {
    userId: peer,
    name: "이서연",
    username: "seoyeon.lee",
    sharesSpace: false,
  },
  user: { id: me, name: "김하은" },
  members: [
    { id: me, name: "김하은", admin: false },
    { id: peer, name: "이서연", admin: false },
  ],
  messages: [
    {
      ...emptyMessageDetails(),
      id: "direct-1",
      seq: 1,
      authorId: peer,
      authorName: "이서연",
      kind: "text",
      body: "다음 주 리뷰 전에 이야기 나눌까요?",
      createdAt: "2026-10-08T01:00:00Z",
      clientId: null,
    },
    {
      ...emptyMessageDetails(),
      id: "direct-2",
      seq: 2,
      authorId: me,
      authorName: "김하은",
      kind: "text",
      body: "좋아요. 준비한 자료를 함께 볼게요.",
      createdAt: "2026-10-08T01:01:00Z",
      clientId: null,
    },
    {
      ...emptyMessageDetails(),
      id: "direct-3",
      seq: 3,
      authorId: me,
      authorName: "김하은",
      kind: "text",
      body: "같은 분에 이어 보낸 내용은 시각을 한 번만 보여요.",
      createdAt: "2026-10-08T01:01:30Z",
      clientId: null,
    },
    {
      ...emptyMessageDetails(),
      id: "direct-4",
      seq: 4,
      authorId: me,
      authorName: "김하은",
      kind: "text",
      body: "마지막 메시지 아래에 읽음이 표시돼요.",
      createdAt: "2026-10-08T01:02:00Z",
      clientId: null,
      replyTo: {
        id: "direct-1",
        authorName: "이서연",
        excerpt: "다음 주 리뷰 전에 이야기 나눌까요?",
        deleted: false,
        attachmentSummary: null,
      },
    },
  ],
  lastReadSeq: 4,
  firstUnreadSeq: null,
  peerReadSeq: 4,
  canWrite: true,
  now: "2026-10-08T03:00:00Z",
};
function DirectExample({ empty = false }: { empty?: boolean }) {
  const [client] = useState(() => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false },
      },
    });
    client.setQueryDefaults(["people"], { enabled: false });
    for (const member of data.members)
      client.setQueryData(["people", member.id], {
        userId: member.id,
        name: member.name,
        username: null,
        isMe: member.id === me,
        relation: member.id === me ? null : "friend",
        sharedSpaces: [],
        directRoomId: null,
        canDirectMessage: false,
      });
    return client;
  });
  return (
    <QueryClientProvider client={client}>
      <DirectMessageScreen
        data={{
          ...data,
          messages: empty ? [] : data.messages,
          room: { ...data.room, lastSeq: empty ? 0 : 4 },
        }}
        send={async () => ({ ok: false, code: "INTERNAL" })}
      />
    </QueryClientProvider>
  );
}
const meta = {
  title: "Chat/Direct message",
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true } },
  render: () => <DirectExample />,
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const HeaderAndReadReceipt: Story = {};
export const FirstConversation: Story = {
  render: () => <DirectExample empty />,
};

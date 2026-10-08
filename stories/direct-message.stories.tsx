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
const data: DirectMessageView = {
  room: {
    id: "story-direct-message",
    archived: false,
    lastSeq: 2,
    muted: false,
    unreadMentions: 0,
  },
  other: { userId: peer, name: "이서연", username: "seoyeon.lee" },
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
  ],
  lastReadSeq: 2,
  firstUnreadSeq: null,
  peerReadSeq: 2,
  canWrite: true,
  now: "2026-10-08T03:00:00Z",
};
function DirectExample({ empty = false }: { empty?: boolean }) {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <DirectMessageScreen
        data={{
          ...data,
          messages: empty ? [] : data.messages,
          room: { ...data.room, lastSeq: empty ? 0 : 2 },
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

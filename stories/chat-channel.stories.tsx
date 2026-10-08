import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChannelScreen } from "@/features/chat/components/channel-screen";
import { ChannelSkeleton } from "@/features/chat/components/channel-skeleton";
import type { ChannelView } from "@/features/chat/types";
import { emptyMessageDetails } from "@/features/chat/types";

const data: ChannelView = {
  space: { id: "story-space", name: "디자인팀" },
  room: {
    id: "story-room",
    name: "일반",
    topic: "디자인팀 전체 이야기",
    archived: false,
    adminOnly: false,
    lastSeq: 3,
  },
  user: { id: "park", name: "박지훈" },
  members: [
    { id: "park", name: "박지훈", admin: true },
    { id: "lee", name: "이서연", admin: false },
  ],
  messages: [
    {
      ...emptyMessageDetails(),
      id: "first",
      seq: 1,
      authorId: "park",
      authorName: "박지훈",
      kind: "text",
      body: "디자인팀 채널을 열었어요. 리뷰 자료와 일정은 여기서 이야기해요.",
      createdAt: "2026-10-07T01:00:00Z",
      clientId: null,
    },
    {
      ...emptyMessageDetails(),
      id: "second",
      seq: 2,
      authorId: "lee",
      authorName: "이서연",
      kind: "text",
      body: "확인했어요. 오후에 코멘트 남길게요.",
      createdAt: "2026-10-08T00:10:00Z",
      clientId: null,
    },
    {
      ...emptyMessageDetails(),
      id: "third",
      seq: 3,
      authorId: "lee",
      authorName: "이서연",
      kind: "text",
      body: "오늘 3시 전에 다 같이 한 번 볼까요?\n일정 확인 부탁드려요.",
      createdAt: "2026-10-08T00:12:00Z",
      clientId: null,
    },
  ],
  canWrite: true,
  lastReadSeq: null,
  firstUnreadSeq: null,
  now: "2026-10-08T03:00:00Z",
};
function ChannelStory({
  readonly = false,
  empty = false,
  loading = false,
}: {
  readonly?: boolean;
  empty?: boolean;
  loading?: boolean;
}) {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      {loading ? (
        <ChannelSkeleton />
      ) : (
        <ChannelScreen
          data={{
            ...data,
            canWrite: !readonly,
            room: { ...data.room, adminOnly: readonly },
            messages: empty ? [] : data.messages,
          }}
          send={async () => ({ ok: false, code: "INTERNAL" })}
        />
      )}
    </QueryClientProvider>
  );
}
const meta = {
  title: "채팅/텍스트 채널",
  component: ChannelStory,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true } },
} satisfies Meta<typeof ChannelStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Conversation: Story = {};
export const Readonly: Story = { args: { readonly: true } };
export const Empty: Story = { args: { empty: true } };
export const Loading: Story = { args: { loading: true } };

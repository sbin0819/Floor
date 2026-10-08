import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChannelScreen } from "@/features/chat/components/channel-screen";
import { ChannelSkeleton } from "@/features/chat/components/channel-skeleton";
import { TypingIndicator } from "@/features/chat/components/typing-indicator";
import type { ChannelView } from "@/features/chat/types";
import { emptyMessageDetails } from "@/features/chat/types";
import { typingLabel } from "@/features/chat/typing";

const park = "00000000-0000-4000-8000-000000000001";
const lee = "00000000-0000-4000-8000-000000000002";

const data: ChannelView = {
  call: null,
  canCall: false,
  space: { id: "story-space", name: "디자인팀", muted: false },
  room: {
    kind: "text",
    id: "story-room",
    name: "일반",
    topic: "디자인팀 전체 이야기",
    archived: false,
    adminOnly: false,
    lastSeq: 3,
    muted: false,
    unreadMentions: 0,
  },
  user: { id: park, name: "박지훈" },
  members: [
    { id: park, name: "박지훈", admin: true },
    { id: lee, name: "이서연", admin: false },
  ],
  messages: [
    {
      ...emptyMessageDetails(),
      id: "first",
      seq: 1,
      authorId: park,
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
      authorId: lee,
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
      authorId: lee,
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
  example = "conversation",
}: {
  readonly?: boolean;
  empty?: boolean;
  loading?: boolean;
  example?: "conversation" | "formatted" | "deleted" | "reactions" | "reply";
}) {
  const [client] = useState(() => {
    const client = new QueryClient();
    client.setQueryData(["chat", "nav"], {
      callsEnabled: false,
      calls: [],
      myCall: null,
      spaces: [],
      directMessages: [],
      myStatus: "online",
      blockedUserIds: [],
      meetings: [],
      now: "2026-10-08T03:00:00.000Z",
    });
    return client;
  });
  const messages = data.messages.map((message, index) => {
    if (example === "formatted" && index === 1)
      return {
        ...message,
        body: `<@${park}> **리뷰 자료**를 함께 봐요. *다음 주*까지 \`pnpm test\`도 확인해 주세요.\nhttps://example.com/notes\n\`\`\`ts\nconst ready = true;\n\`\`\`\n<script>태그는 실행되지 않아요</script>`,
        mentions: [{ userId: park, name: "박지훈" }],
        editedAt: data.now,
      };
    if (example === "deleted" && index === 1)
      return { ...message, body: "", deletedAt: data.now };
    if (example === "reactions" && index === 1)
      return {
        ...message,
        reactions: [
          {
            emoji: "thumbs_up" as const,
            count: 3,
            mine: true,
            names: ["박지훈", "이서연", "김민수"],
          },
          { emoji: "tada" as const, count: 1, mine: false, names: ["이서연"] },
        ],
      };
    if (example === "reply" && index === 2)
      return {
        ...message,
        replyTo: {
          id: data.messages[0]!.id,
          authorName: "박지훈",
          excerpt: data.messages[0]!.body,
          deleted: false,
        },
      };
    return message;
  });
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
            messages: empty ? [] : messages,
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
export const FormattedMessage: Story = { args: { example: "formatted" } };
export const DeletedMessage: Story = { args: { example: "deleted" } };
export const Reactions: Story = { args: { example: "reactions" } };
export const Reply: Story = { args: { example: "reply" } };
export const Typing: Story = {
  render: () => (
    <div className="border-t border-border bg-background py-4">
      <TypingIndicator label={typingLabel(["이서연"])} />
    </div>
  ),
};

import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { ChannelScreen } from "@/features/chat/components/channel-screen";
import { ChannelSkeleton } from "@/features/chat/components/channel-skeleton";
import { MessageList } from "@/features/chat/components/message-list";
import type { MessageActions } from "@/features/chat/components/message-row";
import type { DisplayMessage } from "@/features/chat/components/message-state";
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
      filesEnabled: false,
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
          attachmentSummary: null,
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

function bubble(
  seq: number,
  mine: boolean,
  body: string,
  values: Partial<DisplayMessage> = {},
): DisplayMessage {
  return {
    ...emptyMessageDetails(),
    id: `bubble-${seq}`,
    seq,
    authorId: mine ? park : lee,
    authorName: mine ? "박지훈" : "이서연",
    kind: "text",
    body,
    createdAt: `2026-10-08T00:12:${String(seq * 5).padStart(2, "0")}Z`,
    clientId: mine ? `bubble-client-${seq}` : null,
    ...values,
  };
}
const bubbles: DisplayMessage[] = [
  bubble(1, false, "오늘 리뷰 자료를 같이 확인해요."),
  bubble(2, false, "같은 분에 보낸 메시지라 시각은 마지막에만 보여요."),
  bubble(3, true, "좋아요. 오전에 정리한 의견을 먼저 남길게요."),
  bubble(
    4,
    true,
    "**목록 폭**을 기준으로 긴 문장도 자연스럽게 접혀요. 한국어 낱말과 함께 아주긴문자열도확인해요_abcdefghijklmnopqrstuvwxyz_0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ.\n줄바꿈과 🙂 이모지도 그대로 읽을 수 있어요.",
  ),
  bubble(5, false, `<@${park}> 첨부한 화면과 수정안을 봐 주세요.`, {
    mentions: [{ userId: park, name: "박지훈" }],
    editedAt: data.now,
    reactions: [
      { emoji: "thumbs_up", count: 2, mine: true, names: ["박지훈", "이서연"] },
    ],
  }),
  bubble(6, true, "답장 원문은 말풍선 안에, 자료는 바로 아래에 붙어요.", {
    replyTo: {
      id: "bubble-5",
      authorName: "이서연",
      excerpt: "@박지훈 첨부한 화면과 수정안을 봐 주세요.",
      deleted: false,
      attachmentSummary: null,
    },
    attachments: [
      {
        id: "bubble-photo",
        name: "회의 공간 리뷰 — 가로 사진.webp",
        kind: "image",
        size: 2516582,
        width: 1200,
        height: 800,
      },
      {
        id: "bubble-photo-2",
        name: "함께 본 두 번째 사진.webp",
        kind: "image",
        size: 1258291,
        width: 1200,
        height: 800,
      },
    ],
  }),
  bubble(7, false, "", {
    attachments: [
      {
        id: "bubble-document",
        name: "디자인 검토 자료_긴파일이름_수정사항과결정내용_최종본_👩🏻‍💻.pdf",
        kind: "file",
        size: 830 * 1024,
        width: null,
        height: null,
      },
    ],
  }),
  bubble(8, true, "", { deletedAt: data.now }),
];
const sendStates: DisplayMessage[] = [
  bubble(1, false, "연결이 잠깐 끊겨도 입력한 메시지는 남아 있어요."),
  bubble(2, true, "이미 도착한 메시지예요."),
  bubble(3, true, "확인을 기다리는 메시지예요.", { delivery: "pending" }),
  bubble(4, true, "다시 보내기나 지우기를 눌러 볼 수 있어요.", {
    delivery: "failed",
    errorCode: "INTERNAL",
  }),
];
const attachmentUrl = (id: string) =>
  id === "bubble-photo-2"
    ? "/seed/photos/meeting-screen-clay.webp"
    : "/seed/photos/meeting-small-oak.webp";
const appendedBody =
  "같은 분에 이어 보낸 긴 메시지예요. 앞 메시지의 시각이 숨겨져도 본문 폭과 줄바꿈은 그대로여야 해요. 한국어 낱말이 읽기 좋게 이어지고, 아주긴문자열_abcdefghijklmnopqrstuvwxyz_0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ와 🙂 이모지도 목록 밖으로 나가지 않아요.\n두 번째 문단도 같은 내용으로 추가해 가상 목록의 측정과 맨 아래 위치 유지를 확인해요.";

function BubbleExample({
  states = false,
  width = 1280,
}: {
  states?: boolean;
  width?: number;
}) {
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
        isMe: member.id === park,
        relation: member.id === park ? null : "friend",
        sharedSpaces: [],
        directRoomId: null,
        canDirectMessage: false,
      });
    return client;
  });
  const [messages, setMessages] = useState(states ? sendStates : bubbles);
  const [notice, setNotice] = useState("");
  const [jumpToId, setJumpToId] = useState<string | null>(null);
  function appendMessage(mine: boolean) {
    setMessages((previous) => {
      const seq = Math.max(0, ...previous.map((row) => row.seq)) + 1;
      return [
        ...previous,
        bubble(seq, mine, appendedBody, {
          id: `bubble-appended-${seq}`,
          clientId: mine ? `bubble-appended-client-${seq}` : null,
          createdAt: previous.at(-1)?.createdAt ?? data.now,
        }),
      ];
    });
  }
  const actions: MessageActions = {
    userId: park,
    canWrite: true,
    canReact: true,
    admin: true,
    filesEnabled: true,
    fileUrl: attachmentUrl,
    names: new Map(data.members.map(({ id, name }) => [id, name])),
    react: async (message, emoji, on) => {
      setMessages((previous) =>
        previous.map((row) => {
          if (row.id !== message.id) return row;
          const old = row.reactions.find(
            (reaction) => reaction.emoji === emoji,
          );
          const people = new Set(old?.names ?? []);
          if (on) people.add("박지훈");
          else people.delete("박지훈");
          return {
            ...row,
            reactions: [
              ...row.reactions.filter((reaction) => reaction.emoji !== emoji),
              ...(people.size
                ? [{ emoji, count: people.size, mine: on, names: [...people] }]
                : []),
            ],
          };
        }),
      );
      return true;
    },
    onReply: () => setNotice("미리보기: 답장을 선택했어요"),
    onEdit: () => setNotice("미리보기: 수정을 선택했어요"),
    onReport: () => setNotice("미리보기: 신고를 선택했어요"),
    onDelete: (message) =>
      setMessages((previous) =>
        previous.map((row) =>
          row.id === message.id
            ? {
                ...row,
                body: "",
                deletedAt: data.now,
                attachments: [],
                reactions: [],
              }
            : row,
        ),
      ),
    onJump: setJumpToId,
  };
  return (
    <QueryClientProvider client={client}>
      <section
        className="mx-auto flex h-[min(900px,calc(100dvh-3rem))] min-h-96 w-full flex-col overflow-hidden rounded-xl border border-border bg-background"
        style={{ maxWidth: width }}
        aria-label={states ? "보내기 상태 미리보기" : "말풍선 미리보기"}
      >
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
          <div>
            <h2 className="font-bold">
              # 일반 · {states ? "보내기 상태" : "말풍선"}
            </h2>
            <p className="text-xs text-muted-foreground">
              가짜 데이터예요. 서버에 저장하지 않아요.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!states && (
              <>
                <Button
                  variant="outline"
                  data-bubble-append
                  onClick={() => appendMessage(true)}
                >
                  같은 분 메시지 추가
                </Button>
                <Button
                  variant="outline"
                  data-bubble-append-other
                  onClick={() => appendMessage(false)}
                >
                  다른 사람 메시지 추가
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              onClick={() => {
                setMessages(states ? sendStates : bubbles);
                setNotice("");
              }}
            >
              처음으로
            </Button>
          </div>
        </header>
        <MessageList
          messages={messages}
          channelName="일반"
          now={data.now}
          userId={park}
          actions={actions}
          jumpToId={jumpToId}
          onRetry={(message) => {
            setMessages((previous) =>
              previous.map((row) =>
                row.id === message.id
                  ? { ...row, delivery: undefined, errorCode: undefined }
                  : row,
              ),
            );
            setNotice("미리보기: 다시 보냈어요");
          }}
          onRemove={(message) =>
            setMessages((previous) =>
              previous.filter((row) => row.id !== message.id),
            )
          }
        />
        {notice && (
          <p
            role="status"
            className="shrink-0 border-t border-border px-4 py-2 text-sm text-muted-foreground"
          >
            {notice}
          </p>
        )}
      </section>
      <Toaster />
    </QueryClientProvider>
  );
}

export const Bubbles: Story = { render: () => <BubbleExample /> };
export const BubblesInSheet: Story = {
  render: () => <BubbleExample width={420} />,
};
export const BubblesMobile: Story = {
  render: () => <BubbleExample width={390} />,
};
export const SendStates: Story = {
  render: () => <BubbleExample states />,
};

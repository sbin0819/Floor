import { useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { MessageRequestBanner } from "@/features/chat/components/message-request-banner";
import { ReportDialog } from "@/features/people/components/moderation-dialogs";
import { MessageList } from "@/features/chat/components/message-list";
import { DirectMessageScreen } from "@/features/chat/components/channel-screen";
import { ChannelMembers } from "@/features/chat/components/channel-members";
import { StatusDot } from "@/features/people/components/person-status";
import {
  emptyMessageDetails,
  type ChatMessage,
  type DirectMessageView,
} from "@/features/chat/types";
import type { ActionResult } from "@/lib/actions/result";

const readonlyAction = async (): Promise<ActionResult<never>> => ({
  ok: false,
  code: "FORBIDDEN",
});
const me = "00000000-0000-4000-8000-000000000001";
const peer = "00000000-0000-4000-8000-000000000002";
const other = {
  userId: peer,
  name: "박지훈",
  username: "jihoon.park",
  sharesSpace: true,
};
const now = "2026-10-08T03:00:00Z";
const messages: ChatMessage[] = [1, 2, 3].map((seq) => ({
  ...emptyMessageDetails(),
  id: `message-${seq}`,
  seq,
  authorId: seq === 3 ? me : peer,
  authorName: seq === 3 ? "김하은" : "박지훈",
  kind: "text",
  body:
    seq === 3
      ? "다음 회의는 내일 이어서 할게요."
      : "같은 사람의 연속 메시지는 한 묶음으로 접혀요.",
  createdAt: now,
  clientId: null,
}));
const group: DirectMessageView = {
  call: null,
  canCall: false,
  kind: "group_dm",
  room: {
    id: "group",
    archived: false,
    lastSeq: 4,
    muted: false,
    unreadMentions: 0,
  },
  name: "디자인 리뷰",
  displayName: "디자인 리뷰",
  user: { id: me, name: "김하은" },
  members: [
    { userId: me, name: "김하은", username: "haeun.kim", sharesSpace: true },
    { ...other },
    {
      userId: "00000000-0000-4000-8000-000000000003",
      name: "최서연",
      username: "seoyeon",
      sharesSpace: true,
    },
  ],
  messages: [
    {
      ...emptyMessageDetails(),
      id: "system",
      seq: 1,
      authorId: null,
      authorName: null,
      kind: "system",
      body: "김하은 님이 그룹을 만들었어요",
      systemData: { type: "group_created", actorName: "김하은" },
      createdAt: now,
      clientId: null,
    },
    ...messages.map((message) => ({ ...message, seq: message.seq + 1 })),
  ],
  lastReadSeq: 4,
  firstUnreadSeq: null,
  canWrite: true,
  now,
};
const contacts = Promise.resolve([]);
function Frame({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    const client = new QueryClient();
    client.setQueryData(["chat", "nav"], {
      filesEnabled: false,
      callsEnabled: false,
      calls: [],
      myCall: null,
      spaces: [],
      directMessages: [],
      blockedUserIds: [],
      meetings: [],
      now: "2026-10-08T03:00:00.000Z",
      myStatus: "online",
    });
    return client;
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function ReportExample() {
  const [open, setOpen] = useState(true);
  return (
    <Frame>
      <Button onClick={() => setOpen(true)}>신고 대화상자 열기</Button>
      <ReportDialog
        target={other}
        open={open}
        onOpenChange={setOpen}
        report={readonlyAction}
        block={readonlyAction}
      />
    </Frame>
  );
}
const meta = {
  title: "Chat/Requests groups and safety",
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true } },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const IncomingRequest: Story = {
  render: () => (
    <Frame>
      <MessageRequestBanner
        roomId="request"
        other={other}
        request={{ role: "recipient" }}
        respond={readonlyAction}
        block={readonlyAction}
      />
    </Frame>
  ),
};
export const OutgoingRequest: Story = {
  render: () => (
    <Frame>
      <MessageRequestBanner
        roomId="request"
        other={other}
        request={{ role: "sender", sentCount: 3 }}
        respond={readonlyAction}
        block={readonlyAction}
      />
    </Frame>
  ),
};
export const FoldedMessages: Story = {
  render: () => (
    <Frame>
      <div className="flex h-96">
        <MessageList
          messages={messages}
          userId={me}
          channelName="일반"
          now={now}
          blockedUserIds={[peer]}
          onRetry={() => {}}
          onRemove={() => {}}
        />
      </div>
    </Frame>
  ),
};
export const Report: Story = { render: () => <ReportExample /> };
export const GroupConversation: Story = {
  render: () => (
    <Frame>
      <DirectMessageScreen
        data={group}
        contacts={contacts}
        send={readonlyAction}
      />
    </Frame>
  ),
};
export const GroupMembers: Story = {
  render: () => (
    <Frame>
      <div className="w-60 border border-border bg-sidebar">
        <ChannelMembers
          members={[
            { id: me, name: "김하은", admin: false, sharesSpace: true },
            { id: peer, name: "박지훈", admin: false, sharesSpace: false },
          ]}
        />
      </div>
    </Frame>
  ),
};
export const SystemMessages: Story = {
  render: () => (
    <Frame>
      <div className="flex h-96">
        <MessageList
          messages={[
            {
              ...messages[0]!,
              id: "s1",
              authorId: null,
              authorName: null,
              kind: "system",
              systemData: { type: "group_created", actorName: "김하은" },
            },
            {
              ...messages[0]!,
              id: "s2",
              seq: 2,
              authorId: null,
              authorName: null,
              kind: "system",
              systemData: {
                type: "members_added",
                actorName: "김하은",
                names: ["박지훈"],
              },
            },
            {
              ...messages[0]!,
              id: "s3",
              seq: 3,
              authorId: null,
              authorName: null,
              kind: "system",
              systemData: {
                type: "room_renamed",
                actorName: "김하은",
                name: "디자인 리뷰",
              },
            },
            {
              ...messages[0]!,
              id: "s4",
              seq: 4,
              authorId: null,
              authorName: null,
              kind: "system",
              systemData: { type: "member_left", name: "박지훈" },
            },
          ]}
          userId={me}
          channelName="그룹"
          now={now}
          onRetry={() => {}}
          onRemove={() => {}}
        />
      </div>
    </Frame>
  ),
};
export const PresenceStates: Story = {
  render: () => (
    <div className="flex gap-6 p-6">
      {(["online", "away", "dnd", "offline"] as const).map((status) => (
        <StatusDot key={status} status={status} />
      ))}
    </div>
  ),
};

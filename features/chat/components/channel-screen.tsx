"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useIsMutating, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  defaultModerationActions,
  UnblockButton,
} from "@/features/people/components/person-actions";
import { ReportDialog } from "@/features/people/components/moderation-dialogs";
import type { MessageContact } from "@/features/people/types";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useRealtimeConnectionState } from "@/components/realtime-provider";
import type {
  ChannelView,
  ChatReply,
  DirectMessageView,
  MeetingView,
} from "../types";
import type { RoomMessageSource } from "../room-message-source";
import { excerptOf, summarizeAttachments } from "../message-text";
import { releaseRoomViewport, reportRoomViewport } from "../nav-state";
import { RoomMembersPanel } from "./room-members-panel";
import { MessageComposer } from "./message-composer";
import { MessageList } from "./message-list";
import { MessageDeleteDialog } from "./message-delete-dialog";
import { MessageEditor } from "./message-editor";
import {
  ChatRoomHeader,
  type ChatRoomPresentation,
  type DirectOther,
} from "./chat-room-header";
import {
  MeetingHeader,
  MeetingBookingCard,
  MeetingMembers,
} from "./meeting-room-presentation";
import { meetingName } from "../meeting-format";
import { TypingIndicator } from "./typing-indicator";
import { useMessageMutations } from "./use-message-mutations";
import { useTyping } from "./use-typing";
import type { DisplayMessage } from "./message-state";
import { useMessageHistory } from "./use-message-history";
import { useRoomRead } from "./use-room-read";
import { useDirectPeerRead } from "./use-direct-peer-read";
import { useChatMetadata } from "./use-chat-metadata";
import { MessageRequestBanner } from "./message-request-banner";
import { respondMessageRequest } from "@/features/chat/actions";
import { GroupDialogs, type GroupDialog } from "./group-dialogs";
import { useRoomRealtime } from "./use-room-realtime";
import {
  useChannelMessages,
  type SendChatMessage,
} from "./use-channel-messages";
import { RoomCallBoundary } from "@/features/calls/components/room-call-area";
import type { CallTarget } from "@/features/calls/client/types";
import type { CallView } from "@/features/calls/types";

type RoomCallContext = {
  target: CallTarget;
  initialCall: CallView | null;
  canCall: boolean;
};

const wideServerSnapshot = () => true;
function useWideMembers() {
  const media = useMemo(
    () =>
      typeof window === "undefined" || !window.matchMedia
        ? null
        : window.matchMedia("(min-width: 1280px)"),
    [],
  );
  const subscribe = useCallback(
    (listener: () => void) => {
      media?.addEventListener("change", listener);
      return () => media?.removeEventListener("change", listener);
    },
    [media],
  );
  const snapshot = useCallback(() => media?.matches ?? true, [media]);
  return useSyncExternalStore(subscribe, snapshot, wideServerSnapshot);
}

export function ChannelScreen({
  data,
  send,
}: {
  data: ChannelView;
  send?: SendChatMessage;
}) {
  const target = useMemo<CallTarget>(
    () => ({
      roomId: data.room.id,
      roomKind: data.room.kind,
      name: data.room.name,
      href: `/s/${data.space.id}/${data.room.id}`,
      participants: data.call?.participants ?? [],
    }),
    [data.room.id, data.room.kind, data.room.name, data.space.id, data.call],
  );
  return (
    <ChatRoomScreen
      data={data}
      callContext={{ target, initialCall: data.call, canCall: data.canCall }}
      send={send}
      presentation={{
        kind: "channel",
        name: data.room.name,
        topic: data.room.topic,
        archived: data.room.archived,
      }}
    />
  );
}

export function DirectMessageScreen({
  data,
  send,
  contacts,
}: {
  data: DirectMessageView;
  send?: SendChatMessage;
  contacts?: Promise<MessageContact[]>;
}) {
  const target = useMemo<CallTarget>(
    () => ({
      roomId: data.room.id,
      roomKind: data.kind,
      name: data.kind === "dm" ? data.other.name : data.displayName,
      href: `/dm/${data.room.id}`,
      participants:
        data.call?.participants ??
        (data.kind === "dm"
          ? [
              { userId: data.user.id, name: data.user.name },
              { userId: data.other.userId, name: data.other.name },
            ]
          : []),
    }),
    [data],
  );
  const source = useMemo(
    () =>
      data.kind === "group_dm"
        ? {
            ...data,
            members: data.members.map((member) => ({
              id: member.userId,
              name: member.name,
              admin: false,
              sharesSpace: member.sharesSpace,
            })),
          }
        : data,
    [data],
  );
  return (
    <ChatRoomScreen
      data={source}
      callContext={{ target, initialCall: data.call, canCall: data.canCall }}
      send={send}
      presentation={
        data.kind === "group_dm"
          ? {
              kind: "group_dm",
              archived: data.room.archived,
              name: data.displayName,
              originalName: data.name,
              contacts,
            }
          : {
              kind: "dm",
              other: data.other,
              peerReadSeq: data.peerReadSeq,
              request: data.request,
              blockedByMe: data.blockedByMe,
            }
      }
    />
  );
}

export function MeetingScreen({
  data,
  send,
  variant = "page",
  actions,
}: {
  data: MeetingView;
  send?: SendChatMessage;
  variant?: "page" | "sheet";
  actions?: ReactNode;
}) {
  const target = useMemo<CallTarget>(
    () => ({
      roomId: data.room.id,
      roomKind: "meeting",
      name: meetingName(data.booking),
      href: `/m/${data.booking.id}`,
      participants: data.call?.participants ?? [],
    }),
    [data.room.id, data.booking, data.call],
  );
  const source = useMemo(
    () => ({
      ...data,
      members: data.members.map((member) => ({
        id: member.userId,
        name: member.name,
        admin: false,
        sharesSpace: member.sharesSpace,
      })),
    }),
    [data],
  );
  return (
    <ChatRoomScreen
      data={source}
      callContext={{ target, initialCall: data.call, canCall: data.canCall }}
      send={send}
      presentation={{ kind: "meeting", data, variant, actions }}
    />
  );
}

function ChatRoomScreen({
  data,
  send,
  presentation,
  callContext,
}: {
  data: RoomMessageSource;
  send?: SendChatMessage;
  callContext?: RoomCallContext;
  presentation:
    | ChatRoomPresentation
    | {
        kind: "meeting";
        data: MeetingView;
        variant: "page" | "sheet";
        actions?: ReactNode;
      };
}) {
  const direct = presentation.kind === "dm" ? presentation : null;
  const group = presentation.kind === "group_dm" ? presentation : null;
  const meeting = presentation.kind === "meeting" ? presentation : null;
  const compact = meeting?.variant === "sheet";
  const archived =
    (presentation.kind === "channel" || presentation.kind === "group_dm") &&
    presentation.archived;
  const metadata = useChatMetadata();
  const denied = useRoomRealtime(data.room.id);
  const roomName =
    presentation.kind === "meeting"
      ? meetingName(presentation.data.booking)
      : presentation.kind !== "dm"
        ? presentation.name
        : presentation.other.name;
  const peerRead = useDirectPeerRead(
    data.room.id,
    direct?.other.userId ?? null,
    direct?.peerReadSeq ?? 0,
  );
  const messages = useChannelMessages(
    data,
    send,
    direct ? peerRead.receivePage : undefined,
    presentation.kind === "dm" || presentation.kind === "group_dm"
      ? presentation.kind
      : false,
  );
  const sentSinceSnapshot = messages.messages.filter(
    (message) =>
      message.authorId === data.user.id &&
      (message.seq > data.room.lastSeq || message.delivery === "pending"),
  ).length;
  const requestLimit =
    direct?.request?.role === "sender" &&
    direct.request.sentCount + sentSinceSnapshot >= 3;
  const canWrite = data.canWrite && !direct?.blockedByMe && !requestLimit;
  const { reportVisible } = messages;
  const typing = useTyping({
    roomId: data.room.id,
    user: data.user,
    members: metadata.blockedUserIds
      ? data.members.filter(
          (member) => !metadata.blockedUserIds!.includes(member.id),
        )
      : [],
    enabled:
      !archived &&
      (!meeting || data.canWrite) &&
      direct?.request?.role !== "recipient" &&
      (!direct || data.canWrite),
  });
  const selectedMessage = useSearchParams().get("message");
  const mutations = useMessageMutations({
    roomId: data.room.id,
    userId: data.user.id,
    members: data.members,
  });
  const [deleteState, setDeleting] = useState<{
    roomId: string;
    message: DisplayMessage;
  } | null>(null);
  const deleting =
    deleteState?.roomId === data.room.id ? deleteState.message : null;
  const deleteOrigin = useRef<string | null>(null);
  const channelRef = useRef<HTMLElement>(null);
  const [reportState, setReporting] = useState<{
    roomId: string;
    message: DisplayMessage;
  } | null>(null);
  const reporting =
    reportState?.roomId === data.room.id ? reportState.message : null;
  const reportOrigin = useRef<string | null>(null);
  const [groupDialog, setGroupDialog] = useState<GroupDialog>(null);
  const groupMenu = useRef<HTMLButtonElement>(null);
  const groupDialogOrigin = useRef<HTMLButtonElement | null>(null);
  const admin =
    presentation.kind === "channel" &&
    data.members.some((member) => member.id === data.user.id && member.admin);
  const [replyState, setReply] = useState<{
    roomId: string;
    reply: ChatReply;
  } | null>(null);
  const [editState, setEditing] = useState<{
    roomId: string;
    messageId: string;
  } | null>(null);
  const [composerFocus, setComposerFocus] = useState(0);
  const reply = replyState?.roomId === data.room.id ? replyState.reply : null;
  const editingId =
    canWrite && editState?.roomId === data.room.id ? editState.messageId : null;
  const names = new Map(data.members.map(({ id, name }) => [id, name]));
  const candidates = data.members
    .filter(({ id }) => !direct || id === direct.other.userId)
    .map(({ id, name }) => ({ userId: id, name }));
  const latestOwnMessage =
    direct && !direct.request
      ? messages.messages.findLast(
          (message) =>
            message.authorId === data.user.id &&
            !message.delivery &&
            message.seq > 0,
        )
      : undefined;
  const readReceiptMessageId =
    latestOwnMessage && peerRead.seq >= latestOwnMessage.seq
      ? latestOwnMessage.id
      : null;
  const edit = (message: DisplayMessage) =>
    setEditing({ roomId: data.room.id, messageId: message.id });
  const replyTo = (message: DisplayMessage) => {
    const messageNames = new Map(names);
    for (const mention of message.mentions)
      messageNames.set(mention.userId, mention.name);
    setReply({
      roomId: data.room.id,
      reply: {
        id: message.id,
        authorName: message.authorName,
        excerpt: excerptOf(message.body, messageNames, message.attachments),
        deleted: Boolean(message.deletedAt),
        attachmentSummary: message.deletedAt
          ? null
          : summarizeAttachments(message.attachments),
      },
    });
    setComposerFocus((version) => version + 1);
  };
  const returnMessageFocus = (id: string | null) => {
    [
      ...(channelRef.current?.querySelectorAll<HTMLElement>(
        "[data-message-id]",
      ) ?? []),
    ]
      .find((element) => element.dataset.messageId === id)
      ?.querySelector<HTMLElement>("article")
      ?.focus();
  };
  const client = useQueryClient();
  const sendingCount = useIsMutating({ mutationKey: ["chat", "send"] });
  const resetVersion = messages.historyReset?.version ?? 0;
  const oldestSeq =
    messages.messages.find((message) => message.seq > 0)?.seq ?? null;
  const history = useMessageHistory(
    data.room.id,
    data.user.id,
    oldestSeq,
    resetVersion,
  );
  const [visible, setVisible] = useState<{
    roomId: string;
    seq: number | null;
  }>({ roomId: data.room.id, seq: null });
  const onViewport = useCallback(
    (atBottom: boolean, seq: number | null, visibleSeq?: number | null) => {
      reportRoomViewport(client, data.room.id, atBottom);
      reportVisible(visibleSeq ?? seq);
      setVisible((previous) =>
        previous.roomId === data.room.id && previous.seq === seq
          ? previous
          : { roomId: data.room.id, seq },
      );
    },
    [client, data.room.id, reportVisible],
  );
  useEffect(
    () => () => releaseRoomViewport(client, data.room.id),
    [client, data.room.id],
  );
  const knownReadSeq = messages.messages.reduce(
    (seq, message) =>
      message.authorId === data.user.id ? Math.max(seq, message.seq) : seq,
    Math.max(data.lastReadSeq ?? 0, messages.historyReset?.lastReadSeq ?? 0),
  );
  useRoomRead({
    roomId: data.room.id,
    visibleSeq: visible.roomId === data.room.id ? visible.seq : null,
    knownReadSeq,
    blocked:
      denied ||
      sendingCount > 0 ||
      messages.sending ||
      messages.messages.some((message) => message.delivery === "pending"),
  });
  const connection = useRealtimeConnectionState();
  const [membersOpen, setMembersOpen] = useState(false);
  const wide = useWideMembers();
  const membersId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const memberPanel = meeting ? (
    <MeetingMembers members={meeting.data.members} />
  ) : (
    <RoomMembersPanel
      members={data.members}
      group={
        group
          ? {
              canAdd: data.canWrite && Boolean(group.contacts),
              onAction: (action, origin) => {
                groupDialogOrigin.current = origin;
                setGroupDialog(action);
              },
            }
          : undefined
      }
    />
  );
  if (denied)
    return (
      <section
        data-chat-screen={compact ? undefined : ""}
        className={
          compact
            ? "flex h-full min-h-0 flex-col items-center justify-center gap-4"
            : "flex h-[calc(100dvh-3.5rem)] flex-col items-center justify-center gap-4"
        }
      >
        {compact && meeting?.actions && (
          <div className="flex w-full shrink-0 justify-end gap-1 px-4">
            {meeting.actions}
          </div>
        )}
        <p>이 대화를 더 볼 수 없어요</p>
        <Button asChild variant="outline">
          <Link href="/messages">메시지 목록</Link>
        </Button>
      </section>
    );
  const content = (
    <section
      ref={channelRef}
      data-chat-screen={compact ? undefined : ""}
      className={
        compact || callContext
          ? "flex h-full min-h-0 flex-col bg-background"
          : "flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col bg-background"
      }
    >
      {presentation.kind === "meeting" ? (
        <MeetingHeader
          data={presentation.data}
          compact={compact}
          actions={presentation.actions}
          trigger={trigger}
          membersOpen={membersOpen}
          membersId={membersId}
          onToggleMembers={() => setMembersOpen((open) => !open)}
        />
      ) : (
        <ChatRoomHeader
          data={data}
          presentation={presentation}
          roomName={roomName}
          trigger={trigger}
          membersOpen={membersOpen}
          membersId={membersId}
          onToggleMembers={() => setMembersOpen((open) => !open)}
          groupMenu={groupMenu}
          groupDialogOpen={groupDialog !== null}
          onRename={() => {
            groupDialogOrigin.current = groupMenu.current;
            setGroupDialog("rename");
          }}
        />
      )}
      {meeting && <MeetingBookingCard data={meeting.data} compact={compact} />}
      {direct?.request && !direct.blockedByMe && (
        <MessageRequestBanner
          roomId={data.room.id}
          other={direct.other}
          request={direct.request}
          respond={(input) => respondMessageRequest(input)}
          block={defaultModerationActions.block}
        />
      )}
      {(connection === "disconnected" ||
        connection === "suspended" ||
        connection === "failed" ||
        (messages.reconnecting && connection !== "disabled")) && (
        <p
          role="status"
          className="shrink-0 border-b border-border bg-muted px-4 py-2 text-sm text-muted-foreground"
        >
          연결이 끊겼어요. 다시 연결하고 있어요
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {metadata.blockedUserIds === undefined && !direct ? (
            <div
              role="status"
              aria-label="메시지 표시 정보를 불러오고 있어요"
              className="min-h-0 flex-1 space-y-4 p-6"
            >
              <Skeleton className="h-14 w-2/3" />
              <Skeleton className="h-14 w-3/4" />
              <Skeleton className="h-14 w-1/2" />
            </div>
          ) : (
            <MessageList
              key={`${data.room.id}:${resetVersion}`}
              channelName={roomName}
              introduction={
                direct ? <DirectIntroduction other={direct.other} /> : undefined
              }
              readReceiptMessageId={readReceiptMessageId}
              now={data.now}
              userId={data.user.id}
              messages={messages.messages}
              blockedUserIds={!direct ? metadata.blockedUserIds : undefined}
              firstUnreadSeq={
                messages.historyReset
                  ? messages.historyReset.firstUnreadSeq
                  : data.firstUnreadSeq
              }
              liveMessages={messages.liveMessages}
              hasMore={history.hasMore}
              loadingOlder={history.loading}
              historyError={history.error}
              onLoadOlder={history.loadOlder}
              onViewport={onViewport}
              onRetry={messages.retry}
              onRemove={messages.remove}
              editingId={editingId}
              focusMessageId={editingId}
              jumpToId={selectedMessage}
              renderEditor={(message) => (
                <MessageEditor
                  key={message.id}
                  messageId={message.id}
                  body={message.body}
                  hasAttachments={message.attachments.length > 0}
                  names={
                    new Map([
                      ...names,
                      ...message.mentions.map(
                        ({ userId, name }) => [userId, name] as const,
                      ),
                    ])
                  }
                  members={candidates}
                  allowEveryone={Boolean(direct || group || meeting) || admin}
                  onSave={mutations.edit}
                  onCancel={() => {
                    setEditing(null);
                    requestAnimationFrame(() => returnMessageFocus(message.id));
                  }}
                />
              )}
              actions={{
                userId: data.user.id,
                canWrite,
                canReact: direct || meeting ? canWrite : !archived,
                admin,
                names,
                react: mutations.react,
                onDelete: (message) => {
                  deleteOrigin.current = message.id;
                  setDeleting({ roomId: data.room.id, message });
                },
                onEdit: edit,
                onReply: replyTo,
                onReport: (message) => {
                  reportOrigin.current = message.id;
                  setReporting({ roomId: data.room.id, message });
                },
              }}
            />
          )}
          {canWrite ? (
            <MessageComposer
              key={data.room.id}
              channelName={roomName}
              placeholder={
                direct?.request?.role === "recipient"
                  ? "답장하면 요청을 수락해요"
                  : direct
                    ? `${roomName} 님에게 메시지 보내기`
                    : group || meeting
                      ? `${roomName}에 메시지 보내기`
                      : undefined
              }
              onSend={(body, reply) => {
                messages.submit(body, reply);
                typing.stopTyping();
              }}
              onInput={typing.onInput}
              members={candidates}
              allowEveryone={Boolean(direct || group || meeting) || admin}
              reply={reply}
              onClearReply={() => setReply(null)}
              focusVersion={composerFocus}
              onEditLast={() => {
                const last = messages.messages.findLast(
                  (message) =>
                    message.authorId === data.user.id &&
                    message.kind === "text" &&
                    !message.deletedAt &&
                    !message.delivery,
                );
                if (last) edit(last);
              }}
            />
          ) : (
            <div className="shrink-0 space-y-2 border-t border-border p-5 text-center text-sm text-muted-foreground">
              <p>
                {direct?.blockedByMe
                  ? "차단한 사용자예요"
                  : requestLimit
                    ? "상대가 수락하면 더 보낼 수 있어요"
                    : meeting
                      ? meeting.data.readOnlyReason === "cancelled"
                        ? "취소된 예약이라 읽기 전용이에요"
                        : "회의가 끝나고 24시간이 지나 읽기 전용이에요"
                      : direct || group
                        ? "이 대화에는 메시지를 보낼 수 없어요"
                        : archived
                          ? "보관된 채널이에요"
                          : "이 채널에는 관리자만 쓸 수 있어요"}
              </p>
              {direct?.blockedByMe && (
                <UnblockButton userId={direct.other.userId} />
              )}
            </div>
          )}
          <TypingIndicator label={typing.label} />
        </div>
        {!direct && !compact && wide && membersOpen && (
          <aside
            id={membersId}
            aria-label={
              meeting ? "회의 멤버" : group ? "그룹 멤버" : "채널 멤버"
            }
            className="w-60 shrink-0 overflow-y-auto border-l border-border bg-sidebar"
          >
            <h2 className="px-4 pt-5 text-xs font-semibold text-muted-foreground">
              멤버 · {data.members.length}
            </h2>
            {memberPanel}
          </aside>
        )}
      </div>
      <MessageDeleteDialog
        key={`${data.room.id}:${deleting?.id ?? "none"}`}
        message={deleting}
        userId={data.user.id}
        onClose={() => setDeleting(null)}
        onDelete={mutations.remove}
        onReturnFocus={() => returnMessageFocus(deleteOrigin.current)}
      />
      {reporting?.authorId && (
        <ReportDialog
          key={reporting.id}
          target={{
            userId: reporting.authorId,
            name: reporting.authorName ?? "사용자",
            messageId: reporting.id,
          }}
          open
          onOpenChange={(open) => {
            if (!open) setReporting(null);
          }}
          report={defaultModerationActions.reportMessage}
          block={defaultModerationActions.block}
          onReturnFocus={() => returnMessageFocus(reportOrigin.current)}
        />
      )}
      {group?.contacts && (
        <GroupDialogs
          roomId={data.room.id}
          name={group.originalName}
          memberIds={data.members.map((member) => member.id)}
          contacts={group.contacts}
          dialog={groupDialog}
          onClose={() => setGroupDialog(null)}
          onReturnFocus={() => {
            if (groupDialogOrigin.current?.isConnected)
              groupDialogOrigin.current.focus();
            else trigger.current?.focus();
          }}
        />
      )}
      {!direct && !compact && (
        <Sheet open={!wide && membersOpen} onOpenChange={setMembersOpen}>
          <SheetContent
            id={membersId}
            side="right"
            showCloseButton={false}
            aria-describedby={undefined}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              trigger.current?.focus();
            }}
          >
            <SheetHeader>
              <SheetTitle>
                {meeting ? "회의 멤버" : group ? "그룹 멤버" : "채널 멤버"}
              </SheetTitle>
            </SheetHeader>
            <SheetClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2"
                aria-label="멤버 목록 닫기"
              >
                <X aria-hidden="true" />
              </Button>
            </SheetClose>
            <div className="overflow-y-auto">{memberPanel}</div>
          </SheetContent>
        </Sheet>
      )}
    </section>
  );
  return callContext ? (
    <RoomCallBoundary
      key={callContext.target.roomId}
      {...callContext}
      compact={compact}
    >
      {content}
    </RoomCallBoundary>
  ) : (
    content
  );
}

function DirectIntroduction({ other }: { other: DirectOther }) {
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <span
        aria-hidden="true"
        className="mb-2 flex size-16 items-center justify-center rounded-full bg-muted text-xl font-semibold"
      >
        {Array.from(other.name.trim())[0] ?? "?"}
      </span>
      <p className="font-bold text-foreground">{other.name}</p>
      {other.username && (
        <p className="text-xs text-muted-foreground">@{other.username}</p>
      )}
      <p className="text-sm text-muted-foreground">
        {other.name} 님과 나눈 대화의 처음이에요
      </p>
    </div>
  );
}

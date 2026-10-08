"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useIsMutating, useQueryClient } from "@tanstack/react-query";
import { Hash, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useRealtimeConnectionState } from "@/components/realtime-provider";
import type { ChannelView } from "../types";
import { releaseRoomViewport, reportRoomViewport } from "../nav-state";
import { ChannelMembers } from "./channel-members";
import { MessageComposer } from "./message-composer";
import { MessageList } from "./message-list";
import { MessageDeleteDialog } from "./message-delete-dialog";
import {
  useMessageMutations,
  withReactionIntents,
} from "./use-message-mutations";
import type { DisplayMessage } from "./message-state";
import { useMessageHistory } from "./use-message-history";
import { useRoomRead } from "./use-room-read";
import {
  useChannelMessages,
  type SendChatMessage,
} from "./use-channel-messages";

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
  const messages = useChannelMessages(data, send);
  const mutations = useMessageMutations({
    roomId: data.room.id,
    userId: data.user.id,
    members: data.members,
  });
  const [deleting, setDeleting] = useState<DisplayMessage | null>(null);
  const deleteOrigin = useRef<string | null>(null);
  const channelRef = useRef<HTMLElement>(null);
  const admin = data.members.some(
    (member) => member.id === data.user.id && member.admin,
  );
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
    (atBottom: boolean, seq: number | null) => {
      reportRoomViewport(client, data.room.id, atBottom);
      setVisible((previous) =>
        previous.roomId === data.room.id && previous.seq === seq
          ? previous
          : { roomId: data.room.id, seq },
      );
    },
    [client, data.room.id],
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
      sendingCount > 0 ||
      messages.sending ||
      messages.messages.some((message) => message.delivery === "pending"),
  });
  const connection = useRealtimeConnectionState();
  const [membersOpen, setMembersOpen] = useState(false);
  const wide = useWideMembers();
  const membersId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <section
      ref={channelRef}
      data-chat-screen
      className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col bg-background"
    >
      <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-border bg-card px-4 md:px-6">
        <Hash
          aria-hidden="true"
          className="size-5 shrink-0 text-muted-foreground"
        />
        <h1 className="truncate text-lg font-bold">{data.room.name}</h1>
        {data.room.topic && (
          <p className="hidden min-w-0 flex-1 truncate border-l border-border pl-3 text-sm text-muted-foreground sm:block">
            {data.room.topic}
          </p>
        )}
        <Button
          ref={trigger}
          type="button"
          variant="ghost"
          className="ml-auto"
          aria-label={`멤버 ${data.members.length}명`}
          aria-expanded={membersOpen}
          aria-controls={membersId}
          onClick={() => setMembersOpen((open) => !open)}
        >
          <Users aria-hidden="true" />
          <span className="tabular-nums">{data.members.length}</span>
        </Button>
      </header>
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
          <MessageList
            key={`${data.room.id}:${resetVersion}`}
            channelName={data.room.name}
            now={data.now}
            userId={data.user.id}
            messages={messages.messages.map(withReactionIntents)}
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
            actions={{
              userId: data.user.id,
              canWrite: data.canWrite,
              canReact: !data.room.archived,
              admin,
              names: new Map(data.members.map(({ id, name }) => [id, name])),
              react: mutations.react,
              onDelete: (message) => {
                deleteOrigin.current = message.id;
                setDeleting(message);
              },
            }}
          />
          {data.canWrite ? (
            <MessageComposer
              key={data.room.id}
              channelName={data.room.name}
              onSend={messages.submit}
            />
          ) : (
            <p className="shrink-0 border-t border-border p-5 text-center text-sm text-muted-foreground">
              {data.room.archived
                ? "보관된 채널이에요"
                : "이 채널에는 관리자만 쓸 수 있어요"}
            </p>
          )}
        </div>
        {wide && membersOpen && (
          <aside
            id={membersId}
            aria-label="채널 멤버"
            className="w-60 shrink-0 overflow-y-auto border-l border-border bg-sidebar"
          >
            <h2 className="px-4 pt-5 text-xs font-semibold text-muted-foreground">
              멤버 · {data.members.length}
            </h2>
            <ChannelMembers members={data.members} />
          </aside>
        )}
      </div>
      <MessageDeleteDialog
        message={deleting}
        userId={data.user.id}
        onClose={() => setDeleting(null)}
        onDelete={mutations.remove}
        onReturnFocus={() => returnMessageFocus(deleteOrigin.current)}
      />
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
            <SheetTitle>채널 멤버</SheetTitle>
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
          <div className="overflow-y-auto">
            <ChannelMembers members={data.members} />
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}

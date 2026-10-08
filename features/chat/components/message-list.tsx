"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { chatDate } from "@/lib/time/chat-format";
import type { ChatMessage } from "../types";
import {
  isMessageContinuation,
  messageKey,
  type DisplayMessage,
} from "./message-state";
import { MessageRow } from "./message-row";

const emptyLiveMessages: ChatMessage[] = [];
const noViewport = () => {};
const noLoad = async () => {};

const LiveMessages = memo(function LiveMessages({
  messages,
  userId,
}: {
  messages: readonly ChatMessage[];
  userId: string;
}) {
  const seen = useRef(new Set<string>());
  const [announcement, setAnnouncement] = useState({ key: "", text: "" });
  useEffect(() => {
    const incoming = messages.filter(
      (message) => message.authorId !== userId && !seen.current.has(message.id),
    );
    for (const message of incoming) seen.current.add(message.id);
    if (incoming.length > 1)
      setAnnouncement({
        key: incoming.at(-1)!.id,
        text: `새 메시지 ${incoming.length}개`,
      });
    else if (incoming.length === 1) {
      const message = incoming[0]!;
      setAnnouncement({
        key: message.id,
        text: `${message.authorName ?? "시스템"}: ${Array.from(message.body).slice(0, 100).join("")}`,
      });
    }
  }, [messages, userId]);
  return (
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
      data-chat-announcement
    >
      {announcement.text && (
        <span key={announcement.key}>{announcement.text}</span>
      )}
    </span>
  );
});

export const MessageList = memo(function MessageList({
  messages,
  channelName,
  now,
  userId,
  firstUnreadSeq = null,
  liveMessages = emptyLiveMessages,
  hasMore = false,
  loadingOlder = false,
  historyError = false,
  onLoadOlder = noLoad,
  onViewport = noViewport,
  onRetry,
  onRemove,
}: {
  messages: readonly DisplayMessage[];
  channelName: string;
  now: string;
  userId: string;
  firstUnreadSeq?: number | null;
  liveMessages?: readonly ChatMessage[];
  hasMore?: boolean;
  loadingOlder?: boolean;
  historyError?: boolean;
  onLoadOlder?: (maxMessages?: number) => Promise<void>;
  onViewport?: (atBottom: boolean, seq: number | null) => void;
  onRetry: (message: DisplayMessage) => void;
  onRemove: (message: DisplayMessage) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // 읽음 응답은 경계선을 지우지 않는다. 방이나 복구 세대가 바뀔 때만 다시 만든다.
  const [unreadSeq, setUnreadSeq] = useState(firstUnreadSeq);
  const [initialized, setInitialized] = useState(false);
  const [seenThrough, setSeenThrough] = useState(0);
  const getItemKey = useCallback(
    (index: number) => messageKey(messages[index]!, userId),
    [messages, userId],
  );
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    getItemKey,
    estimateSize: () => 80,
    overscan: 6,
    paddingStart: 44,
    paddingEnd: 24,
    anchorTo: "end",
    followOnAppend: initialized,
    scrollEndThreshold: 120,
  });
  const rows = virtualizer.getVirtualItems();
  const offset = virtualizer.scrollOffset ?? 0;
  const height = virtualizer.scrollRect?.height ?? 0;
  const visibleRows = rows.filter(
    (row) => row.end > offset && row.start < offset + height,
  );
  const atBottom =
    messages.length === 0 ||
    visibleRows.some((row) => row.index === messages.length - 1);
  const lastSeq = messages.reduce(
    (seq, message) => Math.max(seq, message.seq),
    0,
  );
  const visibleSeq = visibleRows.reduce(
    (seq, row) => Math.max(seq, messages[row.index]!.seq),
    0,
  );
  const confirmedCount = messages.filter((message) => !message.delivery).length;

  useLayoutEffect(() => {
    if (initialized || !height) return;
    if (unreadSeq !== null) {
      const index = messages.findIndex((message) => message.seq === unreadSeq);
      if (index >= 0) {
        const start = virtualizer.getOffsetForIndex(index, "start")?.[0];
        if (start === undefined) return;
        virtualizer.scrollToOffset(Math.max(0, start - height / 3));
      } else if (hasMore && confirmedCount < 500) {
        return;
      } else {
        setUnreadSeq(null);
        virtualizer.scrollToEnd();
      }
    } else virtualizer.scrollToEnd();
    setInitialized(true);
  }, [
    confirmedCount,
    hasMore,
    height,
    initialized,
    messages,
    unreadSeq,
    virtualizer,
  ]);

  useEffect(() => {
    if (loadingOlder || historyError || !hasMore) return;
    const seekingUnread =
      !initialized &&
      unreadSeq !== null &&
      !messages.some((message) => message.seq === unreadSeq) &&
      confirmedCount < 500;
    const currentOffset = scrollRef.current?.scrollTop ?? offset;
    if (seekingUnread) void onLoadOlder(500);
    else if (initialized && currentOffset <= 200) void onLoadOlder();
  }, [
    confirmedCount,
    hasMore,
    historyError,
    initialized,
    loadingOlder,
    messages,
    offset,
    onLoadOlder,
    unreadSeq,
  ]);

  useEffect(() => {
    if (!initialized) return;
    setSeenThrough((previous) => Math.max(previous, visibleSeq));
    onViewport(atBottom, atBottom && lastSeq > 0 ? lastSeq : null);
  }, [atBottom, initialized, lastSeq, onViewport, visibleSeq]);
  useEffect(() => () => onViewport(false, null), [onViewport]);

  const newBelow =
    initialized && !atBottom
      ? messages.filter(
          (message) =>
            !message.delivery &&
            message.authorId !== userId &&
            message.seq > seenThrough,
        ).length
      : 0;
  return (
    <div className="relative min-h-0 flex-1">
      <LiveMessages messages={liveMessages} userId={userId} />
      <div
        ref={scrollRef}
        role="region"
        aria-live="off"
        aria-label={`${channelName} 메시지`}
        tabIndex={0}
        className="h-full overflow-y-auto overscroll-contain px-4 focus-visible:outline-2 focus-visible:outline-ring md:px-6"
        style={{ overflowAnchor: "none" }}
      >
        <div
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
          data-message-list
        >
          <div className="absolute inset-x-0 top-0 flex h-11 items-center justify-center text-xs text-muted-foreground">
            {loadingOlder ? (
              <Skeleton
                aria-label="이전 메시지를 불러오고 있어요"
                className="h-4 w-44"
              />
            ) : historyError ? (
              <Button variant="ghost" onClick={() => void onLoadOlder()}>
                이전 메시지 다시 불러오기
              </Button>
            ) : !hasMore ? (
              `#${channelName}의 처음이에요`
            ) : null}
          </div>
          {rows.map((row) => {
            const message = messages[row.index]!;
            const previous = messages[row.index - 1];
            return (
              <div
                key={row.key}
                data-index={row.index}
                ref={virtualizer.measureElement}
                data-message-id={message.id}
                data-message-key={messageKey(message, userId)}
                className="absolute inset-x-0 top-0"
                style={{ transform: `translateY(${row.start}px)` }}
              >
                <MessageRow
                  message={message}
                  grouped={isMessageContinuation(previous, message)}
                  dateDivider={
                    !previous ||
                    chatDate(previous.createdAt) !== chatDate(message.createdAt)
                  }
                  unread={message.seq === unreadSeq}
                  now={now}
                  onRetry={onRetry}
                  onRemove={onRemove}
                />
              </div>
            );
          })}
        </div>
        {!messages.length && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            #{channelName}의 첫 메시지를 보내 보세요
          </p>
        )}
      </div>
      {newBelow > 0 && (
        <Button
          type="button"
          variant="secondary"
          className="absolute right-4 bottom-3 shadow-pop"
          onClick={() => {
            virtualizer.scrollToEnd();
            setSeenThrough(lastSeq);
          }}
        >
          새 메시지 {newBelow}개 <ArrowDown aria-hidden="true" />
        </Button>
      )}
    </div>
  );
});

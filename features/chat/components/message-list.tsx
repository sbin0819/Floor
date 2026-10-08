"use client";

import { memo, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  chatDate,
  formatChatDate,
  formatChatTime,
} from "@/lib/time/chat-format";
import {
  isMessageContinuation,
  messageKey,
  messageSendError,
  type DisplayMessage,
} from "./message-state";

export const MessageList = memo(function MessageList({
  messages,
  channelName,
  now,
  userId,
  onRetry,
  onRemove,
}: {
  messages: readonly DisplayMessage[];
  channelName: string;
  now: string;
  userId: string;
  onRetry: (message: DisplayMessage) => void;
  onRemove: (message: DisplayMessage) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const previousLast = useRef<string | null>(null);
  const [newBelow, setNewBelow] = useState(false);
  const lastKey = messages.length ? messageKey(messages.at(-1)!, userId) : null;
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    if (nearBottom.current) scroller.scrollTop = scroller.scrollHeight;
    else if (lastKey !== previousLast.current) setNewBelow(true);
    previousLast.current = lastKey;
  }, [messages, lastKey]);
  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label={`${channelName} 메시지`}
        className="h-full overflow-y-auto overscroll-contain px-4 py-6 md:px-6"
        onScroll={(event) => {
          const node = event.currentTarget;
          nearBottom.current =
            node.scrollHeight - node.scrollTop - node.clientHeight <= 120;
          if (nearBottom.current) setNewBelow(false);
        }}
      >
        {!messages.length && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            #{channelName}의 첫 메시지를 보내 보세요
          </p>
        )}
        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const dateDivider =
            !previous ||
            chatDate(previous.createdAt) !== chatDate(message.createdAt);
          const grouped = isMessageContinuation(previous, message);
          return (
            <div
              key={messageKey(message, userId)}
              data-message-id={message.id}
              data-message-key={messageKey(message, userId)}
            >
              {dateDivider && (
                <div className="my-5 flex items-center gap-3 text-xs font-medium text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  <span>{formatChatDate(message.createdAt, now)}</span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              )}
              <article
                aria-label={
                  message.kind === "system"
                    ? "시스템 메시지"
                    : `${message.authorName ?? "알 수 없는 사람"}의 메시지`
                }
                data-delivery={message.delivery ?? "sent"}
                className={`flex gap-3 py-1 ${!grouped ? "mt-4" : ""} ${message.delivery === "pending" ? "opacity-50" : ""}`}
              >
                <div className="w-10 shrink-0">
                  {!grouped && message.kind === "text" && (
                    <span
                      aria-hidden="true"
                      className="flex size-10 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground"
                    >
                      {Array.from(message.authorName ?? "?")[0]}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  {!grouped && (
                    <div className="mb-1 flex items-baseline gap-2">
                      <strong className="text-sm font-semibold">
                        {message.kind === "system"
                          ? "시스템"
                          : (message.authorName ?? "알 수 없는 사람")}
                      </strong>
                      <time
                        dateTime={message.createdAt}
                        className="text-xs text-muted-foreground tabular-nums"
                      >
                        {formatChatTime(message.createdAt)}
                      </time>
                    </div>
                  )}
                  <p className="text-sm leading-6 wrap-anywhere whitespace-pre-wrap">
                    {message.body}
                  </p>
                  {message.delivery === "pending" && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="size-3" aria-hidden="true" />
                      보내는 중이에요
                    </span>
                  )}
                  {message.delivery === "failed" && (
                    <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span>{messageSendError(message)}</span>
                      {message.errorCode === "NOT_FOUND" ? (
                        <Link
                          href="/messages"
                          className="inline-flex min-h-11 items-center underline"
                        >
                          메시지 목록
                        </Link>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => onRetry(message)}
                        >
                          다시 보내기
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => onRemove(message)}
                      >
                        지우기
                      </Button>
                    </div>
                  )}
                </div>
              </article>
            </div>
          );
        })}
      </div>
      {newBelow && (
        <Button
          type="button"
          variant="secondary"
          className="absolute right-4 bottom-3 shadow-pop"
          onClick={() => {
            const node = scrollRef.current;
            if (node) node.scrollTop = node.scrollHeight;
            nearBottom.current = true;
            setNewBelow(false);
          }}
        >
          새 메시지 <ArrowDown aria-hidden="true" />
        </Button>
      )}
    </div>
  );
});

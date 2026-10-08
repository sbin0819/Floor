"use client";

import { memo } from "react";
import Link from "next/link";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatChatDate, formatChatTime } from "@/lib/time/chat-format";
import { messageSendError, type DisplayMessage } from "./message-state";

export const MessageRow = memo(function MessageRow({
  message,
  grouped,
  dateDivider,
  unread,
  now,
  onRetry,
  onRemove,
}: {
  message: DisplayMessage;
  grouped: boolean;
  dateDivider: boolean;
  unread: boolean;
  now: string;
  onRetry: (message: DisplayMessage) => void;
  onRemove: (message: DisplayMessage) => void;
}) {
  return (
    <>
      {dateDivider && (
        <div className="my-5 flex items-center gap-3 text-xs font-medium text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          <span>{formatChatDate(message.createdAt, now)}</span>
          <span className="h-px flex-1 bg-border" />
        </div>
      )}
      {unread && (
        <div
          data-unread-divider
          className="my-4 flex items-center gap-3 text-xs font-semibold text-destructive"
        >
          <span className="h-px flex-1 bg-destructive" />새 메시지
          <span className="h-px flex-1 bg-destructive" />
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
              {message.errorCode === "UNAUTHENTICATED" ? (
                <Link
                  href="/login"
                  className="inline-flex min-h-11 items-center underline"
                >
                  로그인
                </Link>
              ) : message.errorCode === "NOT_FOUND" ? (
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
    </>
  );
});

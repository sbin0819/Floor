"use client";

import {
  memo,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatChatDate, formatChatTime } from "@/lib/time/chat-format";
import { messageSendError, type DisplayMessage } from "./message-state";
import { MessageBody } from "./message-body";
import {
  MessageToolbar,
  MessageActionsSheet,
  type MessageToolbarProps,
} from "./message-toolbar";
import { ReactionPills } from "./reaction-pills";
import type { ChatMessage, ReactionEmoji } from "../types";

export type MessageActions = {
  userId: string;
  canWrite: boolean;
  canReact: boolean;
  admin: boolean;
  names: ReadonlyMap<string, string>;
  react: (
    message: ChatMessage,
    emoji: ReactionEmoji,
    on: boolean,
  ) => Promise<boolean>;
  onDelete: (message: DisplayMessage) => void;
  onEdit?: (message: DisplayMessage) => void;
  onReply?: (message: DisplayMessage) => void;
  onJump?: (messageId: string) => void;
};

export const MessageRow = memo(function MessageRow({
  message,
  grouped,
  dateDivider,
  unread,
  now,
  onRetry,
  onRemove,
  actions,
  tabIndex = -1,
  onFocus,
  onKeyDown,
  highlighted = false,
  editor,
  read = false,
}: {
  message: DisplayMessage;
  grouped: boolean;
  dateDivider: boolean;
  unread: boolean;
  now: string;
  onRetry: (message: DisplayMessage) => void;
  onRemove: (message: DisplayMessage) => void;
  actions?: MessageActions;
  tabIndex?: number;
  onFocus?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  highlighted?: boolean;
  editor?: ReactNode;
  read?: boolean;
}) {
  const article = useRef<HTMLElement>(null);
  const tools = useRef<HTMLDivElement>(null);
  const [toolbar, setToolbar] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissedToolbar, setDismissedToolbar] = useState(false);
  const [sheet, setSheet] = useState(false);
  const press = useRef<{
    timer: ReturnType<typeof setTimeout>;
    x: number;
    y: number;
  } | null>(null);
  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => cancelPress, []);
  useEffect(() => {
    if (toolbar)
      tools.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [toolbar]);
  const usable = actions && message.kind === "text" && !message.delivery;
  const permissions = {
    canReact: Boolean(usable && actions.canReact && !message.deletedAt),
    canReply: Boolean(usable && actions.canWrite && actions.onReply),
    canEdit: Boolean(
      usable &&
      actions.canWrite &&
      actions.onEdit &&
      message.authorId === actions.userId &&
      !message.deletedAt,
    ),
    canDelete: Boolean(
      usable &&
      !message.deletedAt &&
      (message.authorId === actions.userId || actions.admin),
    ),
  };
  const available = Object.values(permissions).some(Boolean);
  const returnFocus = () => {
    setToolbar(false);
    setDismissedToolbar(true);
    article.current?.focus();
  };
  const toolbarProps: MessageToolbarProps = {
    ...permissions,
    reactions: message.reactions,
    onReaction: (emoji, on) => {
      if (actions) void actions.react(message, emoji, on);
    },
    onReply: () => {
      setToolbar(false);
      actions?.onReply?.(message);
    },
    onEdit: () => {
      setToolbar(false);
      actions?.onEdit?.(message);
    },
    onDelete: () => {
      setToolbar(false);
      actions?.onDelete(message);
    },
    onEscape: returnFocus,
  };
  const names = new Map(actions?.names);
  for (const mention of message.mentions)
    names.set(mention.userId, mention.name);
  const mentioned =
    actions &&
    !message.deletedAt &&
    message.authorId !== actions.userId &&
    (message.mentionsEveryone ||
      message.mentions.some(({ userId }) => userId === actions.userId));
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
        ref={article}
        aria-label={`${message.kind === "system" ? "시스템" : (message.authorName ?? "알 수 없는 사람")}, ${formatChatTime(message.createdAt)}`}
        tabIndex={tabIndex}
        onFocus={(event) => {
          setFocused(true);
          if (!event.currentTarget.contains(event.relatedTarget))
            setDismissedToolbar(false);
          onFocus?.();
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setFocused(false);
            setToolbar(false);
          }
        }}
        onMouseEnter={() => {
          setHovered(true);
          setDismissedToolbar(false);
        }}
        onMouseLeave={() => setHovered(false)}
        onKeyDown={(event) => {
          if (
            event.target === event.currentTarget &&
            available &&
            (event.key === "Enter" || event.key === " ")
          ) {
            event.preventDefault();
            setDismissedToolbar(false);
            setToolbar(true);
          } else if (event.key === "Escape" && toolbar) {
            event.preventDefault();
            returnFocus();
          } else onKeyDown?.(event);
        }}
        onPointerDown={(event) => {
          if (
            event.pointerType !== "touch" ||
            !available ||
            (event.target as HTMLElement).closest("button,a,input,textarea")
          )
            return;
          cancelPress();
          press.current = {
            x: event.clientX,
            y: event.clientY,
            timer: setTimeout(() => {
              press.current = null;
              setSheet(true);
            }, 500),
          };
        }}
        onPointerMove={(event) => {
          if (
            press.current &&
            Math.hypot(
              event.clientX - press.current.x,
              event.clientY - press.current.y,
            ) > 10
          )
            cancelPress();
        }}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
        data-delivery={message.delivery ?? "sent"}
        data-mentioned={mentioned || undefined}
        data-highlighted={highlighted || undefined}
        className={`relative flex gap-3 rounded-md py-1 outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring ${mentioned ? "bg-status-pending" : highlighted ? "bg-accent" : ""} ${!grouped ? "mt-4" : ""} ${message.delivery === "pending" ? "opacity-50" : ""}`}
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
          {message.replyTo && !message.deletedAt && (
            <button
              type="button"
              aria-label={`${message.replyTo.authorName ?? "알 수 없는 사람"} 님의 원문: ${message.replyTo.deleted ? "삭제된 메시지예요" : message.replyTo.excerpt}`}
              className="mb-1 flex min-h-11 max-w-full items-center gap-2 rounded-md border-l-2 border-border px-2 text-left text-xs text-muted-foreground hover:bg-muted"
              onClick={() => actions?.onJump?.(message.replyTo!.id)}
            >
              <span
                aria-hidden="true"
                className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted"
              >
                {Array.from(message.replyTo.authorName ?? "?")[0]}
              </span>
              <strong className="shrink-0">
                {message.replyTo.authorName ?? "알 수 없는 사람"}
              </strong>
              <span className="truncate">
                {message.replyTo.deleted
                  ? "삭제된 메시지예요"
                  : message.replyTo.excerpt}
              </span>
            </button>
          )}
          {(message.deletedAt ? null : editor) ??
            (message.deletedAt ? (
              <p className="text-sm text-muted-foreground italic">
                삭제된 메시지예요
              </p>
            ) : (
              <MessageBody body={message.body} names={names} />
            ))}
          {message.editedAt && !message.deletedAt && (
            <span className="text-xs text-muted-foreground">(수정됨)</span>
          )}
          {read && (
            <p
              className="text-right text-xs text-muted-foreground"
              data-chat-read-receipt
            >
              읽음
            </p>
          )}
          {!message.deletedAt && (
            <ReactionPills
              reactions={message.reactions}
              disabled={!permissions.canReact}
              onChange={toolbarProps.onReaction}
            />
          )}
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
        {available && !editor && !sheet && (
          <div
            ref={tools}
            className={`absolute -top-10 right-1 z-10 ${!dismissedToolbar && (hovered || focused || toolbar) ? "" : "pointer-events-none invisible"}`}
            data-message-toolbar
          >
            <MessageToolbar {...toolbarProps} />
          </div>
        )}
      </article>
      {available && (
        <MessageActionsSheet
          {...toolbarProps}
          open={sheet}
          onOpenChange={setSheet}
          onReturnFocus={returnFocus}
        />
      )}
    </>
  );
});

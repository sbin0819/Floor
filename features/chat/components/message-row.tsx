"use client";
import { UserAvatar } from "@/components/user-avatar";

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
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PersonCard } from "@/features/people/components/person-card";
import { formatChatDate, formatChatTime } from "@/lib/time/chat-format";
import { messageSendError, type DisplayMessage } from "./message-state";
import { MessageBody } from "./message-body";
import {
  MessageToolbar,
  MessageActionsSheet,
  type MessageToolbarProps,
} from "./message-toolbar";
import { ReactionPills } from "./reaction-pills";
import { SystemMessageContent } from "./system-message-content";
import type { ChatMessage, ReactionEmoji } from "../types";
import { MessageAttachments, type AttachmentUrl } from "./message-attachments";
import { messageCopyText } from "../copy-message";

export type MessageActions = {
  userId: string;
  canWrite: boolean;
  canReact: boolean;
  filesEnabled?: boolean;
  fileUrl?: AttachmentUrl;
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
  onReport?: (message: DisplayMessage) => void;
};

export const MessageRow = memo(function MessageRow({
  message,
  grouped,
  mine = false,
  runStart = !grouped,
  runEnd = true,
  showTime = true,
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
  foldedCount = 0,
  onExpand,
}: {
  message: DisplayMessage;
  grouped: boolean;
  mine?: boolean;
  runStart?: boolean;
  runEnd?: boolean;
  showTime?: boolean;
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
  foldedCount?: number;
  onExpand?: () => void;
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
  const usable =
    actions && message.kind === "text" && !message.delivery && !foldedCount;
  const permissions = {
    canCopy:
      message.kind === "text" &&
      !message.deletedAt &&
      Boolean(message.body) &&
      !foldedCount,
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
    canReport: Boolean(
      usable &&
      actions.onReport &&
      !message.deletedAt &&
      message.authorId &&
      message.authorId !== actions.userId,
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
    onReport: () => {
      setToolbar(false);
      actions?.onReport?.(message);
    },
    onCopy: () => {
      void (async () => {
        try {
          await navigator.clipboard.writeText(
            messageCopyText(message.body, names),
          );
          toast.success("복사했어요");
        } catch {
          toast.error("복사하지 못했어요");
        }
      })();
    },
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
  const bubbleState = message.deletedAt
    ? "deleted"
    : (message.delivery ?? "sent");
  const editing = Boolean(editor && !message.deletedAt);
  const toolbarVisible =
    available &&
    !editing &&
    !sheet &&
    !dismissedToolbar &&
    (hovered || focused || toolbar);
  const toolbarElement = available && !editing && !sheet && (
    <div
      ref={tools}
      className={`absolute -top-10 z-10 @min-[960px]:top-0 ${mine ? "right-0 @min-[960px]:right-full @min-[960px]:mr-2" : "left-0 @min-[960px]:left-full @min-[960px]:ml-2"} ${toolbarVisible ? "" : "pointer-events-none invisible"}`}
      data-message-toolbar
    >
      <MessageToolbar {...toolbarProps} />
    </div>
  );
  const hasBubble = Boolean(
    message.deletedAt || message.body || message.replyTo,
  );
  const bubbleColor = message.deletedAt
    ? "border border-dashed border-border bg-transparent text-muted-foreground"
    : message.delivery
      ? "bg-chat-pending text-chat-pending-foreground"
      : mentioned
        ? "border border-status-pending-border bg-status-pending text-status-pending-foreground"
        : mine
          ? "bg-chat-mine text-chat-mine-foreground"
          : "border border-border bg-card text-foreground";
  const metadata = !editing && (
    <span
      data-message-time-slot
      className="grid shrink-0 pb-1 text-xs text-muted-foreground tabular-nums"
    >
      {/* 시각을 감춰도 너비를 남겨 앞 말풍선의 줄바꿈과 가상 목록 높이를 지켜요. */}
      <span
        aria-hidden="true"
        data-message-time-measure
        className="invisible col-start-1 row-start-1"
      >
        {message.editedAt && !message.deletedAt && "수정됨 · "}
        {formatChatTime(message.createdAt)}
      </span>
      {(showTime ||
        (!message.deletedAt && (message.editedAt || message.delivery))) && (
        <span
          data-message-time
          className={`col-start-1 row-start-1 ${toolbarVisible ? "@min-[960px]:invisible" : ""}`}
        >
          {!message.deletedAt && message.delivery === "pending" ? (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" aria-hidden="true" />
              보내는 중
            </span>
          ) : !message.deletedAt && message.delivery === "failed" ? (
            <span className="text-destructive">
              {messageSendError(message)}
            </span>
          ) : showTime ? (
            <>
              {message.editedAt && !message.deletedAt && "수정됨 · "}
              <time dateTime={message.createdAt}>
                {formatChatTime(message.createdAt)}
              </time>
            </>
          ) : message.editedAt && !message.deletedAt ? (
            "수정됨"
          ) : null}
        </span>
      )}
    </span>
  );
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
        data-side={mine ? "mine" : "other"}
        data-run-start={runStart}
        data-show-time={showTime}
        data-bubble-state={bubbleState}
        className={`relative flex gap-2 rounded-md py-1 outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring ${runStart ? "mt-4" : ""} ${foldedCount || message.kind === "system" ? "justify-center" : mine ? "justify-end" : ""}`}
      >
        {foldedCount ? (
          <Button
            variant="ghost"
            className="mx-auto min-h-11 text-muted-foreground"
            onClick={onExpand}
          >
            차단한 사용자의 메시지{foldedCount > 1 ? ` ${foldedCount}개` : ""} ·
            보기
          </Button>
        ) : message.kind === "system" ? (
          <SystemMessageContent
            data={message.systemData}
            body={message.body}
            createdAt={message.createdAt}
          />
        ) : (
          <>
            {!mine && (
              <div className="w-9 shrink-0">
                {runStart && message.authorId && (
                  <PersonCard
                    userId={message.authorId}
                    name={message.authorName ?? "알 수 없는 사람"}
                  >
                    <button
                      type="button"
                      aria-label={`${message.authorName ?? "알 수 없는 사람"} 아바타 프로필`}
                      className="-mx-1 flex size-11 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {message.authorAvatar && (
                        <UserAvatar
                          name={message.authorName ?? "?"}
                          avatar={message.authorAvatar}
                          size={36}
                          className="@max-[600px]:size-7.5"
                        />
                      )}
                    </button>
                  </PersonCard>
                )}
              </div>
            )}
            <div
              data-message-content
              className={`flex min-w-0 flex-1 flex-col ${mine ? "items-end" : "items-start"}`}
            >
              {!mine && runStart && (
                <div className="mb-1 flex items-baseline">
                  {message.authorId ? (
                    <PersonCard
                      userId={message.authorId}
                      name={message.authorName ?? "알 수 없는 사람"}
                    >
                      <button
                        type="button"
                        className="rounded-sm text-left text-sm font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                        aria-label={`${message.authorName ?? "알 수 없는 사람"} 프로필`}
                      >
                        <strong>
                          {message.authorName ?? "알 수 없는 사람"}
                        </strong>
                      </button>
                    </PersonCard>
                  ) : (
                    <strong className="text-sm font-semibold">
                      {message.authorName ?? "알 수 없는 사람"}
                    </strong>
                  )}
                </div>
              )}
              {editing ? (
                <div className="w-full min-w-0 rounded-lg bg-card text-card-foreground">
                  {editor}
                </div>
              ) : hasBubble ? (
                <div
                  className={`flex max-w-full min-w-0 items-end gap-2 ${mine ? "flex-row-reverse" : ""}`}
                >
                  <div
                    data-message-bubble-anchor
                    className="relative max-w-[min(560px,75cqw)] min-w-0 @max-[600px]:max-w-[80cqw]"
                  >
                    {toolbarElement}
                    <div
                      data-message-bubble
                      className={`rounded-2xl px-3.5 py-2 text-sm [overflow-wrap:anywhere] break-keep ${bubbleColor} ${!mine && runStart ? "rounded-tl-[6px]" : ""} ${mine && runEnd ? "rounded-br-[6px]" : ""} ${highlighted ? "ring-2 ring-ring/40" : ""}`}
                    >
                      {message.replyTo && !message.deletedAt && (
                        <button
                          type="button"
                          aria-label={`${message.replyTo.authorName ?? "알 수 없는 사람"} 님의 원문: ${message.replyTo.deleted ? "삭제된 메시지예요" : message.replyTo.excerpt}`}
                          className={`mb-1 flex min-h-11 w-full min-w-0 flex-col justify-center rounded-md border-l-2 px-2 py-1 text-left text-xs ${mine ? "border-chat-mine-foreground/60 bg-chat-mine-foreground/15" : "border-border bg-muted text-muted-foreground"}`}
                          onClick={() => actions?.onJump?.(message.replyTo!.id)}
                        >
                          <strong className="max-w-full truncate">
                            {message.replyTo.authorName ?? "알 수 없는 사람"}
                          </strong>
                          <span className="max-w-full truncate">
                            {message.replyTo.deleted
                              ? "삭제된 메시지예요"
                              : message.replyTo.excerpt}
                          </span>
                        </button>
                      )}
                      {message.deletedAt ? (
                        <p className="text-sm text-muted-foreground italic">
                          삭제된 메시지예요
                        </p>
                      ) : message.body ? (
                        <MessageBody
                          body={message.body}
                          names={names}
                          tone={mine ? "mine" : "other"}
                        />
                      ) : null}
                    </div>
                  </div>
                  {(message.body ||
                    message.deletedAt ||
                    !message.attachments.length) &&
                    metadata}
                </div>
              ) : null}
              {!message.deletedAt && (
                <MessageAttachments
                  attachments={message.attachments}
                  enabled={actions?.filesEnabled ?? false}
                  fileUrl={actions?.fileUrl}
                  align={mine ? "end" : "start"}
                  trailing={!message.body ? metadata : undefined}
                  highlighted={!message.body && highlighted}
                  leading={!hasBubble ? toolbarElement : undefined}
                />
              )}
              {!message.deletedAt && (
                <div
                  className={`flex max-w-full ${mine ? "justify-end" : "justify-start"}`}
                >
                  <ReactionPills
                    reactions={message.reactions}
                    disabled={!permissions.canReact}
                    onChange={toolbarProps.onReaction}
                  />
                </div>
              )}
              {!message.deletedAt && message.delivery === "failed" && (
                <div className="flex flex-wrap items-center justify-end gap-x-2 self-end text-xs text-muted-foreground">
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
                      disabled={message.attachmentUnavailable}
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
              {read && (
                <p
                  className="self-end text-right text-xs text-muted-foreground"
                  data-chat-read-receipt
                >
                  읽음
                </p>
              )}
            </div>
          </>
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

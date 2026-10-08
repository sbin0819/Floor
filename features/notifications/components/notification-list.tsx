"use client";

import { Clock3 } from "lucide-react";
import type { MouseEvent } from "react";
import { cn } from "cn";
import {
  notificationAge,
  notificationPresentation,
} from "@/features/notifications/format";
import type { NotificationItem } from "@/features/notifications/types";

export type NotificationActivationEvent = MouseEvent<
  HTMLAnchorElement | HTMLButtonElement
>;
export type NotificationActivate = (
  item: NotificationItem,
  event: NotificationActivationEvent,
) => void;

export function NotificationRow({
  item,
  now,
  onActivate,
  pending = false,
}: {
  item: NotificationItem;
  now: string;
  onActivate: NotificationActivate;
  pending?: boolean;
}) {
  const presentation = notificationPresentation(item);
  const booking =
    item.type !== "friend_request" && item.type !== "friend_accepted"
      ? item
      : null;
  const age = notificationAge(
    item.scheduledFor,
    now,
    booking?.data.timezone ?? "Asia/Seoul",
  );
  const title =
    booking && booking.type !== "booking_reminder"
      ? booking.data.title
      : undefined;
  const label = [
    !item.read ? "읽지 않음" : null,
    presentation.text,
    presentation.dateTime,
    title,
    age,
  ]
    .filter(Boolean)
    .join(" · ");
  const className = cn(
    "relative flex min-h-11 w-full items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-muted/60 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
    item.read ? "text-muted-foreground" : "text-foreground",
  );
  const content = (
    <>
      <span aria-hidden="true" className="flex h-10 w-2 shrink-0 items-center">
        {!item.read && (
          <span
            data-slot="notification-unread-dot"
            className="size-2 rounded-full bg-status-busy-strong"
          />
        )}
      </span>
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground"
      >
        {item.type === "booking_reminder" ? (
          <Clock3 className="size-5" />
        ) : (
          Array.from(item.data.actorName ?? "회원")[0]
        )}
      </span>
      <span className="min-w-0 flex-1 space-y-1">
        <span className="block text-sm leading-6 break-words">
          {presentation.parts.map((part, index) =>
            part.strong ? (
              <strong key={index} className="font-semibold">
                {part.text}
              </strong>
            ) : (
              <span key={index}>{part.text}</span>
            ),
          )}
        </span>
        <span className="block text-xs leading-5 break-words text-muted-foreground">
          {presentation.dateTime && (
            <span className="tabular-nums">{presentation.dateTime}</span>
          )}
          {title && <span> · {title}</span>}
          {(presentation.dateTime || title) && <span> · </span>}
          <time dateTime={item.scheduledFor} className="tabular-nums">
            {age}
          </time>
        </span>
      </span>
    </>
  );
  function activate(event: NotificationActivationEvent) {
    if (pending) {
      event.preventDefault();
      return;
    }
    onActivate(item, event);
  }
  return item.href ? (
    <a
      href={item.href}
      aria-label={label}
      aria-disabled={pending || undefined}
      className={className}
      onClick={activate}
    >
      {content}
    </a>
  ) : (
    <button
      type="button"
      aria-label={label}
      disabled={pending}
      className={className}
      onClick={activate}
    >
      {content}
    </button>
  );
}

export function NotificationList({
  items,
  now,
  onActivate,
  pendingIds,
  emptyLabel = "새 알림이 없어요",
}: {
  items: readonly NotificationItem[];
  now: string;
  onActivate: NotificationActivate;
  pendingIds?: ReadonlySet<string>;
  emptyLabel?: string;
}) {
  if (items.length === 0)
    return (
      <p className="px-4 py-12 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </p>
    );
  return (
    <ul aria-label="알림 목록" className="divide-y divide-border">
      {items.map((item) => (
        <li key={item.id} data-notification-id={item.id}>
          <NotificationRow
            item={item}
            now={now}
            onActivate={onActivate}
            pending={pendingIds?.has(item.id)}
          />
        </li>
      ))}
    </ul>
  );
}

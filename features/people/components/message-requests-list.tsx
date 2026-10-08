"use client";

import Link from "next/link";
import { use } from "react";
import { UserAvatar } from "@/components/user-avatar";
import { notificationAge } from "@/features/notifications/format";
import type { MessageRequestRow } from "../types";

export function MessageRequestsList({
  rows,
  now,
}: {
  rows: readonly MessageRequestRow[];
  now: string;
}) {
  if (!rows.length)
    return (
      <p className="p-6 text-sm text-muted-foreground">
        받은 메시지 요청이 없어요
      </p>
    );
  return (
    <ul className="divide-y divide-border">
      {rows.map((row) => (
        <li key={row.roomId}>
          <Link
            href={`/dm/${row.roomId}`}
            className="flex min-h-11 items-center gap-3 p-4 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            <UserAvatar
              name={row.other.name}
              avatar={row.other.avatar}
              size={40}
            />
            <span className="min-w-0 flex-1">
              <strong className="block text-sm">{row.other.name}</strong>
              {row.other.username && (
                <span className="block text-xs text-muted-foreground">
                  @{row.other.username}
                </span>
              )}
              <span className="block truncate text-sm text-muted-foreground">
                {row.excerpt}
              </span>
            </span>
            <time
              dateTime={row.lastMessageAt}
              className="shrink-0 text-xs text-muted-foreground tabular-nums"
            >
              {notificationAge(row.lastMessageAt, now, "Asia/Seoul")}
            </time>
          </Link>
        </li>
      ))}
    </ul>
  );
}
export function PendingMessageRequests({
  data,
  now,
}: {
  data: Promise<MessageRequestRow[]>;
  now: string;
}) {
  return <MessageRequestsList rows={use(data)} now={now} />;
}

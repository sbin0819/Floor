"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { cn } from "cn";
import type { DirectMessageNav } from "../types";
import { LinkPending } from "@/components/link-pending";

export function DirectMessageList({
  rows,
  limit = 50,
}: {
  rows: DirectMessageNav[];
  limit?: number;
}) {
  const pathname = usePathname();
  return (
    <section aria-label="다이렉트 메시지" className="space-y-2">
      <div className="flex items-center justify-between gap-2 px-3">
        <h2 className="text-sm font-semibold">다이렉트 메시지</h2>
        <Link
          href="/messages/new"
          aria-label="새 메시지"
          className="inline-flex size-11 items-center justify-center rounded-sm hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Plus className="size-4" aria-hidden="true" />
        </Link>
      </div>
      {rows.length ? (
        <ul className="space-y-1">
          {rows.slice(0, limit).map((room) => {
            const count = room.muted ? room.unreadMentions : room.unreadCount;
            const selected = pathname === `/dm/${room.roomId}`;
            return (
              <li key={room.roomId}>
                <Link
                  href={`/dm/${room.roomId}`}
                  aria-current={selected ? "page" : undefined}
                  aria-label={`${room.other.name}${count > 0 ? `, 읽지 않은 메시지 ${count}개` : ""}`}
                  className={cn(
                    "relative flex min-h-11 items-center gap-2 rounded-sm px-3 text-sm hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring",
                    selected && "bg-sidebar-accent",
                    room.unread && !room.muted && "font-bold",
                    room.muted && "text-muted-foreground",
                  )}
                >
                  <LinkPending />
                  <span
                    aria-hidden="true"
                    className="relative flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs"
                  >
                    {room.other.name.slice(0, 1)}
                  </span>
                  <span className="relative truncate">{room.other.name}</span>
                  {count > 0 && (
                    <span
                      aria-hidden="true"
                      className="relative ml-auto min-w-5 rounded-full bg-status-busy-strong px-1 text-center text-xs font-semibold text-primary-foreground tabular-nums"
                    >
                      {count > 99 ? "99+" : count}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="space-y-2 px-3 text-sm text-muted-foreground">
          <p>친구에게 메시지를 보내 보세요</p>
          <Link
            href="/friends"
            className="inline-flex min-h-11 items-center font-semibold text-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
          >
            친구 보기
          </Link>
        </div>
      )}
      {rows.length > limit && (
        <Link
          href="/messages"
          className="inline-flex min-h-11 items-center px-3 text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
        >
          모두 보기
        </Link>
      )}
    </section>
  );
}

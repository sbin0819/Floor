"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { cn } from "cn";
import type { DirectMessageNav } from "../types";
import { LinkPending } from "@/components/link-pending";
import { groupDisplayName } from "../group-name";
import { CallIndicator } from "@/features/calls/components/call-indicator";

export function DirectMessageList({
  rows,
  limit = 50,
  calls = [],
}: {
  rows: DirectMessageNav[];
  limit?: number;
  calls?: { roomId: string; participantCount: number }[];
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
            const group = room.kind === "group_dm" ? room : null;
            const name =
              room.kind === "group_dm"
                ? groupDisplayName(
                    room.name,
                    room.members.map((member) => member.name),
                    room.memberCount - 1,
                  )
                : room.other.name;
            const count = room.muted ? room.unreadMentions : room.unreadCount;
            const selected = pathname === `/dm/${room.roomId}`;
            const call = calls.find(
              (call) =>
                call.roomId === room.roomId && call.participantCount > 0,
            );
            return (
              <li key={room.roomId}>
                <Link
                  href={`/dm/${room.roomId}`}
                  aria-current={selected ? "page" : undefined}
                  aria-label={`${name}${group ? `, ${group.memberCount}명` : ""}${count > 0 ? `, 읽지 않은 메시지 ${count}개` : ""}${call ? `, 통화 중, ${call.participantCount}명` : ""}`}
                  className={cn(
                    "relative flex min-h-11 items-center gap-2 rounded-sm px-3 text-sm hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring",
                    selected && "bg-sidebar-accent",
                    room.unread && !room.muted && "font-bold",
                    room.muted && "text-muted-foreground",
                  )}
                >
                  <LinkPending />
                  {group ? (
                    <span
                      aria-hidden="true"
                      className="relative h-8 w-9 shrink-0"
                    >
                      {group.members.slice(0, 2).map((member, index) => (
                        <span
                          key={member.userId}
                          className={`absolute flex size-6 items-center justify-center rounded-full border-2 border-sidebar bg-muted text-xs ${index ? "right-0 bottom-0" : "top-0 left-0"}`}
                        >
                          {Array.from(member.name)[0]}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span
                      aria-hidden="true"
                      className="relative flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs"
                    >
                      {Array.from(name)[0]}
                    </span>
                  )}
                  <span className="relative min-w-0 flex-1">
                    <span className="block truncate">{name}</span>
                    {group && (
                      <span className="block text-xs font-normal text-muted-foreground tabular-nums">
                        {group.memberCount}명
                      </span>
                    )}
                  </span>
                  <CallIndicator count={call?.participantCount} />
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

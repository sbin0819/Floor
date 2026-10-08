"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, ChevronDown } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { LinkPending } from "@/components/link-pending";
import type { MeetingNav } from "../types";
import { meetingName, meetingStartLabel } from "../meeting-format";

export function MeetingList({
  rows,
  now,
}: {
  rows: MeetingNav[];
  now: string;
}) {
  const pathname = usePathname();
  const [pastOpen, setPastOpen] = useState(false);
  const upcoming = rows.filter((row) => row.phase !== "ended");
  const ended = rows.filter((row) => row.phase === "ended");
  function list(items: MeetingNav[]) {
    return (
      <ul className="space-y-1">
        {items.map((row) => {
          const name = meetingName(row);
          return (
            <li key={row.roomId}>
              <Link
                href={`/m/${row.bookingId}`}
                aria-current={
                  pathname === `/m/${row.bookingId}` ? "page" : undefined
                }
                aria-label={`${name}, ${meetingStartLabel(row.start, row.timezone, now)}${row.phase === "ongoing" ? ", 진행 중" : ""}${row.unread && !row.muted ? ", 안 읽은 메시지 있음" : ""}${row.unreadMentions ? `, 멘션 ${row.unreadMentions}개` : ""}`}
                className={cn(
                  "relative flex min-h-11 items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring",
                  pathname === `/m/${row.bookingId}` && "bg-sidebar-accent",
                  row.unread && !row.muted && "font-bold",
                  row.muted && "text-muted-foreground",
                )}
              >
                <LinkPending />
                <CalendarDays
                  aria-hidden="true"
                  className="relative size-4 shrink-0"
                />
                <span className="relative min-w-0 flex-1">
                  <span className="block truncate">{name}</span>
                  <span className="block text-xs font-normal text-muted-foreground tabular-nums">
                    {meetingStartLabel(row.start, row.timezone, now)}
                    {row.phase === "ongoing" && " · 진행 중"}
                  </span>
                </span>
                {row.unreadMentions > 0 && (
                  <span
                    aria-hidden="true"
                    className="relative min-w-5 rounded-full bg-status-busy-strong px-1 text-center text-xs font-semibold text-primary-foreground tabular-nums"
                  >
                    {row.unreadMentions > 99 ? "99+" : row.unreadMentions}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    );
  }
  if (!rows.length) return null;
  return (
    <section aria-label="회의" className="space-y-2">
      <h2 className="px-3 text-sm font-semibold">회의</h2>
      {list(upcoming)}
      {ended.length > 0 && (
        <div>
          <Button
            variant="ghost"
            className="w-full justify-between px-3 text-xs text-muted-foreground tabular-nums"
            aria-expanded={pastOpen}
            onClick={() => setPastOpen((value) => !value)}
          >
            지난 회의 {ended.length}
            <ChevronDown
              aria-hidden="true"
              className={cn("size-4", pastOpen && "rotate-180")}
            />
          </Button>
          {pastOpen && list(ended)}
        </div>
      )}
    </section>
  );
}

"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useRealtimeChannel } from "@/components/realtime-provider";
import { userChannel } from "@/lib/realtime/channels";
import type { RealtimeEvent } from "@/lib/realtime/types";
import type { ChatNav } from "../types";
import {
  CHAT_NAV_KEY,
  applyDirectActivity,
  applyMention,
  isViewingRoom,
  hasReadThrough,
} from "../nav-state";

type Activity = Extract<RealtimeEvent, { type: "room.activity" }>;
type Mention = Extract<RealtimeEvent, { type: "mention.created" }>;
type ToastEntry = {
  messageId: string;
  seq: number;
  roomId: string;
  authorName: string;
  excerpt: string;
  href: string;
  roomName?: string;
  direct: boolean;
};
export function ChatMentions({
  userId,
  count,
  refresh,
}: {
  userId: string;
  count: number;
  refresh: () => Promise<ChatNav | undefined>;
}) {
  const client = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);
  const shown = useRef(new Set<string>());
  const batch = useRef(new Map<string, ToastEntry>());
  const unknown = useRef(new Map<string, Activity | Mention>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const refreshPending = useRef(false);
  const alive = useRef(true);
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);
  useEffect(() => {
    const apply = () => {
      const base = document.title.replace(/^\(\d+\)\s*/, "");
      const title = count > 0 ? `(${count}) ${base}` : base;
      if (document.title !== title) document.title = title;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => observer.disconnect();
  }, [count, pathname]);
  useEffect(() => {
    alive.current = true;
    const pendingBatch = batch.current;
    const pendingUnknown = unknown.current;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
      clearTimeout(refreshTimer.current);
      timer.current = undefined;
      refreshTimer.current = undefined;
      pendingBatch.clear();
      pendingUnknown.clear();
    };
  }, []);
  function enqueue(entry: ToastEntry) {
    if (shown.current.has(entry.messageId) || isViewingEntry(entry)) return;
    batch.current.set(entry.messageId, entry);
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      const entries = [...batch.current.values()].filter(
        (entry) =>
          !shown.current.has(entry.messageId) && !isViewingEntry(entry),
      );
      batch.current.clear();
      for (const entry of entries) shown.current.add(entry.messageId);
      const open = (entry: ToastEntry) => router.push(entry.href);
      if (entries.length >= 4)
        toast(
          entries.some((entry) => entry.direct)
            ? `새 메시지 ${entries.length}개`
            : `새 멘션 ${entries.length}개`,
          {
            id: "messages:batch",
            action: { label: "보기", onClick: () => open(entries.at(-1)!) },
          },
        );
      else
        for (const entry of entries)
          toast(
            entry.direct
              ? entry.authorName
              : `${entry.authorName} 님이 #${entry.roomName}에서 멘션했어요`,
            {
              id: `${entry.direct ? "dm" : "mention"}:${entry.messageId}`,
              description: entry.excerpt,
              action: { label: "보기", onClick: () => open(entry) },
            },
          );
    }, 250);
  }
  function isViewingEntry(entry: ToastEntry) {
    return (
      hasReadThrough(client, entry.roomId, entry.seq) ||
      isViewingRoom(client, entry.roomId) ||
      (entry.direct &&
        pathnameRef.current === `/dm/${entry.roomId}` &&
        document.visibilityState === "visible")
    );
  }
  function enqueueDirect(event: Activity, data: ChatNav | undefined) {
    const room = data?.directMessages.find(
      (room) => room.roomId === event.roomId,
    );
    if (!room || room.muted || !event.preview || event.authorId === userId)
      return;
    enqueue({
      ...event.preview,
      seq: event.seq,
      roomId: event.roomId,
      href: `/dm/${event.roomId}`,
      direct: true,
    });
  }
  function enqueueDirectMention(event: Mention, data: ChatNav | undefined) {
    if (
      !data?.directMessages.find((room) => room.roomId === event.roomId)?.muted
    )
      return;
    enqueue({
      messageId: event.messageId,
      seq: event.seq,
      roomId: event.roomId,
      authorName: event.authorName,
      excerpt: event.excerpt,
      href: `/dm/${event.roomId}`,
      direct: true,
    });
  }
  function requestUnknown() {
    if (refreshTimer.current || refreshPending.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = undefined;
      refreshPending.current = true;
      const pending = [...unknown.current.values()];
      unknown.current.clear();
      void refreshRef
        .current()
        .then((data) => {
          if (!alive.current) return;
          for (const event of pending) {
            if (event.type === "mention.created")
              enqueueDirectMention(event, data);
            else enqueueDirect(event, data);
          }
        })
        .catch(() => {})
        .finally(() => {
          refreshPending.current = false;
          if (alive.current && unknown.current.size) requestUnknown();
        });
    }, 250);
  }
  useRealtimeChannel(userChannel(userId), (event) => {
    if (event.type === "room.activity" && event.roomKind === "dm") {
      const result = applyDirectActivity(client, event, userId);
      if (result === "missing") {
        unknown.current.set(
          `activity:${event.preview?.messageId ?? event.roomId}`,
          event,
        );
        requestUnknown();
      } else if (result === "applied")
        enqueueDirect(event, client.getQueryData<ChatNav>(CHAT_NAV_KEY));
      return;
    }
    if (event.type !== "mention.created") return;
    const fresh = applyMention(client, event);
    if (!fresh) return;
    if (event.roomKind === "dm") {
      const data = client.getQueryData<ChatNav>(CHAT_NAV_KEY);
      if (data?.directMessages.some((room) => room.roomId === event.roomId))
        enqueueDirectMention(event, data);
      else {
        unknown.current.set(`mention:${event.messageId}`, event);
        requestUnknown();
      }
    } else if (event.spaceId !== null) {
      enqueue({
        ...event,
        href: `/s/${event.spaceId}/${event.roomId}?message=${event.messageId}`,
        direct: false,
      });
    }
  });
  return null;
}

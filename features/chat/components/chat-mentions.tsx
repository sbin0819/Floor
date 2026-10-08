"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useRealtimeChannel,
  useRealtimeReauthorize,
} from "@/components/realtime-provider";
import { userChannel } from "@/lib/realtime/channels";
import type { RealtimeEvent } from "@/lib/realtime/types";
import type { ChatNav } from "../types";
import { groupDisplayName } from "../group-name";
import { unreadTitle } from "../unread-title";
import {
  CHAT_NAV_KEY,
  applyDirectActivity,
  applyMention,
  isViewingRoom,
  hasReadThrough,
  applyMyStatus,
  applyRoomActivity,
} from "../nav-state";

type Activity = Extract<RealtimeEvent, { type: "room.activity" }>;
type Mention = Extract<RealtimeEvent, { type: "mention.created" }>;
type ToastEntry = {
  messageId: string;
  seq: number;
  roomId: string;
  authorName: string;
  authorId?: string | null;
  excerpt: string;
  href: string;
  roomName?: string;
  groupName?: string;
  direct: boolean;
  meeting?: boolean;
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
  const reauthorize = useRealtimeReauthorize();
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
      if (!document.head.querySelector("title")) return;
      const current = document.title;
      const title = unreadTitle(current, count);
      if (title !== null && current !== title) document.title = title;
    };
    apply();
    const observer = new MutationObserver((records) => {
      const titleChanged = records.some((record) => {
        if (record.target.nodeName === "TITLE") return true;
        if (record.type === "characterData") {
          return record.target.parentElement?.tagName === "TITLE";
        }
        return [...record.addedNodes, ...record.removedNodes].some(
          (node) =>
            node instanceof Element &&
            (node.tagName === "TITLE" || node.querySelector("title") !== null),
        );
      });
      if (titleChanged) apply();
    });
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
    if (
      shown.current.has(entry.messageId) ||
      isViewingEntry(entry) ||
      suppressed(entry)
    )
      return;
    batch.current.set(entry.messageId, entry);
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      const entries = [...batch.current.values()].filter(
        (entry) =>
          !shown.current.has(entry.messageId) &&
          !isViewingEntry(entry) &&
          !suppressed(entry),
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
              ? (entry.groupName ?? entry.authorName)
              : `${entry.authorName} 님이 ${entry.meeting ? "" : "#"}${entry.roomName}에서 멘션했어요`,
            {
              id: `${entry.direct ? "dm" : "mention"}:${entry.messageId}`,
              description: entry.groupName
                ? `${entry.authorName}: ${entry.excerpt}`
                : entry.excerpt,
              action: { label: "보기", onClick: () => open(entry) },
            },
          );
    }, 250);
  }
  function suppressed(entry: ToastEntry) {
    const metadata = client.getQueryData<ChatNav>(CHAT_NAV_KEY);
    return (
      metadata?.myStatus === "dnd" ||
      Boolean(
        entry.authorId && metadata?.blockedUserIds?.includes(entry.authorId),
      )
    );
  }
  function isViewingEntry(entry: ToastEntry) {
    return (
      hasReadThrough(client, entry.roomId, entry.seq) ||
      isViewingRoom(client, entry.roomId) ||
      (entry.direct &&
        pathnameRef.current === `/dm/${entry.roomId}` &&
        document.visibilityState === "visible") ||
      (entry.meeting &&
        pathnameRef.current === entry.href &&
        document.visibilityState === "visible")
    );
  }
  function enqueueDirect(event: Activity, data: ChatNav | undefined) {
    const room = data?.directMessages.find(
      (room) => room.roomId === event.roomId,
    );
    if (
      !room ||
      room.muted ||
      !event.preview ||
      event.preview.authorName === null ||
      event.authorId === userId
    )
      return;
    enqueue({
      ...event.preview,
      authorName: event.preview.authorName,
      authorId: event.authorId,
      seq: event.seq,
      roomId: event.roomId,
      href: `/dm/${event.roomId}`,
      direct: true,
      ...(room.kind === "group_dm"
        ? {
            groupName: groupDisplayName(
              room.name,
              room.members.map((member) => member.name),
              room.memberCount - 1,
            ),
          }
        : {}),
    });
  }
  function enqueueDirectMention(event: Mention, data: ChatNav | undefined) {
    const room = data?.directMessages.find(
      (room) => room.roomId === event.roomId,
    );
    if (!room?.muted) return;
    enqueue({
      messageId: event.messageId,
      seq: event.seq,
      roomId: event.roomId,
      authorName: event.authorName,
      excerpt: event.excerpt,
      href: `/dm/${event.roomId}`,
      direct: true,
      ...(room.kind === "group_dm"
        ? {
            groupName: groupDisplayName(
              room.name,
              room.members.map((member) => member.name),
              room.memberCount - 1,
            ),
          }
        : {}),
    });
  }
  function enqueueMeetingMention(event: Mention) {
    if (!event.bookingId) return;
    enqueue({
      ...event,
      href: `/m/${event.bookingId}`,
      direct: false,
      meeting: true,
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
            if (event.roomKind === "meeting") {
              if (event.type === "mention.created")
                enqueueMeetingMention(event);
            } else if (event.type === "mention.created")
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
    if (event.type === "status.changed") {
      applyMyStatus(client, event.status);
      return;
    }
    if (event.type === "realtime.reauth" || event.type === "friend.changed") {
      if (event.type === "realtime.reauth") reauthorize();
      void refreshRef.current().catch(() => {});
      return;
    }
    if (event.type === "room.activity" && event.roomKind === "meeting") {
      const known = client
        .getQueryData<ChatNav>(CHAT_NAV_KEY)
        ?.meetings.some((room) => room.roomId === event.roomId);
      applyRoomActivity(client, event, userId);
      if (
        !known ||
        event.authorId === null ||
        event.preview === null ||
        event.preview.authorName === null
      ) {
        unknown.current.set(`meeting:${event.roomId}`, event);
        requestUnknown();
      }
      return;
    }
    if (
      event.type === "room.activity" &&
      (event.roomKind === "dm" || event.roomKind === "group_dm")
    ) {
      if (event.authorId === null || event.preview === null) {
        void refreshRef.current().catch(() => {});
        return;
      }
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
    if (event.roomKind === "dm" || event.roomKind === "group_dm") {
      const data = client.getQueryData<ChatNav>(CHAT_NAV_KEY);
      if (data?.directMessages.some((room) => room.roomId === event.roomId))
        enqueueDirectMention(event, data);
      else {
        unknown.current.set(`mention:${event.messageId}`, event);
        requestUnknown();
      }
    } else if (event.roomKind === "meeting") {
      if (
        client
          .getQueryData<ChatNav>(CHAT_NAV_KEY)
          ?.meetings.some((room) => room.roomId === event.roomId)
      )
        enqueueMeetingMention(event);
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

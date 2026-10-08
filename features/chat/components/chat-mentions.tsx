"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useRealtimeChannel } from "@/components/realtime-provider";
import { userChannel } from "@/lib/realtime/channels";
import type { RealtimeEvent } from "@/lib/realtime/types";
import { applyMention, isViewingRoom } from "../nav-state";

type Mention = Extract<RealtimeEvent, { type: "mention.created" }>;
export function ChatMentions({
  userId,
  count,
}: {
  userId: string;
  count: number;
}) {
  const client = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const shown = useRef(new Set<string>());
  const batch = useRef<Mention[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const apply = () => {
      const base = document.title.replace(/^\(\d+\)\s*/, "");
      const title = count > 0 ? `(${count}) ${base}` : base;
      if (document.title !== title) document.title = title;
    };
    apply();
    // Next가 이동 후 metadata를 갱신해도 현재 미확인 수를 한 번만 붙인다.
    const observer = new MutationObserver(apply);
    observer.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => observer.disconnect();
  }, [count, pathname]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      batch.current = [];
    },
    [],
  );
  useRealtimeChannel(userChannel(userId), (event) => {
    if (event.type !== "mention.created") return;
    const fresh = applyMention(client, event);
    if (
      !fresh ||
      shown.current.has(event.messageId) ||
      isViewingRoom(client, event.roomId)
    )
      return;
    shown.current.add(event.messageId);
    batch.current.push(event);
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      const events = batch.current;
      batch.current = [];
      const open = (entry: Mention) =>
        router.push(
          `/s/${entry.spaceId}/${entry.roomId}?message=${entry.messageId}`,
        );
      if (events.length >= 4)
        toast(`새 멘션 ${events.length}개`, {
          id: "mentions:batch",
          action: { label: "보기", onClick: () => open(events.at(-1)!) },
        });
      else
        for (const entry of events)
          toast(`${entry.authorName} 님이 #${entry.roomName}에서 멘션했어요`, {
            id: `mention:${entry.messageId}`,
            description: entry.excerpt,
            action: { label: "보기", onClick: () => open(entry) },
          });
    }, 250);
  });
  return null;
}

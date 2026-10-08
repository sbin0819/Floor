"use client";

import { useEffect, useRef } from "react";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { z } from "zod";
import {
  ChatRailNavigation,
  ChatSidebarNavigation,
  ChatSidebarTitle,
} from "@/components/chat-navigation";
import { useRealtimeChannel } from "@/components/realtime-provider";
import { useNotificationActivity } from "@/features/notifications/components/use-notification-activity";
import { spaceChannel } from "@/lib/realtime/channels";
import {
  CHAT_NAV_KEY,
  applyRoomActivity,
  chatNavRevision,
  mergeChatNav,
  mergeInitialChatNav,
} from "../nav-state";
import type { ChatSpaceNav } from "../types";
import { ChatMentions } from "./chat-mentions";

const navSchema = z.array(
  z.object({
    id: z.uuid(),
    kind: z.literal("team"),
    name: z.string(),
    initial: z.string(),
    unread: z.boolean(),
    unreadMentions: z.number().int().nonnegative(),
    muted: z.boolean(),
    channels: z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        unread: z.boolean(),
        unreadMentions: z.number().int().nonnegative(),
        muted: z.boolean(),
      }),
    ),
  }),
);
export async function fetchChatNav(
  signal: AbortSignal,
): Promise<ChatSpaceNav[]> {
  const response = await fetch("/api/chat/nav", {
    signal,
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error("채팅 목록을 불러오지 못했어요.");
  return navSchema.parse(await response.json());
}

function useIncoming(initialData: ChatSpaceNav[]) {
  const client = useQueryClient();
  useEffect(
    () => mergeInitialChatNav(client, initialData),
    [client, initialData],
  );
}

function useNavSnapshot(initialData: ChatSpaceNav[]) {
  useIncoming(initialData);
  const { data } = useQuery({
    queryKey: CHAT_NAV_KEY,
    queryFn: skipToken,
    initialData,
    enabled: false,
  });
  return data ?? initialData;
}
export function LiveChatRail({ spaces }: { spaces: ChatSpaceNav[] }) {
  return <ChatRailNavigation spaces={useNavSnapshot(spaces)} />;
}
export function LiveChatSidebar({ spaces }: { spaces: ChatSpaceNav[] }) {
  return <ChatSidebarNavigation spaces={useNavSnapshot(spaces)} />;
}
export function LiveChatSidebarTitle({ spaces }: { spaces: ChatSpaceNav[] }) {
  return <ChatSidebarTitle spaces={useNavSnapshot(spaces)} />;
}

export function ChatNavSync({
  initialData,
  userId,
  read = fetchChatNav,
}: {
  initialData: ChatSpaceNav[];
  userId: string;
  read?: typeof fetchChatNav;
}) {
  const client = useQueryClient();
  const pathname = usePathname();
  const activity = useNotificationActivity();
  useIncoming(initialData);
  const query = useQuery({
    queryKey: CHAT_NAV_KEY,
    queryFn: async ({ signal }) => {
      const revision = chatNavRevision(client);
      return mergeChatNav(client, await read(signal), revision);
    },
    initialData,
    enabled: activity.active,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: activity.active ? 60_000 : false,
    refetchIntervalInBackground: false,
  });
  const [, section, spaceId] = pathname.split("/");
  const selected =
    section === "s" &&
    query.data.some((space) => space.id === spaceId?.toLowerCase())
      ? spaceId!.toLowerCase()
      : null;
  useRealtimeChannel(selected ? spaceChannel(selected) : null, (event) => {
    if (event.type === "room.activity" && event.spaceId === selected)
      applyRoomActivity(client, event, userId);
  });
  const resumed = useRef(0);
  const { refetch } = query;
  useEffect(() => {
    if (!activity.active || resumed.current === activity.resumed) return;
    resumed.current = activity.resumed;
    void refetch({ cancelRefetch: false });
  }, [activity, refetch]);
  return (
    <ChatMentions
      userId={userId}
      count={query.data.reduce((sum, space) => sum + space.unreadMentions, 0)}
    />
  );
}

"use client";

import { useEffect, useRef } from "react";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  ChatRailNavigation,
  ChatSidebarNavigation,
  ChatSidebarTitle,
} from "@/components/chat-navigation";
import {
  useRealtimeLifecycle,
  useRealtimeReauthorize,
  useRealtimeSpaces,
} from "@/components/realtime-provider";
import { useNotificationActivity } from "@/features/notifications/components/use-notification-activity";
import { StatusSync } from "@/features/people/components/status-sync";
import {
  CHAT_NAV_KEY,
  applyRoomActivity,
  chatNavRevision,
  mergeChatNav,
  mergeInitialChatNav,
} from "../nav-state";
import type { ChatNav } from "../types";
import { ChatMentions } from "./chat-mentions";
import { DirectMessageList } from "./direct-message-list";

const spaceSchema = z.array(
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
const directNavBase = z.object({
  roomId: z.uuid(),
  lastSeq: z.number().int().nonnegative(),
  lastMessageAt: z.iso.datetime({ offset: true }),
  unread: z.boolean(),
  unreadCount: z.number().int().min(0).max(100),
  unreadMentions: z.number().int().nonnegative(),
  muted: z.boolean(),
});
const navSchema = z.object({
  myStatus: z.enum(["online", "away", "dnd"]),
  blockedUserIds: z.array(z.uuid()),
  spaces: spaceSchema,
  directMessages: z.array(
    z.discriminatedUnion("kind", [
      directNavBase.extend({
        kind: z.literal("dm"),
        other: z.object({
          userId: z.uuid(),
          name: z.string(),
          username: z.string().nullable(),
        }),
      }),
      directNavBase.extend({
        kind: z.literal("group_dm"),
        name: z.string().nullable(),
        memberCount: z.number().int().min(1).max(10),
        members: z
          .array(z.object({ userId: z.uuid(), name: z.string() }))
          .max(3),
      }),
    ]),
  ),
});
export async function fetchChatNav(signal: AbortSignal): Promise<ChatNav> {
  const response = await fetch("/api/chat/nav", {
    signal,
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error("채팅 목록을 불러오지 못했어요.");
  return navSchema.parse(await response.json());
}

function useIncoming(initialData: ChatNav) {
  const client = useQueryClient();
  useEffect(
    () => mergeInitialChatNav(client, initialData),
    [client, initialData],
  );
}

function useNavSnapshot(initialData: ChatNav) {
  const client = useQueryClient();
  useIncoming(initialData);
  const { data } = useQuery({
    queryKey: CHAT_NAV_KEY,
    queryFn: skipToken,
    initialData: () => mergeChatNav(client, initialData, null),
    enabled: false,
  });
  return data ?? initialData;
}
export function LiveChatRail({ data }: { data: ChatNav }) {
  const nav = useNavSnapshot(data);
  return (
    <ChatRailNavigation
      spaces={nav.spaces}
      directMessages={nav.directMessages}
    />
  );
}
export function LiveChatSidebar({ data }: { data: ChatNav }) {
  const nav = useNavSnapshot(data);
  return (
    <ChatSidebarNavigation
      spaces={nav.spaces}
      directMessages={nav.directMessages}
    />
  );
}
export function LiveChatSidebarTitle({ data }: { data: ChatNav }) {
  return <ChatSidebarTitle spaces={useNavSnapshot(data).spaces} />;
}
export function LiveDirectMessages({ data }: { data: ChatNav }) {
  return <DirectMessageList rows={useNavSnapshot(data).directMessages} />;
}

export function ChatNavSync({
  initialData,
  userId,
  read = fetchChatNav,
}: {
  initialData: ChatNav;
  userId: string;
  read?: typeof fetchChatNav;
}) {
  const client = useQueryClient();
  const activity = useNotificationActivity();
  useIncoming(initialData);
  const query = useQuery({
    queryKey: CHAT_NAV_KEY,
    queryFn: async ({ signal }) => {
      const revision = chatNavRevision(client);
      return mergeChatNav(client, await read(signal), revision);
    },
    initialData: () => mergeChatNav(client, initialData, null),
    enabled: activity.active,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: activity.active ? 60_000 : false,
    refetchIntervalInBackground: false,
  });
  const reauthorize = useRealtimeReauthorize();
  const scopeKey = query.data.spaces.map((space) => space.id).join(",");
  const previousScope = useRef(scopeKey);
  useEffect(() => {
    if (previousScope.current === scopeKey) return;
    previousScope.current = scopeKey;
    reauthorize();
  }, [scopeKey, reauthorize]);
  useRealtimeSpaces((event) => {
    if (event.type === "room.activity")
      applyRoomActivity(client, event, userId);
  });
  const disconnected = useRef(false);
  useRealtimeLifecycle((event) => {
    if (event.type !== "connection") return;
    if (["disconnected", "suspended", "failed"].includes(event.current))
      disconnected.current = true;
    else if (event.current === "connected" && disconnected.current) {
      disconnected.current = false;
      void query.refetch({ cancelRefetch: true });
    }
  });
  const resumed = useRef(0);
  const { refetch } = query;
  useEffect(() => {
    if (!activity.active || resumed.current === activity.resumed) return;
    resumed.current = activity.resumed;
    void refetch({ cancelRefetch: false });
  }, [activity, refetch]);
  return (
    <>
      <StatusSync status={query.data.myStatus} />
      <ChatMentions
        userId={userId}
        count={
          query.data.spaces.reduce(
            (sum, space) => sum + space.unreadMentions,
            0,
          ) +
          query.data.directMessages.reduce(
            (sum, room) =>
              sum + (room.muted ? room.unreadMentions : room.unreadCount),
            0,
          )
        }
        refresh={async () => (await refetch({ cancelRefetch: true })).data}
      />
    </>
  );
}

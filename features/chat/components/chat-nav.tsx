"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
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
  applyCallChanged,
  chatNavRevision,
  mergeChatNav,
  mergeInitialChatNav,
  homeUnreadCount,
} from "../nav-state";
import type { ChatNav } from "../types";
import { spaceIconColors } from "../space-schema";
import { ChatMentions } from "./chat-mentions";
import { DirectMessageList } from "./direct-message-list";
import { MeetingList } from "./meeting-list";
import { QuickSwitcher } from "./quick-switcher";

const spaceSchema = z.array(
  z.object({
    voiceChannels: z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        capacity: z.number().int().min(2).max(25),
        participantCount: z.number().int().min(0).max(25),
        participants: z
          .array(z.object({ userId: z.uuid(), name: z.string() }))
          .max(25),
      }),
    ),
    id: z.uuid(),
    kind: z.enum(["team", "branch", "community"]),
    iconColor: z.enum(spaceIconColors),
    role: z.enum(["member", "admin", "owner"]),
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
  callsEnabled: z.boolean(),
  calls: z.array(
    z.object({
      roomId: z.uuid(),
      participantCount: z.number().int().min(0).max(25),
    }),
  ),
  myCall: z
    .object({
      participantId: z.uuid(),
      sessionId: z.uuid(),
      roomId: z.uuid(),
      kind: z.enum(["voice", "huddle"]),
      joinedAt: z.iso.datetime({ offset: true }),
      stale: z.boolean(),
    })
    .nullable(),
  now: z.iso.datetime({ offset: true }),
  meetings: z.array(
    z.object({
      bookingId: z.uuid(),
      roomId: z.uuid(),
      title: z.string().nullable(),
      spaceName: z.string(),
      start: z.iso.datetime({ offset: true }),
      end: z.iso.datetime({ offset: true }),
      timezone: z.string(),
      phase: z.enum(["upcoming", "ongoing", "ended"]),
      unread: z.boolean(),
      unreadMentions: z.number().int().nonnegative(),
      muted: z.boolean(),
    }),
  ),
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
      meetings={nav.meetings}
    />
  );
}
export function LiveChatSidebar({ data }: { data: ChatNav }) {
  const nav = useNavSnapshot(data);
  return (
    <ChatSidebarNavigation
      spaces={nav.spaces}
      directMessages={nav.directMessages}
      meetings={nav.meetings}
      now={nav.now}
    />
  );
}
export function LiveChatSidebarTitle({ data }: { data: ChatNav }) {
  return <ChatSidebarTitle spaces={useNavSnapshot(data).spaces} />;
}
export function LiveDirectMessages({ data }: { data: ChatNav }) {
  return <DirectMessageList rows={useNavSnapshot(data).directMessages} />;
}
export function LiveMeetings({ data }: { data: ChatNav }) {
  const nav = useNavSnapshot(data);
  return <MeetingList rows={nav.meetings} now={nav.now} />;
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
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);
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
  const changedSpaces = useRef(new Set<string>());
  const refreshAllSpaces = useRef(false);
  const spaceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(spaceTimer.current), []);
  function refreshSpaces(spaceId?: string) {
    if (spaceId) changedSpaces.current.add(spaceId);
    else refreshAllSpaces.current = true;
    if (spaceTimer.current) return;
    spaceTimer.current = setTimeout(() => {
      spaceTimer.current = undefined;
      const currentSpace = /^\/s\/([^/]+)(?:\/|$)/.exec(
        pathnameRef.current,
      )?.[1];
      const refreshPage =
        currentSpace &&
        currentSpace !== "join" &&
        (refreshAllSpaces.current || changedSpaces.current.has(currentSpace));
      changedSpaces.current.clear();
      refreshAllSpaces.current = false;
      void query.refetch({ cancelRefetch: true });
      if (refreshPage) router.refresh();
    }, 250);
  }
  useRealtimeSpaces((event) => {
    if (event.type === "room.activity")
      applyRoomActivity(client, event, userId);
    else if (event.type === "space.changed") refreshSpaces(event.spaceId);
    else if (event.type === "call.changed") applyCallChanged(client, event);
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
      <QuickSwitcher userId={userId} />
      <StatusSync status={query.data.myStatus} />
      <ChatMentions
        userId={userId}
        count={
          query.data.spaces.reduce(
            (sum, space) => sum + space.unreadMentions,
            0,
          ) + homeUnreadCount(query.data)
        }
        refresh={async () => (await refetch({ cancelRefetch: true })).data}
        onReauthorize={() => refreshSpaces()}
      />
    </>
  );
}

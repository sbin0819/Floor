"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Grid2X2, Hash } from "lucide-react";
import { cn } from "cn";
import type {
  ChatSpaceNav,
  DirectMessageNav,
  MeetingNav,
} from "@/features/chat/types";
import { homeUnreadCount } from "@/features/chat/nav-state";
import { MeetingList } from "@/features/chat/components/meeting-list";
import { DirectMessageList } from "@/features/chat/components/direct-message-list";
import { MemberNav } from "@/components/member-nav";
import { LinkPending } from "@/components/link-pending";
import { ChatMuteButton } from "@/features/chat/components/chat-mute-button";
import { SpaceAdd } from "@/features/chat/components/space-add";
import { SpaceMenu } from "@/features/chat/components/space-menu";
import { spaceColorClasses } from "@/features/chat/components/space-colors";
import { ChannelDialog } from "@/features/chat/components/channel-dialog";
import { QuickSwitchButton } from "@/features/chat/components/quick-switcher";
import { VoiceChannelList } from "@/features/calls/components/voice-channel-list";
import { CallIndicator } from "@/features/calls/components/call-indicator";
import {
  shouldInterceptNavigation,
  useRouterOptimisticNavigation,
} from "@/components/optimistic-navigation";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function chatLocation(pathname: string) {
  const [, section, spaceId, roomId] = pathname.split("/");
  return section === "s" && spaceId !== "join"
    ? {
        spaceId: spaceId?.toLowerCase() ?? null,
        roomId: roomId === "settings" ? null : (roomId?.toLowerCase() ?? null),
      }
    : { spaceId: null, roomId: null };
}

export function ChatRailNavigation({
  spaces,
  directMessages = [],
  meetings = [],
}: {
  spaces: ChatSpaceNav[];
  directMessages?: DirectMessageNav[];
  meetings?: MeetingNav[];
}) {
  const pathname = usePathname();
  const navigation = useRouterOptimisticNavigation(
    chatLocation(pathname).spaceId,
  );
  const entries = [
    {
      id: null,
      kind: "home" as const,
      iconColor: "blue" as const,
      name: "홈",
      label: `Floor 홈${homeUnreadCount({ directMessages, meetings }) > 0 ? `, 읽지 않은 메시지 ${homeUnreadCount({ directMessages, meetings })}개` : ""}`,
      href: "/",
      initial: null,
      unread: false,
      unreadMentions: homeUnreadCount({ directMessages, meetings }),
    },
    ...spaces.map((space) => ({
      ...space,
      label: `${space.name}${space.unread ? ", 안 읽은 메시지 있음" : ""}${space.unreadMentions > 0 ? `, 멘션 ${space.unreadMentions}개` : ""}`,
      href: `/s/${space.id}`,
    })),
  ];
  return (
    <nav aria-label="스페이스" className="flex w-full shrink-0 flex-col gap-3">
      {entries.map((entry) => {
        const selected = navigation.value === entry.id;
        return (
          <div
            key={entry.id ?? "home"}
            className="flex w-full flex-col items-center gap-3"
          >
            <div className="relative flex w-full justify-center">
              {(selected || entry.unread) && (
                <span
                  aria-hidden="true"
                  data-unread={entry.unread || undefined}
                  className={cn(
                    "absolute top-1/2 left-0 w-1 -translate-y-1/2 rounded-r bg-foreground",
                    selected ? "h-7" : "h-2",
                  )}
                />
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href={entry.href}
                    aria-label={entry.label}
                    aria-current={selected ? "true" : undefined}
                    onClick={(event) => {
                      if (!shouldInterceptNavigation(event)) return;
                      event.preventDefault();
                      navigation.change(entry.id, entry.href);
                    }}
                    className={cn(
                      "relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      entry.kind === "community"
                        ? `${spaceColorClasses[entry.iconColor]} text-primary-foreground`
                        : selected
                          ? "bg-primary text-primary-foreground"
                          : "bg-card text-foreground hover:bg-sidebar-accent",
                    )}
                  >
                    <LinkPending />
                    {entry.id === null ? (
                      <Grid2X2 aria-hidden="true" className="relative size-5" />
                    ) : entry.kind === "branch" ? (
                      <Building2
                        aria-hidden="true"
                        className="relative size-5"
                      />
                    ) : (
                      <span aria-hidden="true" className="relative">
                        {entry.initial}
                      </span>
                    )}
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">{entry.name}</TooltipContent>
              </Tooltip>
              {entry.unreadMentions > 0 && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-0.5 -bottom-1 min-w-5 rounded-full bg-status-busy-strong px-1 text-center text-xs font-semibold text-primary-foreground tabular-nums"
                >
                  {entry.unreadMentions > 99 ? "99+" : entry.unreadMentions}
                </span>
              )}
            </div>
            {entry.id === null && (
              <div
                aria-hidden="true"
                className="h-px w-10 shrink-0 bg-sidebar-border"
              />
            )}
          </div>
        );
      })}
      <SpaceAdd />
    </nav>
  );
}

export function ChatSidebarTitle({ spaces }: { spaces: ChatSpaceNav[] }) {
  const { spaceId } = chatLocation(usePathname());
  const space = spaces.find(({ id }) => id === spaceId);
  if (space) return <SpaceMenu key={space.id} space={space} />;
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Link
        href="/"
        className="inline-flex min-h-11 min-w-0 items-center rounded-lg font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="truncate">Floor</span>
      </Link>
    </div>
  );
}

export function ChatSidebarNavigation({
  spaces,
  directMessages = [],
  meetings = [],
  now,
  callsEnabled = false,
  calls = [],
}: {
  spaces: ChatSpaceNav[];
  directMessages?: DirectMessageNav[];
  meetings?: MeetingNav[];
  now?: string;
  callsEnabled?: boolean;
  calls?: { roomId: string; participantCount: number }[];
}) {
  const { spaceId, roomId } = chatLocation(usePathname());
  const navigation = useRouterOptimisticNavigation(roomId);
  const space = spaces.find(({ id }) => id === spaceId);
  if (!space)
    return (
      <div className="space-y-6">
        <QuickSwitchButton className="hidden xl:flex" />
        <MemberNav />
        {now && <MeetingList rows={meetings} now={now} calls={calls} />}
        <DirectMessageList rows={directMessages} limit={10} calls={calls} />
      </div>
    );
  return (
    <nav aria-label={`${space.name} 텍스트 채널`} className="space-y-2">
      <div className="flex items-center justify-between px-3 pt-2 text-xs font-semibold text-muted-foreground">
        <p>텍스트 채널</p>
        {space.role !== "member" && (
          <ChannelDialog spaceId={space.id} compact />
        )}
      </div>
      <div className="flex flex-col gap-1">
        {space.channels.map((channel) => {
          const href = `/s/${space.id}/${channel.id}`;
          const selected = navigation.value === channel.id;
          const call = calls.find(
            (call) => call.roomId === channel.id && call.participantCount > 0,
          );
          return (
            <div key={channel.id} className="group flex items-center">
              <Link
                href={href}
                aria-current={selected ? "page" : undefined}
                aria-label={`${channel.name}${channel.unread && !channel.muted && !space.muted ? ", 안 읽은 메시지 있음" : ""}${channel.unreadMentions > 0 ? `, 멘션 ${channel.unreadMentions}개` : ""}${call ? `, 통화 중, ${call.participantCount}명` : ""}`}
                onClick={(event) => {
                  if (!shouldInterceptNavigation(event)) return;
                  event.preventDefault();
                  navigation.change(channel.id, href);
                }}
                className={cn(
                  "relative flex h-11 min-h-11 min-w-0 flex-1 items-center gap-2 rounded-sm px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  selected
                    ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60",
                  channel.unread &&
                    !channel.muted &&
                    !space.muted &&
                    "font-bold text-foreground",
                  (channel.muted || space.muted) && "text-muted-foreground",
                )}
              >
                <LinkPending />
                <Hash aria-hidden="true" className="relative size-5 shrink-0" />
                <span className="relative truncate">{channel.name}</span>
                <CallIndicator count={call?.participantCount} />
                {channel.unreadMentions > 0 && (
                  <span
                    aria-hidden="true"
                    className="relative ml-auto min-w-5 rounded-full bg-status-busy-strong px-1 text-center text-xs font-semibold text-primary-foreground tabular-nums"
                  >
                    {channel.unreadMentions > 99
                      ? "99+"
                      : channel.unreadMentions}
                  </span>
                )}
              </Link>
              <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                <ChatMuteButton
                  id={channel.id}
                  name={channel.name}
                  muted={channel.muted}
                  manageSpaceId={space.role !== "member" ? space.id : undefined}
                />
              </div>
            </div>
          );
        })}
      </div>
      {space.channels.length === 0 && (
        <p className="px-3 text-sm text-muted-foreground">
          아직 열린 채널이 없어요
        </p>
      )}
      {space.voiceChannels.length > 0 && (
        <VoiceChannelList
          space={space}
          enabled={callsEnabled}
          selected={roomId}
        />
      )}
    </nav>
  );
}

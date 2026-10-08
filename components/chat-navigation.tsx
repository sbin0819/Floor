"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Grid2X2, Hash } from "lucide-react";
import { cn } from "cn";
import type { ChatSpaceNav } from "@/features/chat/types";
import { MemberNav } from "@/components/member-nav";
import { LinkPending } from "@/components/link-pending";
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
  return section === "s"
    ? {
        spaceId: spaceId?.toLowerCase() ?? null,
        roomId: roomId?.toLowerCase() ?? null,
      }
    : { spaceId: null, roomId: null };
}

export function ChatRailNavigation({ spaces }: { spaces: ChatSpaceNav[] }) {
  const pathname = usePathname();
  const navigation = useRouterOptimisticNavigation(
    chatLocation(pathname).spaceId,
  );
  const entries = [
    { id: null, name: "홈", label: "Floor 홈", href: "/", initial: null },
    ...spaces.map((space) => ({
      ...space,
      label: space.name,
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
              {selected && (
                <span
                  aria-hidden="true"
                  className="absolute inset-y-2 left-0 w-1 rounded-r bg-primary"
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
                      selected
                        ? "bg-primary text-primary-foreground"
                        : "bg-card text-foreground hover:bg-sidebar-accent",
                    )}
                  >
                    <LinkPending />
                    {entry.id === null ? (
                      <Grid2X2 aria-hidden="true" className="relative size-5" />
                    ) : (
                      <span aria-hidden="true" className="relative">
                        {entry.initial}
                      </span>
                    )}
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">{entry.name}</TooltipContent>
              </Tooltip>
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
    </nav>
  );
}

export function ChatSidebarTitle({ spaces }: { spaces: ChatSpaceNav[] }) {
  const { spaceId } = chatLocation(usePathname());
  const space = spaces.find(({ id }) => id === spaceId);
  return (
    <Link
      href={space ? `/s/${space.id}` : "/"}
      className="inline-flex min-h-11 min-w-0 items-center rounded-lg font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span className="truncate">{space?.name ?? "Floor"}</span>
    </Link>
  );
}

export function ChatSidebarNavigation({ spaces }: { spaces: ChatSpaceNav[] }) {
  const { spaceId, roomId } = chatLocation(usePathname());
  const navigation = useRouterOptimisticNavigation(roomId);
  const space = spaces.find(({ id }) => id === spaceId);
  if (!space) return <MemberNav />;
  return (
    <nav aria-label={`${space.name} 텍스트 채널`} className="space-y-2">
      <p className="px-3 pt-2 text-xs font-semibold text-muted-foreground">
        텍스트 채널
      </p>
      <div className="flex flex-col gap-1">
        {space.channels.map((channel) => {
          const href = `/s/${space.id}/${channel.id}`;
          const selected = navigation.value === channel.id;
          return (
            <Link
              key={channel.id}
              href={href}
              aria-current={selected ? "page" : undefined}
              onClick={(event) => {
                if (!shouldInterceptNavigation(event)) return;
                event.preventDefault();
                navigation.change(channel.id, href);
              }}
              className={cn(
                "relative flex h-11 min-h-11 items-center gap-2 rounded-sm px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                selected
                  ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60",
              )}
            >
              <LinkPending />
              <Hash aria-hidden="true" className="relative size-5 shrink-0" />
              <span className="relative truncate">{channel.name}</span>
            </Link>
          );
        })}
      </div>
      {space.channels.length === 0 && (
        <p className="px-3 text-sm text-muted-foreground">
          아직 열린 채널이 없어요
        </p>
      )}
    </nav>
  );
}

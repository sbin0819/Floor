"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useOptimistic, useTransition, type ReactNode } from "react";
import { cn } from "cn";
import { selectedTeamTab, teamHref, type TeamTab } from "../navigation";
import type { TeamRole } from "../types";
import { TeamTabSkeleton } from "./team-tab-skeleton";

export function TeamTabs({
  teamId,
  role,
  memberCount,
  bookingCount,
  requestCount,
  children,
}: {
  teamId: string;
  role: TeamRole;
  memberCount: number;
  bookingCount: number;
  requestCount: number;
  children: ReactNode;
}) {
  const router = useRouter(),
    pathname = usePathname(),
    search = useSearchParams();
  const activePath = pathname === `/teams/${teamId}`;
  const current = selectedTeamTab(
    activePath ? search.get("tab") : undefined,
    role,
  );
  const [selected, select] = useOptimistic(current);
  const [pending, startTransition] = useTransition();
  const tabs: { value: TeamTab; label: string; count?: number }[] = [
    { value: "members", label: "팀원", count: memberCount },
    ...(role === "admin"
      ? [
          {
            value: "requests" as const,
            label: "요청·초대",
            count: requestCount,
          },
        ]
      : []),
    { value: "bookings", label: "팀 예약", count: bookingCount },
    ...(role === "admin"
      ? [{ value: "settings" as const, label: "설정" }]
      : []),
  ];
  const loading = pending && selected !== current;
  return (
    <>
      <nav aria-label="팀 화면" className="flex overflow-x-auto border-b">
        {tabs.map((tab) => {
          const href = teamHref(teamId, { tab: tab.value });
          return (
            <Link
              key={tab.value}
              href={href}
              aria-current={selected === tab.value ? "page" : undefined}
              className={cn(
                "flex min-h-11 shrink-0 items-center gap-2 border-b-2 border-transparent px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring",
                selected === tab.value
                  ? "border-foreground text-foreground"
                  : "text-muted-foreground",
              )}
              onClick={(event) => {
                if (
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return;
                event.preventDefault();
                startTransition(() => {
                  select(tab.value);
                  router.push(href, { scroll: false });
                });
              }}
            >
              {tab.label}{" "}
              {tab.count !== undefined &&
                (tab.value !== "requests" || tab.count > 0) && (
                  <span
                    className={cn(
                      "tabular-nums",
                      tab.value === "requests" &&
                        "flex min-w-5 items-center justify-center rounded-full bg-status-busy-strong px-1 text-xs text-primary-foreground",
                    )}
                  >
                    {tab.count}
                  </span>
                )}
            </Link>
          );
        })}
      </nav>
      {loading && <TeamTabSkeleton tab={selected} />}
      <div hidden={loading}>{children}</div>
    </>
  );
}

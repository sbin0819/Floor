"use client";

import Link from "next/link";
import { useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  shouldInterceptNavigation,
  useOptimisticNavigation,
  type NavigateAction,
} from "@/components/optimistic-navigation";
import { SkeletonRegion } from "@/components/skeleton-region";
import { SkeletonRows } from "@/components/skeleton-shapes";
import { teamStartHref, type TeamStartMode } from "@/features/teams/start-mode";
import type { TeamStartData } from "@/features/teams/types";
import { CreateTeamForm } from "./create-team-form";
import { TeamSearchForm } from "./team-search-form";
import { TeamSearchResults } from "./team-search-results";
import { teamLinkClassName } from "./team-display";
import {
  TeamStartShell,
  TeamStartChoices,
  TeamInvitesLoading,
} from "./team-start-shell";

export function TeamStart({
  data,
  mode = "choose",
  navigateAction,
}: {
  data: TeamStartData;
  mode?: TeamStartMode;
  navigateAction?: NavigateAction;
}) {
  const router = useRouter();
  const navigate = useCallback<NavigateAction>(
    (href) => router.push(href),
    [router],
  );
  const navigation = useOptimisticNavigation(mode, navigateAction ?? navigate);
  const chosen = navigation.value;
  const pending = navigation.isPending && chosen !== mode;
  const modeLink = (
    next: TeamStartMode,
    label: string,
    className = teamLinkClassName,
  ) => (
    <Link
      className={className}
      href={teamStartHref(next, data.search.query)}
      onClick={(event) => {
        if (!shouldInterceptNavigation(event)) return;
        event.preventDefault();
        navigation.change(next, teamStartHref(next, data.search.query));
      }}
    >
      {label}
    </Link>
  );
  return (
    <TeamStartShell
      mode={chosen}
      back={
        chosen === "choose" ? (
          <Link className={teamLinkClassName} href="/teams">
            ‹ 팀
          </Link>
        ) : (
          modeLink("choose", "‹ 다시 고르기")
        )
      }
    >
      {chosen === "choose" ? (
        <>
          {pending ? (
            <TeamInvitesLoading />
          ) : (
            data.invites.length > 0 && (
              <aside className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-status-pending p-5 text-status-pending-foreground">
                <p>
                  {data.invites.length === 1
                    ? `${data.invites[0]!.teamName}에서 초대가 와 있어요. 수락하면 바로 팀원이 돼요`
                    : `받은 초대가 ${data.invites.length}개 있어요`}
                </p>
                <Link className={teamLinkClassName} href="/teams">
                  초대 보기
                </Link>
              </aside>
            )
          )}
          <TeamStartChoices
            createLink={modeLink("create", "새 팀 만들기", "")}
            joinLink={modeLink("join", "팀 찾기", "")}
          />
        </>
      ) : chosen === "create" ? (
        <CreateTeamForm
          branches={data.branches}
          branchesPending={pending}
          cancel={modeLink("choose", "취소", "")}
        />
      ) : (
        <>
          <div className="rounded-xl border bg-card p-5">
            <TeamSearchForm key={data.search.query} query={data.search.query} />
          </div>
          {pending ? (
            <SkeletonRegion>
              <SkeletonRows count={2} action />
            </SkeletonRegion>
          ) : (
            <TeamSearchResults search={data.search} />
          )}
        </>
      )}
    </TeamStartShell>
  );
}

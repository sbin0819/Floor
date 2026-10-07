"use client";

import Link from "next/link";
import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import {
  shouldInterceptNavigation,
  useOptimisticNavigation,
  type NavigateAction,
} from "@/components/optimistic-navigation";
import { Button } from "@/components/ui/button";
import { PageContainer, PageHeading } from "@/components/page-container";
import { SkeletonRegion } from "@/components/skeleton-region";
import { SkeletonRows } from "@/components/skeleton-shapes";
import { teamStartHref, type TeamStartMode } from "@/features/teams/start-mode";
import type { TeamStartData } from "@/features/teams/types";
import { CreateTeamForm } from "./create-team-form";
import { TeamSearchForm } from "./team-search-form";
import { TeamSearchResults } from "./team-search-results";
import { teamLinkClassName } from "./team-display";

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
    <PageContainer
      as="main"
      width={chosen === "choose" ? "standard" : "form"}
      className="space-y-6"
    >
      {chosen === "choose" ? (
        <Link className={teamLinkClassName} href="/teams">
          ‹ 팀
        </Link>
      ) : (
        modeLink("choose", "‹ 다시 고르기")
      )}
      <PageHeading
        title={
          chosen === "create"
            ? "새 팀 만들기"
            : chosen === "join"
              ? "기존 팀에 가입"
              : "팀 회원으로 전환"
        }
        description={
          chosen === "create"
            ? "만들면 바로 팀 관리자가 되고, 팀원을 초대할 수 있어요"
            : chosen === "join"
              ? "팀 이름으로 찾아 가입 요청을 보내 주세요"
              : "어떻게 시작할지 골라 주세요. 둘 다 나중에 다시 할 수 있어요"
        }
      />
      {chosen === "choose" ? (
        <>
          {data.invites.length > 0 && (
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
          )}
          <div className="grid gap-5 sm:grid-cols-2">
            <section className="space-y-5 rounded-xl border bg-card p-6">
              <Plus
                aria-hidden="true"
                className="size-8 text-muted-foreground"
              />
              <div>
                <h2 className="text-xl font-semibold">새 팀 만들기</h2>
                <p className="mt-2 text-muted-foreground">
                  우리 팀이 아직 Floor에 없을 때
                </p>
              </div>
              <ul className="space-y-2 text-sm">
                <li>승인 없이 바로 만들어져요</li>
                <li>내가 팀 관리자가 되어 팀원을 초대해요</li>
                <li>팀 이름, 주 이용 지점, 인원, 연락처를 입력해요</li>
              </ul>
              <Button asChild className="w-full">
                {modeLink("create", "새 팀 만들기", "")}
              </Button>
            </section>
            <section className="space-y-5 rounded-xl border bg-card p-6">
              <Search
                aria-hidden="true"
                className="size-8 text-muted-foreground"
              />
              <div>
                <h2 className="text-xl font-semibold">기존 팀에 가입</h2>
                <p className="mt-2 text-muted-foreground">
                  우리 팀이 이미 Floor를 쓰고 있을 때
                </p>
              </div>
              <ul className="space-y-2 text-sm">
                <li>팀 이름으로 찾아 가입 요청을 보내요</li>
                <li>팀 관리자가 승인하면 팀원이 돼요</li>
                <li>요청은 언제든 취소할 수 있어요</li>
              </ul>
              <Button asChild variant="outline" className="w-full">
                {modeLink("join", "팀 찾기", "")}
              </Button>
            </section>
          </div>
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
    </PageContainer>
  );
}

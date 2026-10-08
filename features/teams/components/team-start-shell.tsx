import Link from "next/link";
import type { ReactNode } from "react";
import { Plus, Search } from "lucide-react";
import { PageContainer, PageHeading } from "@/components/page-container";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonRegion } from "@/components/skeleton-region";
import { SkeletonRows } from "@/components/skeleton-shapes";
import { teamStartHref, type TeamStartMode } from "../start-mode";
import { teamLinkClassName } from "./team-display";

export function TeamStartShell({
  mode,
  back,
  children,
}: {
  mode: TeamStartMode;
  back?: ReactNode;
  children: ReactNode;
}) {
  return (
    <PageContainer
      as="main"
      width={mode === "choose" ? "standard" : "form"}
      className="space-y-6"
    >
      {back ?? (
        <Link
          className={teamLinkClassName}
          href={mode === "choose" ? "/teams" : "/teams/start"}
        >
          {mode === "choose" ? "‹ 팀" : "‹ 다시 고르기"}
        </Link>
      )}
      <PageHeading
        title={
          mode === "create"
            ? "새 팀 만들기"
            : mode === "join"
              ? "기존 팀에 가입"
              : "팀 회원으로 전환"
        }
        description={
          mode === "create"
            ? "만들면 바로 팀 관리자가 되고, 팀원을 초대할 수 있어요"
            : mode === "join"
              ? "팀 이름으로 찾아 가입 요청을 보내 주세요"
              : "어떻게 시작할지 골라 주세요. 둘 다 나중에 다시 할 수 있어요"
        }
      />
      {children}
    </PageContainer>
  );
}

export function TeamStartChoices({
  createLink,
  joinLink,
}: {
  createLink?: ReactNode;
  joinLink?: ReactNode;
}) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <section className="space-y-5 rounded-xl border bg-card p-6">
        <Plus aria-hidden="true" className="size-8 text-muted-foreground" />
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
          {createLink ?? (
            <Link href={teamStartHref("create")}>새 팀 만들기</Link>
          )}
        </Button>
      </section>
      <section className="space-y-5 rounded-xl border bg-card p-6">
        <Search aria-hidden="true" className="size-8 text-muted-foreground" />
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
          {joinLink ?? <Link href={teamStartHref("join")}>팀 찾기</Link>}
        </Button>
      </section>
    </div>
  );
}

export function TeamInvitesLoading() {
  return (
    <SkeletonRegion className="rounded-xl border p-5">
      <Skeleton className="h-5 w-64 max-w-full" />
    </SkeletonRegion>
  );
}

export function TeamStartLoading({
  mode = "choose",
}: {
  mode?: TeamStartMode;
}) {
  return (
    <TeamStartShell mode={mode}>
      {mode === "choose" ? (
        <>
          <TeamInvitesLoading />
          <TeamStartChoices />
        </>
      ) : (
        <SkeletonRegion className="space-y-5 rounded-xl border bg-card p-5">
          {(mode === "create"
            ? [
                "팀(회사) 이름",
                "주 이용 지점",
                "인원 규모",
                "담당자 연락처",
                "직함 (선택)",
              ]
            : ["팀 이름으로 찾기"]
          ).map((label) => (
            <div key={label} className="space-y-2">
              <p className="text-sm font-medium">{label}</p>
              <Skeleton className="h-11 w-full" />
            </div>
          ))}
          {mode === "join" ? (
            <SkeletonRows count={2} action />
          ) : (
            <Button disabled className="w-full">
              팀 만들기
            </Button>
          )}
        </SkeletonRegion>
      )}
    </TeamStartShell>
  );
}

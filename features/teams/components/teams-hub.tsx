import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageContainer, PageHeading } from "@/components/page-container";
import type { TeamsData } from "@/features/teams/types";
import { teamStartHref } from "@/features/teams/start-mode";
import { InviteResponse } from "./invite-response";
import { CancelJoinRequest } from "./request-controls";
import { roleLabel, TeamDate, teamLinkClassName } from "./team-display";

export function TeamsHub({ data }: { data: TeamsData }) {
  return (
    <PageContainer as="main" className="space-y-8">
      <PageHeading
        title="팀"
        description="팀에 속하면 팀 전용 공간을 쓰고, 팀 이름으로 더 길게 예약할 수 있어요"
        action={
          <Button asChild>
            <Link href="/teams/start">
              <Plus aria-hidden="true" />팀 만들기 또는 가입
            </Link>
          </Button>
        }
      />
      {data.invites.length > 0 && (
        <section aria-label="받은 초대" className="space-y-4">
          <h2 className="font-semibold">
            받은 초대{" "}
            <Badge className="ml-2 border-0 bg-status-pending text-status-pending-foreground tabular-nums">
              {data.invites.length}
            </Badge>
          </h2>
          <ul className="space-y-3">
            {data.invites.map((invite) => (
              <li
                key={invite.token}
                className="space-y-3 rounded-xl border bg-card p-5 [&:has([data-team-pending=true])]:opacity-50"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3 className="font-semibold">{invite.teamName}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {invite.inviterName}님이 초대했어요 ·{" "}
                      <TeamDate value={invite.expiresAt} />
                      까지 수락할 수 있어요
                    </p>
                  </div>
                  <InviteResponse token={invite.token} />
                </div>
                {invite.message && (
                  <p className="rounded-lg border bg-background p-3 text-sm break-words whitespace-pre-wrap">
                    {invite.message}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-label="내 팀" className="space-y-4">
        <h2 className="font-semibold">
          내 팀{" "}
          <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
            {data.teams.length}개
          </span>
        </h2>
        {data.teams.length ? (
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            {data.teams.map((team) => (
              <li key={team.id}>
                <Link
                  href={`/teams/${team.id}`}
                  className="flex min-h-11 items-center gap-4 p-5 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted font-semibold"
                  >
                    {Array.from(team.name)[0]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold">{team.name}</h3>
                    <p className="mt-1 text-sm text-muted-foreground tabular-nums">
                      팀원 {team.memberCount}명 · 주 이용 지점{" "}
                      {team.homeBranchName ?? "정해지지 않았어요"}
                    </p>
                  </div>
                  <Badge variant="secondary">{roleLabel(team.role)}</Badge>
                  <ChevronRight
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-xl border bg-card p-5">
            <p>아직 속한 팀이 없어요</p>
            <Link className={teamLinkClassName} href="/teams/start">
              팀 만들기 또는 가입
            </Link>
          </div>
        )}
      </section>
      {data.requests.length > 0 && (
        <section aria-label="보낸 가입 요청" className="space-y-4">
          <h2 className="font-semibold">보낸 가입 요청</h2>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            {data.requests.map((request) => (
              <li
                key={request.id}
                className="flex flex-wrap items-center justify-between gap-4 p-5 [&:has([data-team-pending=true])]:opacity-50"
              >
                <div className="min-w-0">
                  <h3 className="font-semibold">{request.teamName}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <TeamDate value={request.createdAt} />에 보냄
                    {request.status === "rejected" && request.decidedAt ? (
                      <>
                        {" "}
                        · <TeamDate value={request.decidedAt} />에 처리됨
                      </>
                    ) : (
                      " · 팀 관리자가 승인하면 팀원이 돼요"
                    )}
                  </p>
                  {request.message && (
                    <p className="mt-2 text-sm break-words whitespace-pre-wrap">
                      {request.message}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="secondary">
                    {request.status === "pending" ? "승인 대기" : "거절됨"}
                  </Badge>
                  {request.status === "pending" ? (
                    <CancelJoinRequest requestId={request.id} />
                  ) : (
                    <Link
                      className={teamLinkClassName}
                      href={teamStartHref("join", request.teamName)}
                    >
                      다시 요청
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageContainer>
  );
}

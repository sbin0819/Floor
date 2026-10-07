import Link from "next/link";
import type { InvitePageData } from "@/features/teams/types";
import { PageContainer } from "@/components/page-container";
import { InviteResponse } from "./invite-response";
import { TeamDate, teamLinkClassName } from "./team-display";

export function InviteDetail({ data }: { data: InvitePageData | null }) {
  return (
    <PageContainer as="main" width="form">
      <section className="mx-auto max-w-[480px] space-y-5 rounded-xl border bg-card p-6">
        {data ? (
          <>
            <p className="text-sm text-muted-foreground">팀 초대</p>
            <h1 className="text-2xl font-semibold">{data.teamName}</h1>
            <p>{data.inviterName}님이 초대했어요</p>
            {data.message && (
              <p className="rounded-lg border bg-background p-4 break-words whitespace-pre-wrap">
                {data.message}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              만료일: <TeamDate value={data.expiresAt} />
            </p>
            <InviteResponse token={data.token} leaveOnDecline />
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">
              이 초대는 더 이상 쓸 수 없어요
            </h1>
            <Link className={teamLinkClassName} href="/teams">
              팀으로 가기
            </Link>
          </>
        )}
      </section>
    </PageContainer>
  );
}

import Link from "next/link";
import { PageContainer, PageHeading } from "@/components/page-container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { HomeData } from "@/features/teams/types";
import { roleLabel, TeamSection, teamLinkClassName } from "./team-display";

export function TeamHome({
  data,
  bookingHref,
}: {
  data: HomeData;
  bookingHref?: string;
}) {
  return (
    <PageContainer as="main" width="wide" className="space-y-6">
      <PageHeading title={`안녕하세요, ${data.name}님`} />
      {bookingHref && (
        <Card className="max-w-2xl">
          <CardHeader>
            <h2 className="text-xl font-semibold">공간 예약하기</h2>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>지점과 층을 골라 회의실을 예약해요</p>
            <Button asChild>
              <Link href={bookingHref}>공간 예약하기</Link>
            </Button>
          </CardContent>
        </Card>
      )}
      {data.teams.length === 0 ? (
        <Card className="max-w-2xl">
          <CardHeader>
            <h2 className="text-xl font-semibold">팀 회원으로 전환</h2>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>팀을 만들거나 팀에 들어가면 팀 전용 공간을 쓸 수 있어요</p>
            {data.pendingInviteCount > 0 && (
              <p className="tabular-nums">
                받은 초대 {data.pendingInviteCount}개
              </p>
            )}
            <Button asChild>
              <Link href="/teams/start">팀 회원으로 전환</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <TeamSection title="내 팀">
            <ul className="divide-y divide-border">
              {data.teams.map((team) => (
                <li
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                  key={team.id}
                >
                  <Link
                    href={`/teams/${team.id}`}
                    className={teamLinkClassName}
                  >
                    {team.name}
                  </Link>
                  <span className="text-sm text-muted-foreground">
                    {roleLabel(team.role)}
                  </span>
                </li>
              ))}
            </ul>
          </TeamSection>
          <div className="flex flex-wrap items-center gap-4">
            <Button asChild variant="outline">
              <Link href="/teams/start">다른 팀 만들기·가입</Link>
            </Button>
            {data.pendingInviteCount > 0 && (
              <Link
                className={`${teamLinkClassName} tabular-nums`}
                href="/teams"
              >
                받은 초대 {data.pendingInviteCount}개
              </Link>
            )}
          </div>
        </>
      )}
      {data.isOperator && (
        <Link href="/admin" className={teamLinkClassName}>
          운영자 화면
        </Link>
      )}
    </PageContainer>
  );
}

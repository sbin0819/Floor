import type { InvitePageData } from "@/features/teams/types";
import { PageContainer, PageHeading } from "@/components/page-container";
import { InviteResponse } from "./invite-response";
import { TeamDate, TeamSection } from "./team-display";

export function InviteDetail({ data }: { data: InvitePageData | null }) {
  if (!data)
    return (
      <PageContainer as="main" width="form">
        <PageHeading title="이 초대는 더 이상 쓸 수 없어요" />
      </PageContainer>
    );
  return (
    <PageContainer as="main" width="form" className="space-y-6">
      <PageHeading title="팀 초대" />
      <TeamSection title={data.teamName}>
        <p>{data.inviterName}님이 초대했어요</p>
        {data.message && (
          <p className="break-words whitespace-pre-wrap">{data.message}</p>
        )}
        <p className="text-xs text-muted-foreground">
          만료일: <TeamDate value={data.expiresAt} />
        </p>
        <InviteResponse token={data.token} leaveOnDecline />
      </TeamSection>
    </PageContainer>
  );
}

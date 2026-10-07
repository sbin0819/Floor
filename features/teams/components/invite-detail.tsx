import type { InvitePageData } from "@/features/teams/types";
import { InviteResponse } from "./invite-response";
import { TeamDate, TeamSection } from "./team-display";

export function InviteDetail({ data }: { data: InvitePageData | null }) {
  if (!data)
    return (
      <main className="mx-auto max-w-2xl px-6 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          이 초대는 더 이상 쓸 수 없어요
        </h1>
      </main>
    );
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">팀 초대</h1>
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
    </main>
  );
}

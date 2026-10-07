import type { TeamStartData } from "@/features/teams/types";
import { PageContainer, PageHeading } from "@/components/page-container";
import { CreateTeamForm } from "./create-team-form";
import { InviteResponse } from "./invite-response";
import { CancelJoinRequest, JoinRequestForm } from "./request-controls";
import { EmptyTeamList, TeamDate, TeamSection } from "./team-display";
import { TeamSearchForm } from "./team-search-form";

export function TeamStart({ data }: { data: TeamStartData }) {
  return (
    <PageContainer as="main" width="form" className="space-y-6">
      <PageHeading title="팀 회원으로 전환" />
      <div id="received-invites">
        <TeamSection title="받은 초대">
          {data.invites.length === 0 ? (
            <EmptyTeamList>받은 초대가 없어요</EmptyTeamList>
          ) : (
            <ul className="divide-y divide-border">
              {data.invites.map((invite) => (
                <li
                  className="space-y-3 py-4 first:pt-0 last:pb-0"
                  key={invite.token}
                >
                  <h3 className="text-base font-semibold">{invite.teamName}</h3>
                  <p className="text-sm">{invite.inviterName}님이 초대했어요</p>
                  {invite.message && (
                    <p className="text-sm break-words whitespace-pre-wrap">
                      {invite.message}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    만료일: <TeamDate value={invite.expiresAt} />
                  </p>
                  <InviteResponse token={invite.token} />
                </li>
              ))}
            </ul>
          )}
        </TeamSection>
      </div>
      <TeamSection title="새 팀 만들기">
        <CreateTeamForm branches={data.branches} />
      </TeamSection>
      <TeamSection title="기존 팀에 가입 요청">
        <TeamSearchForm key={data.search.query} query={data.search.query} />
        {data.search.error ? (
          <p role="status" className="text-sm text-muted-foreground">
            {data.search.error}
          </p>
        ) : !data.search.query ? (
          <EmptyTeamList>가입하고 싶은 팀 이름을 검색해 주세요</EmptyTeamList>
        ) : data.search.results.length === 0 ? (
          <EmptyTeamList>검색한 팀이 없어요</EmptyTeamList>
        ) : (
          <ul className="divide-y divide-border">
            {data.search.results.map((team) => (
              <li key={team.id} className="space-y-3 py-4">
                <h3 className="text-base font-semibold">{team.name}</h3>
                <p className="text-xs text-muted-foreground">
                  주 이용 지점: {team.homeBranchName ?? "정해지지 않았어요"}
                </p>
                {team.isMember ? (
                  <p className="text-sm text-muted-foreground">
                    이미 팀원이에요
                  </p>
                ) : team.hasInvite ? (
                  <p className="text-sm text-muted-foreground">
                    받은 초대가 있어요
                  </p>
                ) : (
                  <JoinRequestForm teamId={team.id} teamName={team.name} />
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-border pt-4">
          <h3 className="text-base font-semibold">내가 보낸 가입 요청</h3>
          {data.requests.length === 0 ? (
            <EmptyTeamList>대기 중인 가입 요청이 없어요</EmptyTeamList>
          ) : (
            <ul className="divide-y divide-border">
              {data.requests.map((request) => (
                <li key={request.id} className="space-y-2 py-4">
                  <p className="font-medium">{request.teamName}</p>
                  {request.message && (
                    <p className="text-sm break-words whitespace-pre-wrap">
                      {request.message}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    보낸 날: <TeamDate value={request.createdAt} />
                  </p>
                  <CancelJoinRequest requestId={request.id} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </TeamSection>
    </PageContainer>
  );
}

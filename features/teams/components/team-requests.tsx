import { UserAvatar } from "@/components/user-avatar";
import { StatusBadge } from "@/components/status-badge";
import type { TeamPageData } from "../types";
import { ReviewJoinRequest, RevokeInvite } from "./request-controls";
import { TeamDate, TeamSection } from "./team-display";

export function TeamRequests({
  data,
}: {
  data: Extract<TeamPageData, { role: "admin" }>;
}) {
  return (
    <div className="space-y-6">
      <TeamSection title={`받은 가입 요청 ${data.joinRequests.length}건`}>
        {data.joinRequests.length ? (
          <ul className="divide-y divide-border">
            {data.joinRequests.map((request) => (
              <li
                key={request.id}
                className="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-0 last:pb-0 [&:has([data-team-pending=true])]:opacity-50"
              >
                <div className="space-y-2">
                  <p className="flex items-center gap-2 font-medium">
                    <UserAvatar
                      name={request.name}
                      avatar={request.avatar}
                      size={32}
                    />
                    {request.name}
                  </p>
                  <p className="text-sm break-all text-muted-foreground">
                    {request.email}
                  </p>
                  {request.message && (
                    <p className="text-sm break-words whitespace-pre-wrap">
                      {request.message}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    보낸 날: <TeamDate value={request.createdAt} />
                  </p>
                </div>
                <ReviewJoinRequest requestId={request.id} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            대기 중인 가입 요청이 없어요
          </p>
        )}
      </TeamSection>
      <TeamSection title="보낸 초대">
        {data.sentInvites.length ? (
          <ul className="divide-y divide-border">
            {data.sentInvites.map((invite) => (
              <li
                key={invite.id}
                className="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-0 last:pb-0 [&:has([data-team-pending=true])]:opacity-50"
              >
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="break-all">
                      {invite.email ?? "이메일 정보가 없어요"}
                    </p>
                    <StatusBadge status="pending" />
                  </div>
                  {invite.message && (
                    <p className="text-sm break-words whitespace-pre-wrap">
                      {invite.message}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    만료일: <TeamDate value={invite.expiresAt} />
                  </p>
                </div>
                <RevokeInvite inviteId={invite.id} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            대기 중인 초대가 없어요
          </p>
        )}
      </TeamSection>
      <TeamSection title="담당자 연락처">
        <p className="tabular-nums">
          {data.contactPhone || "등록된 연락처가 없어요"}
        </p>
        <p className="text-xs text-muted-foreground">팀 관리자에게만 보여요.</p>
      </TeamSection>
    </div>
  );
}

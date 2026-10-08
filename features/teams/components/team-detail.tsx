import Link from "next/link";
import { UserAvatar } from "@/components/user-avatar";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { PageContainer, PageHeading } from "@/components/page-container";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TeamPageData } from "@/features/teams/types";
import { ReviewJoinRequest, RevokeInvite } from "./request-controls";
import { TeamInviteDialog } from "./team-invite-dialog";
import {
  EmptyTeamList,
  roleLabel,
  TeamDate,
  TeamSection,
  teamLinkClassName,
} from "./team-display";

export function TeamDetail({ data }: { data: TeamPageData }) {
  return (
    <PageContainer as="main" className="space-y-6">
      <Link href="/teams" className={teamLinkClassName}>
        ‹ 팀
      </Link>
      <PageHeading
        title={data.name}
        description={
          <>
            <span className="tabular-nums">팀원 {data.memberCount}명</span> · 내
            역할: {roleLabel(data.role)}
          </>
        }
        action={
          data.role === "admin" ? (
            <TeamInviteDialog
              teamId={data.id}
              canSendEmail={data.canSendEmail}
            />
          ) : undefined
        }
      />
      {data.role === "admin" &&
        (data.joinRequests.length ? (
          <TeamSection title={`받은 가입 요청 ${data.joinRequests.length}건`}>
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
          </TeamSection>
        ) : (
          <p className="text-sm text-muted-foreground">
            대기 중인 가입 요청이 없어요
          </p>
        ))}
      <TeamSection title="팀원 목록">
        {data.members.length === 0 ? (
          <EmptyTeamList>팀원이 없어요</EmptyTeamList>
        ) : (
          <Table>
            <TableCaption className="sr-only">
              {data.name} 팀원 목록
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>이름</TableHead>
                <TableHead>이메일</TableHead>
                <TableHead>직함</TableHead>
                <TableHead>역할</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <UserAvatar
                        name={member.name}
                        avatar={member.avatar}
                        size={36}
                      />
                      {member.name}
                    </div>
                  </TableCell>
                  <TableCell>{member.email}</TableCell>
                  <TableCell>{member.title || "—"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{roleLabel(member.role)}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TeamSection>
      {data.role === "admin" && (
        <>
          {data.sentInvites.length ? (
            <TeamSection title="보낸 초대">
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
            </TeamSection>
          ) : (
            <p className="text-sm text-muted-foreground">
              대기 중인 초대가 없어요
            </p>
          )}
          <TeamSection title="담당자 연락처">
            <p className="tabular-nums">
              {data.contactPhone || "등록된 연락처가 없어요"}
            </p>
            <p className="text-xs text-muted-foreground">
              팀 관리자에게만 보여요.
            </p>
          </TeamSection>
        </>
      )}
    </PageContainer>
  );
}

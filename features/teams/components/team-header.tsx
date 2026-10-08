"use client";

import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { spaceColorClasses } from "@/features/chat/components/space-colors";
import type { TeamPageData } from "../types";
import { TeamInviteDialog } from "./team-invite-dialog";
import { roleLabel, teamLinkClassName } from "./team-display";

export type TeamHeaderData = Pick<
  TeamPageData,
  "id" | "name" | "role" | "memberCount" | "homeBranchName" | "space"
> & { canSendEmail?: boolean };

export function TeamHeader({ data }: { data: TeamHeaderData }) {
  return (
    <header className="space-y-5" data-team-header>
      <Link href="/teams" className={teamLinkClassName}>
        ‹ 팀 관리
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden="true"
            className={`flex size-14 shrink-0 items-center justify-center rounded-2xl text-2xl font-bold text-primary-foreground ${spaceColorClasses[data.space?.iconColor ?? "blue"]}`}
          >
            {data.space?.initial ?? Array.from(data.name)[0]}
          </span>
          <div className="min-w-0 space-y-1">
            <h1 className="text-[26px] font-bold tracking-[-0.025em] break-words">
              {data.name}
            </h1>
            <p className="text-sm text-muted-foreground">
              {data.homeBranchName && `${data.homeBranchName} · `}
              <span className="tabular-nums">팀원 {data.memberCount}명</span> ·
              나는 {roleLabel(data.role)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.space && (
            <Button variant="outline" asChild>
              <Link href={`/s/${data.space.id}`}>
                <MessageSquare aria-hidden="true" />팀 스페이스
              </Link>
            </Button>
          )}
          {data.role === "admin" && (
            <TeamInviteDialog
              teamId={data.id}
              canSendEmail={data.canSendEmail ?? false}
            />
          )}
        </div>
      </div>
    </header>
  );
}

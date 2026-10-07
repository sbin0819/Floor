"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import type { TeamSearchResult, TeamStartData } from "@/features/teams/types";
import { JoinRequestForm } from "./request-controls";
import { teamLinkClassName } from "./team-display";

function TeamSearchRow({ team }: { team: TeamSearchResult }) {
  const [expanded, setExpanded] = useState(false);
  const [sentFor, setSentFor] = useState<TeamSearchResult | null>(null);
  // 액션 성공은 바로 표시하되, 다음 서버 응답의 상태를 덮어쓰지 않는다.
  const sent = sentFor === team;
  const id = useId();
  return (
    <li className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">{team.name}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            주 이용 지점 {team.homeBranchName ?? "정해지지 않았어요"}
          </p>
        </div>
        {team.isMember ? (
          <p className="text-muted-foreground">이미 팀원이에요</p>
        ) : team.hasInvite ? (
          <div>
            <p>받은 초대가 있어요</p>
            <Link className={teamLinkClassName} href="/teams">
              초대 보기
            </Link>
          </div>
        ) : team.hasRequest || sent ? (
          <div>
            <p>요청을 보냈어요</p>
            <Link className={teamLinkClassName} href="/teams">
              보낸 요청 보기
            </Link>
          </div>
        ) : (
          <Button
            variant="outline"
            aria-expanded={expanded}
            aria-controls={id}
            onClick={() => setExpanded(!expanded)}
          >
            가입 요청
          </Button>
        )}
      </div>
      {expanded &&
        !sent &&
        !team.isMember &&
        !team.hasInvite &&
        !team.hasRequest && (
          <div id={id}>
            <JoinRequestForm
              teamId={team.id}
              teamName={team.name}
              submitLabel="요청 보내기"
              onSuccess={() => {
                setExpanded(false);
                setSentFor(team);
              }}
              onCancel={() => setExpanded(false)}
            />
          </div>
        )}
    </li>
  );
}

export function TeamSearchResults({
  search,
}: {
  search: TeamStartData["search"];
}) {
  if (search.error)
    return (
      <p role="status" className="text-muted-foreground">
        {search.error}
      </p>
    );
  if (!search.query)
    return (
      <p className="text-muted-foreground">
        가입하고 싶은 팀 이름을 검색해 주세요
      </p>
    );
  return (
    <section aria-label="검색 결과" className="space-y-4">
      <h2 className="font-semibold">
        검색 결과{" "}
        <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
          {search.results.length}개
        </span>
      </h2>
      {search.results.length ? (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {search.results.map((team) => (
            <TeamSearchRow key={team.id} team={team} />
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">
          검색한 팀이 없어요. 다른 이름으로 찾아보세요
        </p>
      )}
    </section>
  );
}

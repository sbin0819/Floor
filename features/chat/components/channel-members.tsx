import type { ChannelView } from "../types";
import { PersonCard } from "@/features/people/components/person-card";

export function ChannelMembers({
  members,
}: {
  members: ChannelView["members"];
}) {
  return (
    <ul aria-label="팀원 목록" className="space-y-3 p-4">
      {members.map((member) => (
        <li key={member.id} className="flex min-h-11 items-center gap-3">
          <PersonCard userId={member.id} name={member.name}>
            <button
              type="button"
              aria-label={`${member.name} 프로필`}
              className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted font-medium"
              >
                {Array.from(member.name)[0]}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {member.name}
              </span>
            </button>
          </PersonCard>
          {member.admin && (
            <span className="rounded-sm border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
              관리자
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

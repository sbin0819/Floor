"use client";

import { usePresenceStatuses } from "@/components/realtime-provider";
import { StatusDot } from "@/features/people/components/person-status";
import { presenceSortGroup } from "@/features/people/status";
import { PersonCard } from "@/features/people/components/person-card";

export function ChannelMembers({
  members,
}: {
  members: {
    id: string;
    name: string;
    admin: boolean;
    sharesSpace?: boolean;
  }[];
}) {
  const statuses = usePresenceStatuses(
    members.map((member) => ({
      userId: member.id,
      sharesSpace: member.sharesSpace ?? true,
    })),
  );
  const sorted = [...members].sort(
    (a, b) =>
      presenceSortGroup(statuses[a.id] ?? "unknown") -
        presenceSortGroup(statuses[b.id] ?? "unknown") ||
      a.name.localeCompare(b.name, "ko"),
  );
  return (
    <ul aria-label="팀원 목록" className="space-y-3 p-4">
      {sorted.map((member) => (
        <li key={member.id} className="flex min-h-11 items-center gap-3">
          <PersonCard userId={member.id} name={member.name}>
            <button
              type="button"
              aria-label={`${member.name} 프로필`}
              className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-muted font-medium">
                <span aria-hidden="true">{Array.from(member.name)[0]}</span>
                <span className="absolute right-0 bottom-0">
                  <StatusDot status={statuses[member.id] ?? "unknown"} />
                </span>
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

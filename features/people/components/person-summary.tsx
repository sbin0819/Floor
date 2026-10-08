import type { FriendRow } from "../types";
import { UserAvatar } from "@/components/user-avatar";

export function PersonSummary({
  person,
}: {
  person: Pick<FriendRow, "name" | "avatar" | "username" | "sharedTeamNames">;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <UserAvatar name={person.name} avatar={person.avatar} size={40} />
      <div className="min-w-0">
        <p className="truncate font-semibold">{person.name}</p>
        <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
          {person.username && <span>@{person.username}</span>}
          {person.sharedTeamNames.length > 0 && (
            <span>{person.sharedTeamNames.join(" · ")}</span>
          )}
        </div>
      </div>
    </div>
  );
}

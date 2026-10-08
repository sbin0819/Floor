import type { FriendRow } from "../types";

export function PersonSummary({
  person,
}: {
  person: Pick<FriendRow, "name" | "username" | "sharedTeamNames">;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted font-semibold"
      >
        {Array.from(person.name.trim())[0] ?? "?"}
      </span>
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

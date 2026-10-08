import type { TeamRole } from "./types";
import { z } from "zod";

export type TeamTab = "members" | "requests" | "bookings" | "settings";
export type TeamSearch = Record<string, string | string[] | undefined>;

export function teamBookingQuery(query: TeamSearch) {
  const branch = z.uuid().safeParse(query.branch);
  return {
    view:
      query.view === "past" || query.view === "cancelled"
        ? query.view
        : "upcoming",
    ...(branch.success ? { branchId: branch.data.toLowerCase() } : {}),
  };
}

export function selectedTeamTab(value: unknown, role: TeamRole): TeamTab {
  if (value === "bookings") return value;
  if (role === "admin" && (value === "requests" || value === "settings"))
    return value;
  return "members";
}

export function teamHref(
  teamId: string,
  values: Record<string, string | null | undefined>,
) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value) query.set(key, value);
  return `/teams/${encodeURIComponent(teamId)}${query.size ? `?${query}` : ""}`;
}

export function teamDialogHref(
  teamId: string,
  memberId: string,
  leaving: boolean,
) {
  return teamHref(teamId, {
    tab: "members",
    dialog: leaving ? "leave" : "remove",
    member: memberId,
  });
}

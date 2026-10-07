export type TeamStartMode = "choose" | "create" | "join";

export function normalizeTeamStartMode(value: unknown): TeamStartMode {
  return value === "create" || value === "join" ? value : "choose";
}

export function teamStartHref(mode: TeamStartMode, query?: string) {
  const params = new URLSearchParams();
  if (mode !== "choose") params.set("mode", mode);
  if (query) params.set("q", query);
  return `/teams/start${params.size ? `?${params}` : ""}`;
}

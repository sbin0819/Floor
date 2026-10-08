import { createTeamQueries } from "@/features/teams/query-factory";
import type { TeamStartMode } from "./start-mode";

export async function getHomeTeams() {
  return createTeamQueries().getHomeTeams();
}
export async function getTeamsData() {
  return createTeamQueries().getTeamsData();
}

export async function getHomeData() {
  return createTeamQueries().getHomeData();
}
export async function getTeamStartData(query?: unknown, mode?: TeamStartMode) {
  return createTeamQueries().getTeamStartData(query, mode);
}
export async function getTeamPageData(teamId: string) {
  return createTeamQueries().getTeamPageData(teamId);
}
export async function getInvitePageData(token: string) {
  return createTeamQueries().getInvitePageData(token);
}

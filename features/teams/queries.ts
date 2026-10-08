import { cache } from "react";
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
export const getTeamPageData = cache(async (teamId: string) => {
  return createTeamQueries().getTeamPageData(teamId);
});
export async function getInvitePageData(token: string) {
  return createTeamQueries().getInvitePageData(token);
}
export async function getTeamBookings(teamId: string, query?: unknown) {
  return createTeamQueries().getTeamBookings(teamId, query);
}
export async function getTeamRemovalPreview(teamId: string, userId: string) {
  return createTeamQueries().getTeamRemovalPreview(teamId, userId);
}
export async function getTeamDeletePreview(teamId: string) {
  return createTeamQueries().getTeamDeletePreview(teamId);
}

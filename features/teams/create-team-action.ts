"use server";

import { createTeamActions } from "@/features/teams/create-team-factory";

export async function createTeam(input: unknown) {
  return createTeamActions().createTeam(input);
}

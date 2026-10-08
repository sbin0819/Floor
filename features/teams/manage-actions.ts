"use server";

import { createTeamInfoActions } from "./manage-info-factory";

export async function updateTeam(input: unknown) {
  return createTeamInfoActions().updateTeam(input);
}
export async function setMemberRole(input: unknown) {
  return createTeamInfoActions().setMemberRole(input);
}
export async function setMemberTitle(input: unknown) {
  return createTeamInfoActions().setMemberTitle(input);
}

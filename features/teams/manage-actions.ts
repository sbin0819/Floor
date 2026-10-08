"use server";

import { createTeamInfoActions } from "./manage-info-factory";
import { createTeamMemberActions } from "./manage-members-factory";

export async function updateTeam(input: unknown) {
  return createTeamInfoActions().updateTeam(input);
}
export async function setMemberRole(input: unknown) {
  return createTeamInfoActions().setMemberRole(input);
}
export async function setMemberTitle(input: unknown) {
  return createTeamInfoActions().setMemberTitle(input);
}
export async function removeMember(input: unknown) {
  return createTeamMemberActions().removeMember(input);
}
export async function leaveTeam(input: unknown) {
  return createTeamMemberActions().leaveTeam(input);
}

"use server";

import { createInviteManagementActions } from "@/features/teams/invite-management-factory";

export async function sendTeamInvite(input: unknown) {
  return createInviteManagementActions().sendTeamInvite(input);
}
export async function revokeTeamInvite(input: unknown) {
  return createInviteManagementActions().revokeTeamInvite(input);
}

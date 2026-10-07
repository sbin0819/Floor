"use server";

import { createInviteResponseActions } from "@/features/teams/invite-response-factory";

export async function acceptTeamInvite(input: unknown) {
  return createInviteResponseActions().acceptTeamInvite(input);
}
export async function declineTeamInvite(input: unknown) {
  return createInviteResponseActions().declineTeamInvite(input);
}

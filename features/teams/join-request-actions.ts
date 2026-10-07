"use server";

import { createJoinRequestActions } from "@/features/teams/join-request-factory";

export async function requestTeamJoin(input: unknown) {
  return createJoinRequestActions().requestTeamJoin(input);
}
export async function cancelTeamJoinRequest(input: unknown) {
  return createJoinRequestActions().cancelTeamJoinRequest(input);
}
export async function approveTeamJoinRequest(input: unknown) {
  return createJoinRequestActions().approveTeamJoinRequest(input);
}
export async function rejectTeamJoinRequest(input: unknown) {
  return createJoinRequestActions().rejectTeamJoinRequest(input);
}

"use server";

import { createSpaceActions } from "./space-action-factory";
import { createChannelActions } from "./channel-actions";
import { createSpaceInviteActions } from "./space-invite-actions";

export async function joinLounge(input: unknown) {
  return createSpaceActions().joinLounge(input);
}
export async function createCommunitySpace(input: unknown) {
  return createSpaceActions().createCommunitySpace(input);
}
export async function leaveSpace(input: unknown) {
  return createSpaceActions().leaveSpace(input);
}
export async function updateSpace(input: unknown) {
  return createSpaceActions().updateSpace(input);
}
export async function setSpaceAdmin(input: unknown) {
  return createSpaceActions().setSpaceAdmin(input);
}
export async function transferSpaceOwnership(input: unknown) {
  return createSpaceActions().transferSpaceOwnership(input);
}
export async function deleteSpace(input: unknown) {
  return createSpaceActions().deleteSpace(input);
}

export async function createChannel(input: unknown) {
  return createChannelActions().createChannel(input);
}
export async function updateChannel(input: unknown) {
  return createChannelActions().updateChannel(input);
}
export async function archiveChannel(input: unknown) {
  return createChannelActions().archiveChannel(input);
}
export async function banSpaceMember(input: unknown) {
  return createChannelActions().banSpaceMember(input);
}
export async function unbanSpaceMember(input: unknown) {
  return createChannelActions().unbanSpaceMember(input);
}

export async function createInviteLink(input: unknown) {
  return createSpaceInviteActions().createInviteLink(input);
}
export async function revokeInvite(input: unknown) {
  return createSpaceInviteActions().revokeInvite(input);
}
export async function inviteToSpace(input: unknown) {
  return createSpaceInviteActions().inviteToSpace(input);
}
export async function joinSpaceByInvite(input: unknown) {
  return createSpaceInviteActions().joinSpaceByInvite(input);
}

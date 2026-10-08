"use server";

import { createUsernameAction } from "./username";
import { createFriendActions } from "./friend-actions";
import { createModerationActions } from "./moderation-actions";
import { createStatusAction } from "./status-action";

export async function setStatus(input: unknown) {
  return createStatusAction()(input);
}

export async function setUsername(input: unknown) {
  return createUsernameAction()(input);
}
export async function sendFriendRequest(input: unknown) {
  return createFriendActions().sendFriendRequest(input);
}
export async function respondFriendRequest(input: unknown) {
  return createFriendActions().respondFriendRequest(input);
}
export async function cancelFriendRequest(input: unknown) {
  return createFriendActions().cancelFriendRequest(input);
}
export async function removeFriend(input: unknown) {
  return createFriendActions().removeFriend(input);
}
export async function blockUser(input: unknown) {
  return createModerationActions().blockUser(input);
}
export async function unblockUser(input: unknown) {
  return createModerationActions().unblockUser(input);
}
export async function reportUser(input: unknown) {
  return createModerationActions().reportUser(input);
}
export async function reportMessage(input: unknown) {
  return createModerationActions().reportMessage(input);
}

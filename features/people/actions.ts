"use server";

import { createUsernameAction } from "./username";
import { createFriendActions } from "./friend-actions";

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

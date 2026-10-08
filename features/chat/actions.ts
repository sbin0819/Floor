"use server";

import { createChatActions } from "./action-factory";

export async function sendMessage(input: unknown) {
  return createChatActions().sendMessage(input);
}

export async function markRoomRead(input: unknown) {
  return createChatActions().markRoomRead(input);
}

export async function editMessage(input: unknown) {
  return createChatActions().editMessage(input);
}

export async function deleteMessage(input: unknown) {
  return createChatActions().deleteMessage(input);
}

export async function setReaction(input: unknown) {
  return createChatActions().setReaction(input);
}

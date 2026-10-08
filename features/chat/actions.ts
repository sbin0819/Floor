"use server";

import { createChatActions } from "./action-factory";

export async function sendMessage(input: unknown) {
  return createChatActions().sendMessage(input);
}

export async function markRoomRead(input: unknown) {
  return createChatActions().markRoomRead(input);
}

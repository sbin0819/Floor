"use server";

import { createChatActions } from "./action-factory";

export async function sendMessage(input: unknown) {
  return createChatActions().sendMessage(input);
}

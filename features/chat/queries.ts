import { cache } from "react";
import { createChatQueries } from "./query-factory";

export const getMyChatNav = cache(async () =>
  createChatQueries().getMyChatNav(),
);
export async function getChannelView(spaceId: string, roomId: string) {
  return createChatQueries().getChannelView(spaceId, roomId);
}

export async function getRoomMessagesPage(roomId: string, query: unknown) {
  return createChatQueries().getRoomMessagesPage(roomId, query);
}

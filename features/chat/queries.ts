import { cache } from "react";
import { createChatQueries } from "./query-factory";
import { createFileQueries } from "./file-query-factory";

export const getMyChatNav = cache(async () =>
  createChatQueries().getMyChatNav(),
);
export async function getChannelView(spaceId: string, roomId: string) {
  return createChatQueries().getChannelView(spaceId, roomId);
}

export async function getRoomMessagesPage(roomId: string, query: unknown) {
  return createChatQueries().getRoomMessagesPage(roomId, query);
}
export async function getDirectMessageView(roomId: string) {
  return createChatQueries().getDirectMessageView(roomId);
}
export async function getMeetingView(bookingId: string) {
  return createChatQueries().getMeetingView(bookingId);
}

export async function getRoomFiles(roomId: string, query: unknown) {
  return createFileQueries().getRoomFiles(roomId, query);
}

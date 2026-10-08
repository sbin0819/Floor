import type { ChatAttachment } from "./types";

export type RoomFilesKind = "all" | "image" | "file";
export type RoomFile = ChatAttachment & {
  uploaderName: string;
  sentAt: string;
  messageId: string;
  seq: number;
};
export type RoomFilesPage = {
  files: RoomFile[];
  hasMore: boolean;
  nextCursor: string | null;
};

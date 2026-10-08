import type { ChannelView } from "./types";

export type RoomMessageSource = Pick<
  ChannelView,
  | "user"
  | "members"
  | "messages"
  | "lastReadSeq"
  | "firstUnreadSeq"
  | "canWrite"
  | "now"
> & {
  room: Pick<
    ChannelView["room"],
    "id" | "archived" | "lastSeq" | "muted" | "unreadMentions"
  >;
};

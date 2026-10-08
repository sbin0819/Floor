export const reactionEmojis = [
  "thumbs_up",
  "heart",
  "joy",
  "tada",
  "open_mouth",
  "cry",
  "pray",
  "check",
] as const;
export type ReactionEmoji = (typeof reactionEmojis)[number];
export type ChatMention = { userId: string; name: string };
export type ChatReply = {
  id: string;
  authorName: string | null;
  excerpt: string;
  deleted: boolean;
};
export type ChatReaction = {
  emoji: ReactionEmoji;
  count: number;
  mine: boolean;
  names: string[];
};
export type ChatMessageDetails = {
  systemData: SystemMessageData | null;
  replyTo: ChatReply | null;
  mentions: ChatMention[];
  mentionsEveryone: boolean;
  editedAt: string | null;
  deletedAt: string | null;
  reactions: ChatReaction[];
};

export const emptyMessageDetails = (): ChatMessageDetails => ({
  systemData: null,
  replyTo: null,
  mentions: [],
  mentionsEveryone: false,
  editedAt: null,
  deletedAt: null,
  reactions: [],
});

export type ChatMessage = ChatMessageDetails & {
  id: string;
  seq: number;
  authorId: string | null;
  authorName: string | null;
  kind: "text" | "system";
  body: string;
  createdAt: string;
  clientId: string | null;
};

export type RoomMessagesPage = {
  messages: ChatMessage[];
  hasMore: boolean;
  lastSeq: number;
  lastReadSeq: number | null;
  firstUnreadSeq: number | null;
  peerReadSeq: number | null;
};

export type ChatRoomKind = "text" | "voice" | "dm" | "group_dm" | "meeting";
export type DirectMessageNav = {
  roomId: string;
  other: { userId: string; name: string; username: string | null };
  lastSeq: number;
  lastMessageAt: string;
  unread: boolean;
  unreadCount: number;
  unreadMentions: number;
  muted: boolean;
};
export type ChatNav = {
  spaces: ChatSpaceNav[];
  directMessages: DirectMessageNav[];
};
export type DirectMessageView = {
  request: { role: "recipient" } | { role: "sender"; sentCount: number } | null;
  room: {
    id: string;
    archived: boolean;
    lastSeq: number;
    muted: boolean;
    unreadMentions: number;
  };
  other: { userId: string; name: string; username: string | null };
  user: { id: string; name: string };
  members: { id: string; name: string; admin: boolean }[];
  messages: ChatMessage[];
  lastReadSeq: number | null;
  firstUnreadSeq: number | null;
  peerReadSeq: number;
  canWrite: boolean;
  now: string;
};

export type ChatSpaceNav = {
  id: string;
  kind: "team";
  name: string;
  initial: string;
  unread: boolean;
  muted: boolean;
  unreadMentions: number;
  channels: {
    id: string;
    name: string;
    unread: boolean;
    muted: boolean;
    unreadMentions: number;
  }[];
};

export type ChannelView = {
  space: { id: string; name: string; muted: boolean };
  room: {
    id: string;
    name: string;
    topic: string | null;
    archived: boolean;
    adminOnly: boolean;
    lastSeq: number;
    muted: boolean;
    unreadMentions: number;
  };
  user: { id: string; name: string };
  members: { id: string; name: string; admin: boolean }[];
  messages: ChatMessage[];
  lastReadSeq: number | null;
  firstUnreadSeq: number | null;
  canWrite: boolean;
  now: string;
};
import type { SystemMessageData } from "./system-messages";

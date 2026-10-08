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
  replyTo: ChatReply | null;
  mentions: ChatMention[];
  mentionsEveryone: boolean;
  editedAt: string | null;
  deletedAt: string | null;
  reactions: ChatReaction[];
};

export const emptyMessageDetails = (): ChatMessageDetails => ({
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
};

export type ChatSpaceNav = {
  id: string;
  kind: "team";
  name: string;
  initial: string;
  unread: boolean;
  channels: { id: string; name: string; unread: boolean }[];
};

export type ChannelView = {
  space: { id: string; name: string };
  room: {
    id: string;
    name: string;
    topic: string | null;
    archived: boolean;
    adminOnly: boolean;
    lastSeq: number;
  };
  user: { id: string; name: string };
  members: { id: string; name: string; admin: boolean }[];
  messages: ChatMessage[];
  lastReadSeq: number | null;
  firstUnreadSeq: number | null;
  canWrite: boolean;
  now: string;
};

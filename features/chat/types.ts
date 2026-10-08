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
export type ChatAttachment = {
  id: string;
  name: string;
  size: number;
  kind: "image" | "file";
  width: number | null;
  height: number | null;
};
export type AttachmentSummary = {
  images: number;
  files: number;
  firstName: string;
};
export type ChatReply = {
  id: string;
  authorName: string | null;
  excerpt: string;
  deleted: boolean;
  attachmentSummary: AttachmentSummary | null;
};
export type ChatReaction = {
  emoji: ReactionEmoji;
  count: number;
  mine: boolean;
  names: string[];
};
export type ChatMessageDetails = {
  attachments: ChatAttachment[];
  systemData: SystemMessageData | null;
  replyTo: ChatReply | null;
  mentions: ChatMention[];
  mentionsEveryone: boolean;
  editedAt: string | null;
  deletedAt: string | null;
  reactions: ChatReaction[];
};

export const emptyMessageDetails = (): ChatMessageDetails => ({
  attachments: [],
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
type DirectMessageNavBase = {
  roomId: string;
  lastSeq: number;
  lastMessageAt: string;
  unread: boolean;
  unreadCount: number;
  unreadMentions: number;
  muted: boolean;
};
export type DirectMessageNav = DirectMessageNavBase &
  (
    | {
        kind: "dm";
        other: { userId: string; name: string; username: string | null };
      }
    | {
        kind: "group_dm";
        name: string | null;
        memberCount: number;
        members: { userId: string; name: string }[];
      }
  );
export type ChatNav = {
  filesEnabled: boolean;
  callsEnabled: boolean;
  calls: { roomId: string; participantCount: number }[];
  myCall: import("@/features/calls/types").MyCall | null;
  myStatus: "online" | "away" | "dnd";
  blockedUserIds: string[];
  spaces: ChatSpaceNav[];
  directMessages: DirectMessageNav[];
  meetings: MeetingNav[];
  now: string;
};
export type MeetingNav = {
  bookingId: string;
  roomId: string;
  title: string | null;
  spaceName: string;
  start: string;
  end: string;
  timezone: string;
  phase: "upcoming" | "ongoing" | "ended";
  unread: boolean;
  unreadMentions: number;
  muted: boolean;
};
export type MeetingView = {
  canCallAtStart: boolean;
  call: import("@/features/calls/types").CallView | null;
  canCall: boolean;
  room: {
    id: string;
    lastSeq: number;
    muted: boolean;
    unreadMentions: number;
  };
  booking: {
    id: string;
    title: string | null;
    spaceName: string;
    floorName: string;
    branchName: string;
    timezone: string;
    start: string;
    end: string;
    status: "confirmed" | "cancelled";
    attendeeCount: number | null;
  };
  user: { id: string; name: string };
  members: {
    userId: string;
    name: string;
    username: string | null;
    isBooker: boolean;
    sharesSpace: boolean;
  }[];
  messages: ChatMessage[];
  lastReadSeq: number | null;
  firstUnreadSeq: number | null;
  canWrite: boolean;
  readOnlyReason: "cancelled" | "ended" | null;
  isBooker: boolean;
  canEditBooking: boolean;
  now: string;
};
type DirectMessageViewBase = {
  call: import("@/features/calls/types").CallView | null;
  canCall: boolean;
  room: {
    id: string;
    archived: boolean;
    lastSeq: number;
    muted: boolean;
    unreadMentions: number;
  };
  user: { id: string; name: string };
  messages: ChatMessage[];
  lastReadSeq: number | null;
  firstUnreadSeq: number | null;
  canWrite: boolean;
  now: string;
};
export type DirectMessageView = DirectMessageViewBase &
  (
    | {
        kind: "dm";
        request:
          { role: "recipient" } | { role: "sender"; sentCount: number } | null;
        blockedByMe: boolean;
        other: {
          userId: string;
          name: string;
          username: string | null;
          sharesSpace: boolean;
        };
        members: { id: string; name: string; admin: boolean }[];
        peerReadSeq: number;
      }
    | {
        kind: "group_dm";
        name: string | null;
        displayName: string;
        members: {
          userId: string;
          name: string;
          username: string | null;
          sharesSpace: boolean;
        }[];
      }
  );

export type ChatSpaceNav = {
  voiceChannels: {
    id: string;
    name: string;
    capacity: number;
    participantCount: number;
    participants: import("@/features/calls/types").CallPerson[];
  }[];
  id: string;
  kind: "team" | "branch" | "community";
  iconColor: import("./space-schema").SpaceIconColor;
  role: "member" | "admin" | "owner";
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
  call: import("@/features/calls/types").CallView | null;
  canCall: boolean;
  space: { id: string; name: string; muted: boolean };
  room: {
    id: string;
    kind: "text" | "voice";
    name: string;
    topic: string | null;
    archived: boolean;
    adminOnly: boolean;
    lastSeq: number;
    muted: boolean;
    unreadMentions: number;
  };
  user: { id: string; name: string };
  members: {
    id: string;
    name: string;
    admin: boolean;
    sharesSpace?: boolean;
  }[];
  messages: ChatMessage[];
  lastReadSeq: number | null;
  firstUnreadSeq: number | null;
  canWrite: boolean;
  now: string;
};
import type { SystemMessageData } from "./system-messages";

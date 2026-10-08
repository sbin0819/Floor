import type { Avatar } from "@/lib/avatar";

export type UsernameSettings = {
  username: string | null;
  usernameChangedAt: string | null;
  nextChangeAt: string | null;
  now: string;
  suggestion: string | null;
};

export type PersonRelation =
  "friend" | "outgoing" | "incoming" | "none" | "blocked";
export type FriendsTab = "all" | "received" | "sent" | "blocked" | "requests";
export type FriendRow = {
  userId: string;
  name: string;
  avatar: Avatar;
  username: string | null;
  sharedTeamNames: string[];
  directRoomId: string | null;
};
export type FriendsView = {
  settings: UsernameSettings;
  receivedCount: number;
  messageRequestCount: number;
  rows: FriendRow[];
};
export type PersonSearchResult = FriendRow & {
  relation: PersonRelation;
  canDirectMessage: boolean;
};
export type PersonProfile = {
  userId: string;
  name: string;
  avatar: Avatar;
  username: string | null;
  isMe: boolean;
  relation: PersonRelation | null;
  sharedSpaces: { id: string; name: string }[];
  directRoomId: string | null;
  canDirectMessage: boolean;
};
export type MessageContact = FriendRow & { isFriend: boolean };

export type MessageRequestRow = {
  roomId: string;
  other: {
    userId: string;
    name: string;
    avatar: Avatar;
    username: string | null;
  };
  excerpt: string;
  lastMessageAt: string;
};

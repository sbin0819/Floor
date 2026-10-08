import type { Avatar } from "@/lib/avatar";

export type HomeTodo = {
  joinRequests: {
    top: { teamId: string; teamName: string; count: number } | null;
    rest: number;
  };
  teamInvites: number;
  friendRequests: number;
  messageRequests: number;
  spaceInvites: { count: number; href: string | null };
};

export type HomeChecklist = {
  visible: boolean;
  isOperator: boolean;
  dismissedAt: string | null;
  steps: {
    emailVerified: true;
    username: boolean;
    team: boolean;
    booking: boolean;
    friend: boolean;
  };
};

export type HomeRecentChat = {
  roomId: string;
  kind: "dm" | "group_dm" | "mention";
  href: string;
  title: string;
  subtitle: string;
  avatar: { person: Avatar & { name: string } } | { group: true };
  excerpt: string;
  at: string;
  unreadCount: number;
  mention: boolean;
};

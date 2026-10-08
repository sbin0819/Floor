import type {
  HomeChecklist,
  HomeRecentChat,
  HomeTodo,
} from "@/features/home/types";

export const homeTodo: HomeTodo = {
  joinRequests: { top: null, rest: 0 },
  teamInvites: 0,
  friendRequests: 0,
  messageRequests: 0,
  spaceInvites: { count: 0, href: null },
};
export const homeChecklist: HomeChecklist = {
  visible: true,
  dismissedAt: null,
  isOperator: false,
  steps: {
    emailVerified: true,
    username: false,
    team: false,
    booking: false,
    friend: false,
  },
};
export const homeChats: HomeRecentChat[] = [
  {
    roomId: "dm",
    kind: "dm",
    href: "/dm/dm",
    title: "이서연",
    subtitle: "DM",
    avatar: { person: { name: "이서연", color: "purple", photoUrl: null } },
    excerpt: "내일 회의에서 이야기해요",
    at: "2026-10-09T03:00:00Z",
    unreadCount: 2,
    mention: false,
  },
  {
    roomId: "group",
    kind: "group_dm",
    href: "/dm/group",
    title: "점심 메뉴",
    subtitle: "그룹 · 3명",
    avatar: { group: true },
    excerpt: "김하은: 오늘은 어디서 먹을까요?",
    at: "2026-10-09T02:00:00Z",
    unreadCount: 0,
    mention: false,
  },
  {
    roomId: "channel",
    kind: "mention",
    href: "/s/space/channel?message=message",
    title: "박지훈",
    subtitle: "# 일반 · 디자인 스튜디오",
    avatar: { person: { name: "박지훈", color: "green", photoUrl: null } },
    excerpt: "@이서연 가상 프로젝트 시안을 올렸어요",
    at: "2026-10-09T01:00:00Z",
    unreadCount: 0,
    mention: true,
  },
];

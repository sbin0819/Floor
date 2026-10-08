import type { ChatNav } from "@/features/chat/types";
import type { MessageContact } from "@/features/people/types";
export const id = (n: number) =>
  `76000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const nav: ChatNav = {
  chatToasts: true,
  tabBadge: true,
  filesEnabled: false,
  callsEnabled: false,
  calls: [],
  myCall: null,
  myStatus: "online",
  blockedUserIds: [],
  now: "2026-10-09T03:00:00.000Z",
  spaces: [
    {
      voiceChannels: [],
      id: id(1),
      kind: "community",
      role: "member",
      iconColor: "blue",
      name: "한글 모임",
      initial: "한",
      unread: true,
      unreadMentions: 0,
      muted: false,
      channels: [
        {
          id: id(2),
          name: "일반",
          unread: true,
          muted: false,
          unreadMentions: 0,
        },
        {
          id: id(3),
          name: "공지",
          unread: false,
          muted: false,
          unreadMentions: 0,
        },
      ],
    },
  ],
  directMessages: [
    {
      roomId: id(4),
      kind: "dm",
      other: {
        avatar: { color: "blue" as const, photoUrl: null },
        userId: id(20),
        name: "김하은",
        username: "HAEUN",
      },
      lastSeq: 1,
      lastMessageAt: "2026-10-09T03:00:00.000Z",
      unread: false,
      unreadCount: 0,
      unreadMentions: 0,
      muted: false,
    },
    {
      roomId: id(5),
      kind: "group_dm",
      name: null,
      members: [
        {
          avatar: { color: "blue" as const, photoUrl: null },
          userId: id(21),
          name: "박지훈",
        },
        {
          avatar: { color: "blue" as const, photoUrl: null },
          userId: id(22),
          name: "이서연",
        },
      ],
      memberCount: 3,
      lastSeq: 1,
      lastMessageAt: "2026-10-09T03:00:00.000Z",
      unread: true,
      unreadCount: 1,
      unreadMentions: 0,
      muted: false,
    },
  ],
  meetings: [
    {
      roomId: id(6),
      bookingId: id(7),
      title: "기획 회의",
      spaceName: "회의실 A",
      start: "2026-10-09T04:00:00.000Z",
      end: "2026-10-09T05:00:00.000Z",
      timezone: "Asia/Seoul",
      phase: "upcoming",
      unread: true,
      unreadMentions: 0,
      muted: false,
    },
  ],
};
export const contacts: MessageContact[] = [
  {
    avatar: { color: "blue" as const, photoUrl: null },
    userId: id(20),
    name: "김하은",
    username: "haeun",
    sharedTeamNames: ["디자인"],
    isFriend: true,
    directRoomId: id(4),
  },
  {
    avatar: { color: "blue" as const, photoUrl: null },
    userId: id(23),
    name: "정유나",
    username: "yuna",
    sharedTeamNames: [],
    isFriend: true,
    directRoomId: null,
  },
];

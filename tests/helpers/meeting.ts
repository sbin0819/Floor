import {
  emptyMessageDetails,
  type ChatNav,
  type MeetingNav,
  type MeetingView,
} from "@/features/chat/types";

export const meetingNow = "2026-10-08T01:00:00.000Z";
export function meetingView(overrides: Partial<MeetingView> = {}): MeetingView {
  return {
    call: null,
    canCall: false,
    room: {
      id: "a1111111-1111-4111-8111-111111111111",
      lastSeq: 1,
      muted: false,
      unreadMentions: 0,
    },
    booking: {
      id: "b1111111-1111-4111-8111-111111111111",
      title: "디자인 회의",
      spaceName: "가상 회의실",
      floorName: "7층",
      branchName: "강남점",
      timezone: "Asia/Seoul",
      start: "2026-10-08T02:00:00.000Z",
      end: "2026-10-08T03:00:00.000Z",
      status: "confirmed",
      attendeeCount: 3,
    },
    user: { id: "c1111111-1111-4111-8111-111111111111", name: "홍유진" },
    members: [
      {
        userId: "c1111111-1111-4111-8111-111111111111",
        name: "홍유진",
        username: "host",
        isBooker: true,
        sharesSpace: true,
      },
      {
        userId: "d1111111-1111-4111-8111-111111111111",
        name: "김민지",
        username: "member",
        isBooker: false,
        sharesSpace: false,
      },
    ],
    messages: [
      {
        ...emptyMessageDetails(),
        id: "e1111111-1111-4111-8111-111111111111",
        seq: 1,
        authorId: "c1111111-1111-4111-8111-111111111111",
        authorName: "홍유진",
        kind: "text",
        body: "회의 자료를 확인해요",
        createdAt: meetingNow,
        clientId: null,
      },
    ],
    lastReadSeq: 1,
    firstUnreadSeq: null,
    canWrite: true,
    readOnlyReason: null,
    isBooker: true,
    canEditBooking: true,
    now: meetingNow,
    ...overrides,
  };
}
export function meetingNav(overrides: Partial<MeetingNav> = {}): MeetingNav {
  const data = meetingView();
  return {
    bookingId: data.booking.id,
    roomId: data.room.id,
    title: data.booking.title,
    spaceName: data.booking.spaceName,
    start: data.booking.start,
    end: data.booking.end,
    timezone: data.booking.timezone,
    phase: "upcoming",
    unread: false,
    unreadMentions: 0,
    muted: false,
    ...overrides,
  };
}
export function meetingChatNav(overrides: Partial<ChatNav> = {}): ChatNav {
  return {
    callsEnabled: false,
    calls: [],
    myCall: null,
    spaces: [],
    directMessages: [],
    meetings: [meetingNav()],
    now: meetingNow,
    myStatus: "online",
    blockedUserIds: [],
    ...overrides,
  };
}

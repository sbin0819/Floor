import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MeetingScreen } from "@/features/chat/components/channel-screen";
import { MeetingList } from "@/features/chat/components/meeting-list";
import { Button } from "@/components/ui/button";
import {
  emptyMessageDetails,
  type MeetingView,
  type MeetingNav,
} from "@/features/chat/types";
import { systemMessageText } from "@/features/chat/system-messages";

const data: MeetingView = {
  call: null,
  canCall: false,
  canCallAtStart: false,
  room: { id: "story-meeting", lastSeq: 2, muted: false, unreadMentions: 0 },
  booking: {
    id: "story-booking",
    title: "디자인 리뷰",
    spaceName: "회의실 A",
    floorName: "7층",
    branchName: "강남점",
    timezone: "Asia/Seoul",
    start: "2026-10-08T01:00:00Z",
    end: "2026-10-08T02:00:00Z",
    status: "confirmed",
    attendeeCount: 3,
  },
  user: { id: "park", name: "박지훈" },
  members: [
    {
      userId: "park",
      name: "박지훈",
      username: "designadmin",
      isBooker: true,
      sharesSpace: true,
    },
    {
      userId: "lee",
      name: "이서연",
      username: "designer",
      isBooker: false,
      sharesSpace: true,
    },
    {
      userId: "jung",
      name: "정유나",
      username: "guest",
      isBooker: false,
      sharesSpace: false,
    },
  ],
  messages: [
    {
      ...emptyMessageDetails(),
      id: "system",
      seq: 1,
      authorId: null,
      authorName: null,
      kind: "system",
      body: systemMessageText({ type: "booking_created", actorName: "박지훈" }),
      systemData: { type: "booking_created", actorName: "박지훈" },
      createdAt: "2026-10-08T00:00:00Z",
      clientId: null,
    },
    {
      ...emptyMessageDetails(),
      id: "text",
      seq: 2,
      authorId: "lee",
      authorName: "이서연",
      kind: "text",
      body: "새 시안을 준비했어요. 함께 확인해요.",
      createdAt: "2026-10-08T00:20:00Z",
      clientId: null,
    },
  ],
  lastReadSeq: 2,
  firstUnreadSeq: null,
  canWrite: true,
  readOnlyReason: null,
  isBooker: true,
  canEditBooking: true,
  now: "2026-10-08T00:30:00Z",
};
type Example =
  | "upcoming"
  | "ongoing"
  | "ended"
  | "cancelled"
  | "readonly"
  | "sheet"
  | "sidebar";
function MeetingStory({ example = "upcoming" }: { example?: Example }) {
  const [client] = useState(() => {
    const value = new QueryClient();
    value.setQueryData(["chat", "nav"], {
      callsEnabled: false,
      calls: [],
      myCall: null,
      spaces: [],
      directMessages: [],
      meetings: [],
      now: data.now,
      myStatus: "online",
      blockedUserIds: [],
    });
    return value;
  });
  const view: MeetingView = {
    ...data,
    now:
      example === "ongoing"
        ? "2026-10-08T01:30:00Z"
        : example === "ended"
          ? "2026-10-08T03:00:00Z"
          : example === "readonly"
            ? "2026-10-09T03:00:00Z"
            : data.now,
    booking: {
      ...data.booking,
      status: example === "cancelled" ? "cancelled" : "confirmed",
    },
    canWrite: example !== "cancelled" && example !== "readonly",
    canEditBooking: !(["ended", "cancelled", "readonly"] as Example[]).includes(
      example,
    ),
    readOnlyReason:
      example === "cancelled"
        ? "cancelled"
        : example === "readonly"
          ? "ended"
          : null,
  };
  const base: MeetingNav = {
    bookingId: data.booking.id,
    roomId: data.room.id,
    title: data.booking.title,
    spaceName: data.booking.spaceName,
    start: data.booking.start,
    end: data.booking.end,
    timezone: data.booking.timezone,
    phase: "upcoming",
    unread: true,
    unreadMentions: 2,
    muted: false,
  };
  return (
    <QueryClientProvider client={client}>
      {example === "sidebar" ? (
        <div className="w-60 rounded-xl border border-border bg-sidebar p-3">
          <MeetingList
            now={data.now}
            rows={[
              base,
              {
                ...base,
                bookingId: "second",
                roomId: "second",
                title: "워크숍",
                phase: "ongoing",
                unreadMentions: 0,
              },
              {
                ...base,
                bookingId: "third",
                roomId: "third",
                title: "지난 설계 회의",
                phase: "ended",
                muted: true,
                unread: false,
                unreadMentions: 0,
              },
            ]}
          />
        </div>
      ) : (
        <div
          className={
            example === "sheet"
              ? "h-[760px] w-[420px] max-w-full overflow-hidden border border-border"
              : "w-full"
          }
        >
          <MeetingScreen
            data={view}
            variant={example === "sheet" ? "sheet" : "page"}
            actions={
              example === "sheet" ? (
                <>
                  <Button variant="ghost" asChild>
                    <a href={`/m/${data.booking.id}`}>크게 보기</a>
                  </Button>
                  <Button variant="ghost" aria-label="회의 닫기">
                    닫기
                  </Button>
                </>
              ) : undefined
            }
          />
        </div>
      )}
    </QueryClientProvider>
  );
}
const meta = {
  title: "Chat/Meeting",
  component: MeetingStory,
  parameters: {
    layout: "fullscreen",
    nextjs: {
      appDirectory: true,
      navigation: { pathname: "/m/story-booking" },
    },
  },
} satisfies Meta<typeof MeetingStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Upcoming: Story = { args: { example: "upcoming" } };
export const Ongoing: Story = { args: { example: "ongoing" } };
export const Ended: Story = { args: { example: "ended" } };
export const Cancelled: Story = { args: { example: "cancelled" } };
export const ReadOnly: Story = { args: { example: "readonly" } };
export const Sidebar: Story = { args: { example: "sidebar" } };
export const BookingSheet: Story = { args: { example: "sheet" } };

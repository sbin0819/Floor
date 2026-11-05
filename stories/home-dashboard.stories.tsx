import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import {
  HomeDashboardFrame,
  HomeDashboardRows,
} from "@/features/bookings/components/home-frame";
import {
  HomeGreeting,
  HomeFreeSpaces,
  HomeBookingLimits,
} from "@/features/bookings/components/home-dashboard";
import { HomeNextBooking } from "@/features/bookings/components/home-next-booking";
import {
  HomeWeekBookings,
  HomeFrequentSpaces,
} from "@/features/bookings/components/home-secondary-cards";
import { HomeDashboardSkeleton } from "@/features/bookings/components/home-skeletons";
import { HomeTodo } from "@/features/home/components/home-todo";
import { HomeChecklist } from "@/features/home/components/home-checklist";
import { HomeRecentChats } from "@/features/home/components/home-recent-chats";
import type {
  HomeChecklist as ChecklistData,
  HomeTodo as TodoData,
} from "@/features/home/types";
import type {
  BranchDetails,
  HomeFreeSpacesData,
  MyCalendarBooking,
} from "@/features/bookings/types";
import { getOperatingState } from "@/features/bookings/operating-state";
import { addDays } from "@/lib/time/zoned";
import { homeChats, homeChecklist, homeTodo } from "@/tests/helpers/home";

const now = "2026-10-09T03:00:00Z";
const date = "2026-10-09";
const branch: BranchDetails = {
  id: "branch",
  name: "강남점",
  address: "가상 주소",
  timezone: "Asia/Seoul",
  cover: null,
  openHours: { fri: { open: "08:00", close: "22:00" } },
};
const operatingState = getOperatingState(
  new Date(now),
  branch.timezone,
  branch.openHours,
);
const booking: MyCalendarBooking = {
  relation: "owner",
  meetingRoomId: null,
  invitedByName: null,
  participantNames: ["이서연"],
  id: "booking",
  start: "2026-10-09T04:00:00Z",
  end: "2026-10-09T05:00:00Z",
  date,
  timezone: branch.timezone,
  branchId: branch.id,
  branchName: branch.name,
  floorId: "floor",
  floorName: "3F",
  spaceId: "space",
  spaceName: "회의실 3A",
  spaceType: "meeting_room",
  title: "주간 디자인 회의",
  attendeeCount: 4,
  desk: null,
  teamName: "디자인 스튜디오",
  status: "confirmed",
  cancelledAt: null,
  canCancel: false,
  photo: {
    path: "/seed/photos/meeting-small-sage.webp",
    alt: "가상 회의실 사진",
  },
};
const free: HomeFreeSpacesData = {
  state: "ready",
  branch,
  now,
  date,
  operatingState,
  totalCount: 6,
  freeCount: 2,
  spaces: [
    {
      id: "free-space",
      name: "회의실 3B",
      type: "meeting_room",
      photo: booking.photo,
      capacity: 6,
      amenities: ["monitor"],
      floor: { id: "floor", name: "3F", level: 3, sortOrder: 0, plan: null },
      intervals: [],
      freeUntil: "2026-10-09T07:00:00Z",
    },
  ],
};
const manyTodos: TodoData = {
  ...homeTodo,
  joinRequests: {
    top: { teamId: "team", teamName: "디자인 스튜디오", count: 2 },
    rest: 1,
  },
  teamInvites: 1,
  friendRequests: 2,
  messageRequests: 1,
  spaceInvites: { count: 1, href: "/s/join/fake-code" },
};
const dismiss = async () => ({ ok: true as const, data: {} });

function StoryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function Dashboard({ starter = false }: { starter?: boolean }) {
  const [showGuide, setShowGuide] = useState(starter);
  const rows = starter ? [] : [booking];
  const closeGuide = async () => {
    setShowGuide(false);
    return { ok: true as const, data: {} };
  };
  return (
    <HomeDashboardFrame
      header={
        <HomeGreeting
          data={{
            name: starter ? "가상 새 회원" : "박지훈",
            now,
            date,
            branch,
            operatingState,
            firstVisit: starter,
          }}
        />
      }
    >
      <HomeDashboardRows
        todo={starter ? null : <HomeTodo data={manyTodos} />}
        firstRow={
          <>
            <div className="min-w-0">
              {showGuide ? (
                <HomeChecklist
                  data={homeChecklist}
                  dismissAction={closeGuide}
                />
              ) : (
                <HomeNextBooking data={{ now, bookings: rows }} />
              )}
            </div>
            <div className="min-w-0">
              {starter ? (
                <HomeFreeSpaces data={free} />
              ) : (
                <HomeRecentChats data={homeChats} />
              )}
            </div>
          </>
        }
        week={
          <HomeWeekBookings
            data={{
              now,
              today: date,
              timezone: branch.timezone,
              openHours: branch.openHours,
              days: Array.from({ length: 7 }, (_, index) => ({
                date: addDays(date, index),
                bookings: index === 0 ? rows : [],
              })),
            }}
          />
        }
        thirdRow={
          <>
            {!starter && <HomeFreeSpaces data={free} />}
            <HomeBookingLimits
              data={{
                branch,
                now,
                date,
                limitMinutes: 120,
                usedMinutes: 30,
                remainingMinutes: 90,
              }}
            />
            {!starter && (
              <HomeFrequentSpaces
                data={{
                  spaces: [
                    {
                      id: booking.spaceId,
                      name: booking.spaceName,
                      type: booking.spaceType,
                      branchId: branch.id,
                      branchName: branch.name,
                      floorId: booking.floorId,
                      floorName: booking.floorName,
                      date,
                      photo: booking.photo,
                      bookingCount: 5,
                    },
                  ],
                }}
              />
            )}
          </>
        }
      />
    </HomeDashboardFrame>
  );
}
const meta = {
  title: "Home/Dashboard",
  component: Dashboard,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <StoryProvider>
        <Story />
      </StoryProvider>
    ),
  ],
} satisfies Meta<typeof Dashboard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ActiveMember: Story = {};
export const NewMember: Story = { args: { starter: true } };
export const Loading: Story = { render: () => <HomeDashboardSkeleton /> };
export const TodoOne: Story = {
  render: () => <HomeTodo data={{ ...homeTodo, teamInvites: 1 }} />,
};
export const TodoMany: Story = { render: () => <HomeTodo data={manyTodos} /> };
export const RecentConversations: Story = {
  render: () => (
    <div className="max-w-md">
      <HomeRecentChats data={homeChats} />
    </div>
  ),
};
export const ChecklistOne: Story = {
  render: () => (
    <div className="max-w-2xl">
      <HomeChecklist data={homeChecklist} dismissAction={dismiss} />
    </div>
  ),
};
const four: ChecklistData = {
  ...homeChecklist,
  steps: { ...homeChecklist.steps, username: true, team: true, booking: true },
};
export const ChecklistFour: Story = {
  render: () => (
    <div className="max-w-2xl">
      <HomeChecklist data={four} dismissAction={dismiss} />
    </div>
  ),
};

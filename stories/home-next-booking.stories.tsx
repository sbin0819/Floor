import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HomeNextBooking } from "@/features/bookings/components/home-next-booking";
import type { MyCalendarBooking } from "@/features/bookings/types";

const booking: MyCalendarBooking = {
  relation: "owner",
  meetingRoomId: null,
  invitedByName: null,
  participantNames: [],
  id: "booking",
  start: "2026-10-07T06:00:00Z",
  end: "2026-10-07T07:00:00Z",
  date: "2026-10-07",
  timezone: "Asia/Seoul",
  branchId: "branch",
  branchName: "강남점",
  floorId: "floor",
  floorName: "7F",
  spaceId: "space",
  spaceName: "회의실 C",
  spaceType: "meeting_room",
  title: "주간 회의",
  attendeeCount: null,
  desk: null,
  teamName: "디자인 스튜디오",
  status: "confirmed",
  cancelledAt: null,
  canCancel: true,
  photo: {
    path: "/seed/photos/meeting-small-sage.webp",
    alt: "가상 회의실 사진",
  },
};
const meta = {
  title: "Bookings/HomeNextBooking",
  component: HomeNextBooking,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <QueryClientProvider client={new QueryClient()}>
        <div className="mx-auto max-w-3xl">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: {
    data: {
      now: "2026-10-07T06:25:00Z",
      bookings: [
        booking,
        {
          ...booking,
          id: "second",
          start: "2026-10-08T01:00:00Z",
          end: "2026-10-08T02:00:00Z",
          date: "2026-10-08",
          spaceName: "회의실 6B",
        },
      ],
    },
  },
} satisfies Meta<typeof HomeNextBooking>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ongoing: Story = {};
export const LaterToday: Story = {
  args: { data: { now: "2026-10-07T03:00:00Z", bookings: [booking] } },
};
export const Tomorrow: Story = {
  args: { data: { now: "2026-10-06T03:00:00Z", bookings: [booking] } },
};
export const Empty: Story = {
  args: { data: { now: "2026-10-07T03:00:00Z", bookings: [] } },
};
export const InvitedReservation: Story = {
  args: {
    data: {
      now: "2026-10-07T03:00:00Z",
      bookings: [
        {
          ...booking,
          relation: "invited",
          invitedByName: "최민준",
          participantNames: ["김하은", "이서연"],
          canCancel: false,
          photo: null,
        },
      ],
    },
  },
};
export const WithParticipants: Story = {
  args: {
    data: {
      now: "2026-10-07T03:00:00Z",
      bookings: [
        { ...booking, participantNames: ["이서연", "정민지", "최민준"] },
      ],
    },
  },
};
export const DeskReservation: Story = {
  args: {
    data: {
      now: "2026-10-07T06:25:00Z",
      bookings: [
        {
          ...booking,
          start: "2026-10-07T04:00:00Z",
          end: "2026-10-07T13:00:00Z",
          spaceName: "오픈 데스크",
          spaceType: "desk_area",
          title: null,
          desk: { id: "desk", name: "A-15", part: "pm" },
          photo: {
            path: "/seed/photos/open-desk-oak.webp",
            alt: "가상 오픈 데스크 좌석",
          },
        },
      ],
    },
  },
};

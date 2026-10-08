import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { MyBookingCalendarDay } from "@/features/bookings/components/my-bookings-calendar";
import type { MyCalendarBooking } from "@/features/bookings/types";

const booking: MyCalendarBooking = {
  relation: "owner",
  invitedByName: null,
  participantNames: [],
  id: "booking",
  start: "2026-10-08T05:00:00Z",
  end: "2026-10-08T06:00:00Z",
  date: "2026-10-08",
  timezone: "Asia/Seoul",
  title: null,
  attendeeCount: null,
  desk: null,
  teamName: null,
  status: "confirmed",
  cancelledAt: null,
  branchId: "branch",
  branchName: "강남점",
  floorId: "floor",
  floorName: "7F",
  spaceId: "space",
  spaceName: "회의실 A",
  spaceType: "meeting_room",
  photo: null,
  canCancel: true,
};
const meta = {
  title: "Bookings/My calendar day",
  component: MyBookingCalendarDay,
  tags: ["autodocs"],
  args: {
    day: { date: "2026-10-08", day: 8, weekday: "thu", inMonth: true },
    bookings: [],
    now: "2026-10-08T05:30:00Z",
    today: "2026-10-08",
  },
  decorators: [
    (Story) => (
      <div className="min-h-28 w-36 rounded-lg border border-border bg-card p-2">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MyBookingCalendarDay>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = {};
export const One: Story = { args: { bookings: [booking] } };
export const Invited: Story = {
  args: {
    bookings: [
      {
        ...booking,
        relation: "invited",
        invitedByName: "최민준",
        participantNames: ["김하은"],
        canCancel: false,
      },
    ],
  },
};
export const Three: Story = {
  args: {
    bookings: [
      {
        ...booking,
        id: "past",
        start: "2026-10-08T02:00:00Z",
        end: "2026-10-08T03:00:00Z",
      },
      booking,
      {
        ...booking,
        id: "next",
        start: "2026-10-08T07:00:00Z",
        end: "2026-10-08T08:00:00Z",
      },
    ],
  },
};

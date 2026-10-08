import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { BookingEditScreen } from "@/features/bookings/components/booking-edit-screen";
import { BookingEditLayout } from "@/features/bookings/components/booking-edit-layout";
import type { BookingForEditData } from "@/features/bookings/types";

const data: BookingForEditData = {
  booking: {
    id: "story-booking",
    start: "2026-10-08T01:00:00Z",
    end: "2026-10-08T02:00:00Z",
    title: "기획 회의",
    attendeeCount: 4,
    started: false,
  },
  participants: [
    {
      userId: "story-member",
      name: "김하은",
      sharedTeamNames: ["디자인 팀"],
      maskedEmail: "ha•••@floor.example",
    },
  ],
  actor: {
    teamId: null,
    name: "개인으로",
    limits: {
      maxDaysAhead: 7,
      maxMinutesPerBooking: 120,
      maxMinutesPerDay: 120,
    },
    remainingMinutes: 120,
  },
  branch: {
    id: "story-branch",
    name: "강남점",
    timezone: "Asia/Seoul",
    openHours: { thu: { open: "08:00", close: "22:00" } },
  },
  floor: { id: "story-floor", name: "7F" },
  space: {
    id: "story-space",
    name: "회의실 C",
    type: "meeting_room",
    capacity: 6,
    amenities: ["monitor"],
    photo: { path: "/seed/photos/meeting-small-sage.webp", alt: "밝은 회의실" },
  },
  date: "2026-10-08",
  now: "2026-10-08T00:00:00Z",
  openHours: { open: "08:00", close: "22:00" },
  bookings: [],
  blocks: [],
};
function BookingEditStory({
  started = false,
  capacity = 6,
}: {
  started?: boolean;
  capacity?: number;
}) {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <BookingEditLayout>
        <BookingEditScreen
          data={{
            ...data,
            booking: { ...data.booking, started },
            space: { ...data.space, capacity },
          }}
        />
      </BookingEditLayout>
    </QueryClientProvider>
  );
}
const meta = {
  title: "예약/BookingEdit",
  component: BookingEditStory,
  tags: ["autodocs"],
  parameters: { nextjs: { appDirectory: true } },
} satisfies Meta<typeof BookingEditStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Upcoming: Story = {};
export const Started: Story = { args: { started: true } };
export const ReducedCapacity: Story = { args: { capacity: 1 } };

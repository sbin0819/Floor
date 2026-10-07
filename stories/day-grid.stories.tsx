import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { BookingTimeline } from "@/features/bookings/components/booking-timeline";
import { createBookingSlots } from "@/features/bookings/rules";
import {
  selectBookingSlot,
  type BookingSelection,
  type SelectableSlot,
} from "@/features/bookings/selection";
import type { DayBooking, SpaceDayData } from "@/features/bookings/types";

const bookings: DayBooking[] = [
  {
    id: "earlier",
    start: "2026-10-07T00:00:00Z",
    end: "2026-10-07T01:00:00Z",
    bookerName: "박지훈",
    isMine: false,
    canCancel: false,
  },
  {
    id: "later",
    start: "2026-10-07T03:00:00Z",
    end: "2026-10-07T04:00:00Z",
    bookerName: "김하은",
    isMine: true,
    canCancel: false,
    title: "팀 주간 회의",
  },
];
const blocks: SpaceDayData["blocks"] = [
  {
    id: "maintenance",
    start: "2026-10-07T03:30:00Z",
    end: "2026-10-07T04:30:00Z",
    reason: "시설 점검",
  },
];
const daySlots = createBookingSlots({
  date: "2026-10-07",
  timeZone: "Asia/Seoul",
  openHours: { wed: { open: "08:00", close: "16:00" } },
});

function DayGridStory({ overlapping = false }: { overlapping?: boolean }) {
  const [selection, setSelection] = useState<BookingSelection | null>(null);
  const maintenance = overlapping ? blocks : [];
  const slots: SelectableSlot[] = daySlots.map((slot) => {
    const overlaps = (range: { start: string; end: string }) =>
      Date.parse(range.start) < Date.parse(slot.end) &&
      Date.parse(range.end) > Date.parse(slot.start);
    const booking = bookings.find(overlaps);
    const block = maintenance.find(overlaps);
    return {
      ...slot,
      state: block
        ? "maintenance"
        : booking
          ? "reserved"
          : Date.parse(slot.start) < Date.parse("2026-10-07T01:00:00Z")
            ? "past"
            : "free",
      booking,
      block,
    };
  });
  return (
    <div className="w-full max-w-[420px] rounded-xl border border-border bg-card p-4">
      <BookingTimeline
        slots={slots}
        bookings={bookings}
        blocks={maintenance}
        timeZone="Asia/Seoul"
        now="2026-10-07T01:15:00Z"
        date="2026-10-07"
        start={selection?.start ?? ""}
        end={selection?.end ?? ""}
        disabled={false}
        renderCancel={() => null}
        onSelect={(start) =>
          setSelection(selectBookingSlot(slots, selection, start))
        }
      />
    </div>
  );
}

const meta = {
  title: "예약/DayGrid",
  component: DayGridStory,
  tags: ["autodocs"],
  parameters: { nextjs: { appDirectory: true } },
} satisfies Meta<typeof DayGridStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Today: Story = {};
export const OverlappingMaintenance: Story = { args: { overlapping: true } };

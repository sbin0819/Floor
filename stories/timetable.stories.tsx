import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { FloorTimetable } from "@/features/bookings/components/floor-timetable";
import { getOperatingState } from "@/features/bookings/operating-state";
import {
  selectFloorBookingSlot,
  type FloorBookingSelection,
} from "@/features/bookings/selection";
import type {
  FloorDayData,
  FloorVisibleSpace,
} from "@/features/bookings/types";

const base: FloorVisibleSpace = {
  kind: "accessible",
  id: "a",
  name: "회의실 A",
  type: "meeting_room",
  capacity: 6,
  photo: {
    path: "/seed/photos/meeting-small-oak.webp",
    alt: "회의실의 테이블과 의자",
  },
  amenities: ["monitor", "whiteboard"],
  bookable: true,
  deskCount: 0,
  bookingCount: 1,
  status: "free",
  summary: null,
  intervals: [],
};
const branch: FloorDayData["branch"] = {
  id: "branch",
  name: "강남점",
  address: "가상 주소",
  timezone: "Asia/Seoul",
  cover: null,
  openHours: { wed: { open: "08:00", close: "22:00" } },
};
const floor = { id: "floor", name: "7F", level: 7, sortOrder: 0, plan: null };
function TimetableStory({
  anotherDate = false,
  restricted = false,
  desks = false,
}: {
  anotherDate?: boolean;
  restricted?: boolean;
  desks?: boolean;
}) {
  const [selection, setSelection] = useState<FloorBookingSelection | null>(
    null,
  );
  const [deskPart, setDeskPart] = useState<string | null>(null);
  const date = anotherDate ? "2026-10-14" : "2026-10-07";
  const at = (hour: number, minute = 0) =>
    `${date}T${String(hour - 9).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;
  const now = "2026-10-07T06:25:00.000Z";
  const data: FloorDayData = {
    branch,
    floor,
    floors: [floor],
    date,
    isToday: !anotherDate,
    now,
    openHours: branch.openHours.wed!,
    operatingState: getOperatingState(
      new Date(now),
      branch.timezone,
      branch.openHours,
    ),
    groups: [
      { type: "meeting_room", totalCount: restricted ? 4 : 3, freeCount: 2 },
      { type: "phone_booth", totalCount: 1, freeCount: 1 },
      { type: "lounge", totalCount: 1, freeCount: null },
    ],
    spaces: [
      {
        ...base,
        intervals: [
          { start: at(10), end: at(11, 30), kind: "other" },
          { start: at(16), end: at(17), kind: "mine" },
        ],
      },
      {
        ...base,
        id: "b",
        name: "회의실 B",
        capacity: 4,
        intervals: [{ start: at(14), end: at(15), kind: "other" }],
      },
      {
        ...base,
        id: "c",
        name: "회의실 C",
        capacity: 8,
        photo: null,
        intervals: restricted
          ? [
              { start: at(13), end: at(17), kind: "maintenance" },
              { start: at(14), end: at(15), kind: "mine" },
            ]
          : [],
      },
      ...(restricted
        ? [
            {
              kind: "restricted" as const,
              id: "private",
              type: "meeting_room" as const,
            },
          ]
        : []),
      {
        ...base,
        id: "phone",
        name: "폰부스 A",
        type: "phone_booth",
        capacity: 1,
        photo: null,
      },
      {
        ...base,
        id: "lounge",
        name: "라운지",
        type: "lounge",
        capacity: null,
        photo: null,
        bookable: false,
      },
    ],
  };
  if (desks) {
    data.groups.push({ type: "desk_area", totalCount: 1, freeCount: null });
    data.spaces.push({
      ...base,
      id: "desk-area",
      name: "오픈 데스크",
      type: "desk_area",
      capacity: null,
      bookable: false,
      deskCount: 24,
      photo: null,
      deskParts: [
        {
          part: "am",
          start: `${date}T08:00:00+09:00`,
          end: `${date}T13:00:00+09:00`,
          selectable: anotherDate,
          freeCount: 17,
          myDeskName: null,
        },
        {
          part: "pm",
          start: `${date}T13:00:00+09:00`,
          end: `${date}T22:00:00+09:00`,
          selectable: true,
          freeCount: 16,
          myDeskName: "A-15",
        },
      ],
    });
  }
  return (
    <div className="w-full max-w-[1184px] p-4">
      <FloorTimetable
        data={data}
        selection={selection}
        onSelectDeskPart={({ part }) =>
          setDeskPart(part === "am" ? "오전" : "오후")
        }
        onSelectSlot={({ spaceId, slots, start }) =>
          setSelection((previous) =>
            selectFloorBookingSlot(spaceId, slots, previous, start),
          )
        }
      />
      <p className="mt-4 text-sm text-muted-foreground" aria-live="polite">
        {deskPart
          ? `${deskPart} 좌석을 고를 수 있어요`
          : selection
            ? "고른 시간으로 예약할 수 있어요"
            : "빈 칸을 눌러 시간을 골라 주세요"}
      </p>
    </div>
  );
}
const meta = {
  title: "예약/FloorTimetable",
  component: TimetableStory,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true } },
} satisfies Meta<typeof TimetableStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Today: Story = {};
export const AnotherDate: Story = { args: { anotherDate: true } };
export const RestrictedAndMaintenance: Story = { args: { restricted: true } };
export const DeskParts: Story = { args: { desks: true, anotherDate: true } };
export const ExpiredMorning: Story = { args: { desks: true } };

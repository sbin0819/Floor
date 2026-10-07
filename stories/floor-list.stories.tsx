import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { FloorDay } from "@/features/bookings/components/floor-day";
import {
  FloorPageSkeleton,
  FloorSpaceListSkeleton,
} from "@/features/bookings/components/booking-skeletons";
import type {
  FloorDayData,
  FloorVisibleSpace,
} from "@/features/bookings/types";

const branch = {
  id: "branch",
  name: "가상 강남점",
  address: null,
  timezone: "Asia/Seoul",
  openHours: { wed: { open: "08:00", close: "22:00" } },
  cover: null,
};
const floor = { id: "floor", name: "7F", level: 7, sortOrder: 1 };
const base: FloorVisibleSpace = {
  kind: "accessible",
  id: "free",
  type: "meeting_room",
  name: "회의실 B",
  capacity: 6,
  amenities: ["monitor", "whiteboard"],
  bookable: true,
  deskCount: 0,
  bookingCount: 2,
  status: "free",
  photo: {
    path: "/seed/photos/meeting-small-sage.webp",
    alt: "회의실 B 테이블과 화이트보드",
  },
  summary: { status: "free", until: "2026-10-07T22:00:00+09:00" },
  intervals: [
    {
      start: "2026-10-07T10:00:00+09:00",
      end: "2026-10-07T11:30:00+09:00",
      kind: "other",
    },
  ],
};
const data: FloorDayData = {
  branch,
  floor,
  floors: [floor],
  date: "2026-10-07",
  isToday: true,
  now: "2026-10-07T15:30:00+09:00",
  openHours: { open: "08:00", close: "22:00" },
  operatingState: {
    status: "open",
    date: "2026-10-07",
    hours: { open: "08:00", close: "22:00" },
    window: {
      start: "2026-10-07T08:00:00+09:00",
      end: "2026-10-07T22:00:00+09:00",
    },
    nextOpening: null,
  },
  groups: [
    { type: "meeting_room", totalCount: 4, freeCount: 1 },
    { type: "seminar", totalCount: 1, freeCount: 0 },
  ],
  spaces: [
    base,
    {
      ...base,
      id: "mine",
      name: "회의실 C",
      status: "mine",
      summary: { status: "mine", until: "2026-10-07T16:00:00+09:00" },
      intervals: [
        {
          start: "2026-10-07T15:00:00+09:00",
          end: "2026-10-07T16:00:00+09:00",
          kind: "mine",
        },
      ],
    },
    {
      ...base,
      id: "maintenance",
      name: "회의실 D",
      status: "maintenance",
      summary: { status: "maintenance", until: "2026-10-08T12:00:00+09:00" },
      intervals: [
        {
          start: "2026-10-07T08:00:00+09:00",
          end: "2026-10-07T22:00:00+09:00",
          kind: "maintenance",
        },
      ],
    },
    { kind: "restricted", id: "restricted", type: "meeting_room" },
    {
      ...base,
      id: "busy",
      type: "seminar",
      name: "세미나룸",
      capacity: 20,
      status: "busy",
      summary: { status: "busy", availableAt: "2026-10-07T18:00:00+09:00" },
      intervals: [
        {
          start: "2026-10-07T13:00:00+09:00",
          end: "2026-10-07T18:00:00+09:00",
          kind: "other",
        },
      ],
    },
  ],
};
const meta = {
  title: "예약/FloorList",
  component: FloorDay,
  tags: ["autodocs"],
  args: { data },
  decorators: [
    (Story) => (
      <div className="w-full max-w-3xl p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FloorDay>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Today: Story = {};
export const OtherDate: Story = { args: { data: { ...data, isToday: false } } };
export const ListLoading: Story = { render: () => <FloorSpaceListSkeleton /> };
export const PageLoading: Story = { render: () => <FloorPageSkeleton /> };

import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AvailabilityBar } from "@/features/bookings/components/availability-bar";

const meta = {
  title: "예약/AvailabilityBar",
  component: AvailabilityBar,
  tags: ["autodocs"],
  args: {
    intervals: [],
    window: {
      start: "2026-10-07T08:00:00+09:00",
      end: "2026-10-07T22:00:00+09:00",
    },
    timeZone: "Asia/Seoul",
    now: "2026-10-07T15:30:00+09:00",
    showTicks: true,
  },
  decorators: [
    (Story) => (
      <div className="w-full max-w-lg p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AvailabilityBar>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = {};
export const PartialBookings: Story = {
  args: {
    intervals: [
      {
        start: "2026-10-07T10:00:00+09:00",
        end: "2026-10-07T11:30:00+09:00",
        kind: "other",
      },
      {
        start: "2026-10-07T17:00:00+09:00",
        end: "2026-10-07T18:00:00+09:00",
        kind: "other",
      },
    ],
  },
};
export const Mine: Story = {
  args: {
    intervals: [
      {
        start: "2026-10-07T15:00:00+09:00",
        end: "2026-10-07T16:00:00+09:00",
        kind: "mine",
      },
    ],
  },
};
export const Maintenance: Story = {
  args: {
    intervals: [
      {
        start: "2026-10-07T08:00:00+09:00",
        end: "2026-10-07T22:00:00+09:00",
        kind: "maintenance",
      },
    ],
  },
};
export const WithoutTicks: Story = {
  args: { ...PartialBookings.args, showTicks: false },
};

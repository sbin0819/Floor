import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { BookingChip } from "./booking-chip";

const meta = {
  title: "컴포넌트/BookingChip",
  component: BookingChip,
  tags: ["autodocs"],
  args: { kind: "upcoming", children: "15:00 회의실 C" },
  decorators: [
    (Story) => (
      <div className="w-40">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BookingChip>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Upcoming: Story = {};
export const Ongoing: Story = { args: { kind: "ongoing" } };
export const Past: Story = { args: { kind: "past" } };
export const LongName: Story = {
  args: { children: "15:00 성수점 워크숍 회의실" },
};

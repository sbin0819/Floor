import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SeatMap, type SeatMapItem } from "./seat-map";

const seats = (count = 24): SeatMapItem[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `seat-${index}`,
    name: `A-${String(index + 1).padStart(2, "0")}`,
    row: Math.floor(index / 6),
    column: index % 6,
    state: index === 23 ? "blocked" : index % 4 === 0 ? "booked" : "free",
  }));
const meta = {
  title: "컴포넌트/SeatMap",
  component: SeatMap,
  tags: ["autodocs"],
  args: { seats: seats(), selectedId: null, onSelect: () => {} },
  render: function Example(args) {
    const [selectedId, onSelect] = useState<string | null>(args.selectedId);
    return (
      <div className="flex h-[440px] w-[388px] max-w-full flex-col rounded-xl border border-border bg-card p-4">
        <SeatMap {...args} selectedId={selectedId} onSelect={onSelect} />
      </div>
    );
  },
} satisfies Meta<typeof SeatMap>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Mine: Story = {
  args: {
    seats: seats().map((seat, index) =>
      index === 14 ? { ...seat, state: "mine" } : seat,
    ),
  },
};
export const FullyBooked: Story = {
  args: { seats: seats().map((seat) => ({ ...seat, state: "booked" })) },
};
export const MixedPositions: Story = {
  args: {
    seats: [
      ...seats(12),
      ...seats(5).map((seat, index) => ({
        ...seat,
        id: `fallback-${index}`,
        name: `B-${index + 1}`,
        row: 2,
        column: index,
      })),
    ],
  },
};
export const FortySeats: Story = { args: { seats: seats(40) } };

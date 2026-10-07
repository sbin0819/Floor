import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { StatusBadge, statusLabels, type Status } from "./status-badge";

const meta = {
  title: "컴포넌트/StatusBadge",
  component: StatusBadge,
  tags: ["autodocs"],
  args: { status: "free" },
  argTypes: {
    status: { control: "select", options: Object.keys(statusLabels) },
  },
} satisfies Meta<typeof StatusBadge>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const All: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      {(Object.keys(statusLabels) as Status[]).map((status) => (
        <StatusBadge key={status} status={status} />
      ))}
    </div>
  ),
};

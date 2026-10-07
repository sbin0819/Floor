import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { StatusLine } from "./status-line";

const meta = {
  title: "컴포넌트/StatusLine",
  component: StatusLine,
  tags: ["autodocs"],
  args: { kind: "free", children: "17:30까지 비어 있음" },
} satisfies Meta<typeof StatusLine>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Free: Story = {};
export const Busy: Story = {
  args: { kind: "busy", children: "16:30부터 비어 있음" },
};
export const Mine: Story = {
  args: { kind: "mine", children: "내 예약 · 16:00까지" },
};
export const Maintenance: Story = {
  args: { kind: "maintenance", children: "점검 중 · 내일 12:00까지" },
};
export const NoDot: Story = {
  args: { kind: "none", children: "오늘 영업이 끝났어요" },
};

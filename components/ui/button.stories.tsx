import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button } from "./button";

const meta = {
  title: "컴포넌트/Button",
  component: Button,
  tags: ["autodocs"],
  args: { children: "예약하기" },
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Primary: Story = {};
export const Secondary: Story = {
  args: { variant: "outline", children: "시간 변경" },
};
export const TextOnly: Story = { args: { variant: "ghost", children: "닫기" } };
export const Destructive: Story = {
  args: { variant: "destructive", children: "예약 취소" },
};
export const Disabled: Story = { args: { disabled: true } };

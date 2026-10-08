import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AttendeeCountInput } from "./attendee-count-input";

const meta = {
  title: "컴포넌트/AttendeeCountInput",
  component: AttendeeCountInput,
  tags: ["autodocs"],
  args: { value: null, capacity: 8, onChange: () => {} },
  render: function Example(args) {
    const [value, setValue] = useState(args.value);
    return <AttendeeCountInput {...args} value={value} onChange={setValue} />;
  },
} satisfies Meta<typeof AttendeeCountInput>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = {};
export const Filled: Story = { args: { value: 5 } };
export const AtCapacity: Story = { args: { value: 8 } };
export const WithoutCapacity: Story = { args: { capacity: null } };
export const Error: Story = { args: { value: 9 } };

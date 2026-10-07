import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import {
  completeOpenHours,
  OpenHoursFields,
} from "@/features/admin/components/open-hours-fields";

function OperatingHoursStory({
  disabled = false,
  invalid = false,
  mondayClosed = false,
}: {
  disabled?: boolean;
  invalid?: boolean;
  mondayClosed?: boolean;
}) {
  const [value, setValue] = useState(() =>
    completeOpenHours({
      mon: mondayClosed
        ? null
        : { open: "08:00", close: invalid ? "07:00" : "22:00" },
      sat: { open: "10:00", close: "18:00" },
      sun: null,
    }),
  );
  return (
    <div className="w-full max-w-2xl rounded-xl border border-border bg-card p-5">
      <OpenHoursFields
        value={value}
        onChange={setValue}
        disabled={disabled}
        errors={
          invalid
            ? { "openHours.mon.close": "종료 시각은 시작 시각보다 늦어야 해요" }
            : {}
        }
      />
    </div>
  );
}
const meta = {
  title: "운영자/OperatingHours",
  component: OperatingHoursStory,
  tags: ["autodocs"],
} satisfies Meta<typeof OperatingHoursStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Weekdays: Story = {};
export const ClosedMonday: Story = { args: { mondayClosed: true } };
export const ValidationError: Story = { args: { invalid: true } };
export const ReadOnly: Story = { args: { disabled: true } };

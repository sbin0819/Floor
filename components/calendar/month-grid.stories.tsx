import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { cn } from "cn";
import {
  buildMonthGrid,
  getCalendarDayState,
  isCalendarArrowKey,
  moveCalendarDate,
} from "@/lib/calendar/month";
import type { OpenHours } from "@/lib/time/open-hours";
import { MonthGrid } from "./month-grid";

function CalendarExample({
  month = "2026-10",
  minDate = "2026-10-07",
  maxDate = "2026-12-06",
  markedDates = [],
  openHours,
}: {
  month?: string;
  minDate?: string;
  maxDate?: string;
  markedDates?: string[];
  openHours?: OpenHours;
}) {
  const [selected, setSelected] = useState(
    month === "2026-10" ? "2026-10-07" : `${month}-01`,
  );
  const [focused, setFocused] = useState(selected);
  return (
    <MonthGrid
      month={buildMonthGrid(Number(month.slice(0, 4)), Number(month.slice(5)))}
      label={`${month} 날짜`}
      onDayKeyDown={(event, day) => {
        if (!isCalendarArrowKey(event.key)) return;
        event.preventDefault();
        const next = moveCalendarDate(day.date, event.key, {
          minDate,
          maxDate,
          month,
          allowMonthChange: false,
        });
        setFocused(next);
        event.currentTarget
          .closest('[role="grid"]')
          ?.querySelector<HTMLAnchorElement>(`[data-date="${next}"] a`)
          ?.focus();
      }}
      renderDay={(day) => {
        const state = getCalendarDayState(day.date, {
          minDate,
          maxDate,
          today: "2026-10-07",
          selectedDate: selected,
          markedDates: new Set(markedDates),
          openHours,
        });
        const content = (
          <>
            <span>{day.day}</span>
            {state.closed && <span className="text-[10px]">쉼</span>}
            {state.marked && (
              <span
                aria-hidden="true"
                className="size-1 rounded-full bg-primary"
              />
            )}
          </>
        );
        if (state.outsideRange || !day.inMonth)
          return (
            <span className="flex min-h-11 items-center justify-center text-muted-foreground/50">
              {day.day}
            </span>
          );
        return (
          <a
            href={`#${day.date}`}
            tabIndex={day.date === focused ? 0 : -1}
            aria-label={`${day.date}${state.closed ? ", 쉬는 날" : ""}${state.marked ? ", 내 예약 있음" : ""}`}
            aria-current={state.selected ? "date" : undefined}
            onClick={(event) => {
              event.preventDefault();
              setSelected(day.date);
              setFocused(day.date);
            }}
            className={cn(
              "flex min-h-11 flex-col items-center justify-center rounded-lg text-sm focus-visible:outline-2 focus-visible:outline-ring",
              state.closed && "text-muted-foreground",
              state.today && "border border-foreground",
              state.selected && "bg-primary text-primary-foreground",
            )}
          >
            {content}
          </a>
        );
      }}
    />
  );
}

const meta = {
  title: "달력/월 격자",
  component: CalendarExample,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="w-[308px] rounded-xl border bg-card p-3">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CalendarExample>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {};
export const ClosedAndMarked: Story = {
  args: { openHours: { sun: null }, markedDates: ["2026-10-13", "2026-10-15"] },
};
export const EndOfRange: Story = { args: { month: "2026-12" } };

import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "cn";
import {
  calendarWeekdays,
  calendarWeekdayLabels,
  type CalendarDay,
  type CalendarMonth,
} from "@/lib/calendar/month";

export function MonthGrid({
  month,
  label,
  renderDay,
  onDayKeyDown,
  className,
  cellClassName,
}: {
  month: CalendarMonth;
  label: string;
  renderDay: (day: CalendarDay) => ReactNode;
  onDayKeyDown?: (
    event: KeyboardEvent<HTMLDivElement>,
    day: CalendarDay,
  ) => void;
  className?: string;
  cellClassName?: string;
}) {
  return (
    <div
      role="grid"
      aria-label={label}
      aria-colcount={7}
      aria-rowcount={month.weeks.length + 1}
      className={cn("w-full tabular-nums", className)}
    >
      <div role="row" className="grid grid-cols-7">
        {calendarWeekdays.map((day) => (
          <div
            key={day}
            role="columnheader"
            aria-label={calendarWeekdayLabels[day]}
            className="flex min-h-8 items-center justify-center text-xs font-medium text-muted-foreground"
          >
            {calendarWeekdayLabels[day].slice(0, 1)}
          </div>
        ))}
      </div>
      {month.weeks.map((week) => (
        <div key={week[0]!.date} role="row" className="grid grid-cols-7">
          {week.map((day) => (
            <div
              key={day.date}
              role="gridcell"
              data-date={day.date}
              className={cn("min-h-11 min-w-0", cellClassName)}
              onKeyDown={(event) => onDayKeyDown?.(event, day)}
            >
              {renderDay(day)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

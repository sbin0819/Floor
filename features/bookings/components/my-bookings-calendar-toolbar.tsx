import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shouldInterceptNavigation } from "@/components/optimistic-navigation";
import {
  myBookingsCalendarHref,
  type MyBookingsMonthSelection,
} from "@/features/bookings/calendar";
import { parseCalendarMonth } from "@/lib/calendar/month";
import { MyBookingsViewLinks } from "./my-bookings-view-links";

export function MyBookingsCalendarToolbar({
  selection,
  onMonthChange,
  onToday,
}: {
  selection: MyBookingsMonthSelection;
  onMonthChange: (month: string, href: string) => void;
  onToday: () => void;
}) {
  const parsed = parseCalendarMonth(selection.month);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <MyBookingsViewLinks view="calendar" />
      <nav
        aria-label="예약 달 이동"
        className="flex flex-wrap items-center gap-2"
      >
        <Button asChild variant="outline">
          <a
            href={myBookingsCalendarHref(
              selection.today.slice(0, 7),
              selection.today,
            )}
            onClick={(event) => {
              if (!shouldInterceptNavigation(event)) return;
              event.preventDefault();
              onToday();
            }}
          >
            오늘
          </a>
        </Button>
        {(
          [
            [
              "이전 달",
              selection.previousMonth,
              selection.previousHref,
              ChevronLeft,
            ],
            ["다음 달", selection.nextMonth, selection.nextHref, ChevronRight],
          ] as const
        ).map(([label, month, href, Icon], index) => (
          <span key={label} className="contents">
            {index === 1 && (
              <h2 className="min-w-36 text-center text-lg font-semibold tabular-nums">
                {parsed.year}년 {parsed.month}월
              </h2>
            )}
            {href && month ? (
              <Button asChild variant="ghost" size="icon">
                <a
                  aria-label={label}
                  href={href}
                  onClick={(event) => {
                    if (!shouldInterceptNavigation(event)) return;
                    event.preventDefault();
                    onMonthChange(month, href);
                  }}
                >
                  <Icon aria-hidden="true" />
                </a>
              </Button>
            ) : (
              <Button variant="ghost" size="icon" aria-label={label} disabled>
                <Icon aria-hidden="true" />
              </Button>
            )}
          </span>
        ))}
      </nav>
    </div>
  );
}

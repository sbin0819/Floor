"use client";

import Link from "next/link";
import {
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "cn";
import { MonthGrid } from "@/components/calendar/month-grid";
import { shouldInterceptNavigation } from "@/components/optimistic-navigation";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { floorHref, formatBookingDate } from "@/features/bookings/format";
import {
  buildMonthGrid,
  getCalendarDayState,
  isCalendarArrowKey,
  moveCalendarDate,
  parseCalendarMonth,
  shiftCalendarMonth,
} from "@/lib/calendar/month";
import type { OpenHours } from "@/lib/time/open-hours";
import { addDays } from "@/lib/time/zoned";
import { useFloorSelection } from "./branch-workspace";
import { useWideScreen } from "./use-wide-screen";
import { BookingDateMark, BookingDateLegend } from "./booking-date-mark";

type FloorDatePickerProps = {
  branchId: string;
  floorId: string;
  spaceId?: string;
  view?: string;
  date: string;
  today: string;
  timezone: string;
  openHours: OpenHours;
  bookingDates: string[] | Promise<string[]>;
};

export function FloorDatePicker(props: FloorDatePickerProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const wide = useWideScreen();
  const button = (
    <Button
      ref={trigger}
      variant="outline"
      className="shrink-0 gap-2 tabular-nums"
      aria-label="달력에서 날짜 고르기"
    >
      <CalendarDays aria-hidden="true" className="size-4" />
      {Number(props.date.slice(5, 7))}월
    </Button>
  );
  const calendar = open && (
    <DatePickerCalendar {...props} onSelect={() => setOpen(false)} />
  );
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    trigger.current?.focus();
  };
  if (wide)
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{button}</PopoverTrigger>
        <PopoverContent
          align="start"
          aria-label="날짜 달력"
          className="w-[340px] max-w-[calc(100vw-2rem)] gap-0 p-4 motion-reduce:animate-none motion-reduce:transition-none"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={restoreFocus}
        >
          {calendar}
        </PopoverContent>
      </Popover>
    );
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{button}</SheetTrigger>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="max-h-[90dvh] overflow-y-auto rounded-t-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={restoreFocus}
      >
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-2 flex items-center justify-between">
            <SheetTitle>날짜 고르기</SheetTitle>
            <SheetClose asChild>
              <Button variant="ghost" size="icon" aria-label="날짜 달력 닫기">
                <X aria-hidden="true" />
              </Button>
            </SheetClose>
          </div>
          <SheetDescription className="sr-only">
            오늘부터 60일 안의 날짜를 골라 주세요.
          </SheetDescription>
          {calendar}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DatePickerCalendar({
  branchId,
  floorId,
  spaceId,
  view,
  date,
  today,
  timezone,
  openHours,
  bookingDates,
  onSelect,
}: FloorDatePickerProps & { onSelect: () => void }) {
  const [month, setMonth] = useState(date.slice(0, 7));
  const calendarId = useId();
  const [focusedDate, setFocusedDate] = useState(date);
  const links = useRef(new Map<string, HTMLAnchorElement>());
  const focusRequested = useRef(true);
  const navigation = useFloorSelection();
  const lastDate = addDays(today, 60);
  const parsed = parseCalendarMonth(month);
  const grid = buildMonthGrid(parsed.year, parsed.month);
  const label = `${parsed.year}년 ${parsed.month}월`;
  useEffect(() => {
    if (focusRequested.current) {
      links.current.get(focusedDate)?.focus();
      focusRequested.current = false;
    }
  }, [focusedDate, month]);
  const href = (value: string) =>
    floorHref(branchId, floorId, value, spaceId, view);
  const choose = (event: MouseEvent<HTMLAnchorElement>, value: string) => {
    if (!shouldInterceptNavigation(event)) return;
    onSelect();
    if (navigation) {
      event.preventDefault();
      navigation.change(
        { floorId, date: value, spaceId: spaceId ?? null },
        href(value),
      );
    }
  };
  function changeMonth(offset: number) {
    const next = shiftCalendarMonth(month, offset);
    const firstDate = `${next}-01`;
    setMonth(next);
    setFocusedDate(firstDate < today ? today : firstDate);
  }
  return (
    <>
      <div className="mb-2 flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon"
          aria-label="이전 달"
          disabled={month <= today.slice(0, 7)}
          onClick={() => changeMonth(-1)}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <h2 className="font-semibold tabular-nums" aria-live="polite">
          {label}
        </h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label="다음 달"
          disabled={month >= lastDate.slice(0, 7)}
          onClick={() => changeMonth(1)}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
      <MonthGrid
        month={grid}
        label={`${label} 날짜 선택`}
        onDayKeyDown={(event, day) => {
          if (!isCalendarArrowKey(event.key)) return;
          event.preventDefault();
          const next = moveCalendarDate(day.date, event.key, {
            minDate: today,
            maxDate: lastDate,
            month,
            allowMonthChange: true,
          });
          focusRequested.current = true;
          setMonth(next.slice(0, 7));
          setFocusedDate(next);
          if (next === focusedDate) {
            links.current.get(next)?.focus();
            focusRequested.current = false;
          }
        }}
        renderDay={(day) => {
          const state = getCalendarDayState(day.date, {
            today,
            minDate: today,
            maxDate: lastDate,
            selectedDate: date,
            openHours,
          });
          const name = [
            formatBookingDate(day.date, timezone),
            state.today && "오늘",
            state.closed && "쉬는 날",
          ]
            .filter(Boolean)
            .join(", ");
          const content = (
            <>
              <span id={`${calendarId}-${day.date}-label`} className="sr-only">
                {name}
              </span>
              <span>{day.day}</span>
              {state.closed && (
                <span className="text-[10px] leading-none">쉼</span>
              )}
              <span id={`${calendarId}-${day.date}-booking`}>
                <Suspense fallback={null}>
                  <BookingDateMark source={bookingDates} date={day.date} />
                </Suspense>
              </span>
            </>
          );
          const className = cn(
            "flex min-h-11 w-full flex-col items-center justify-center gap-0.5 rounded-lg border border-transparent text-sm tabular-nums",
            (!day.inMonth || state.closed) && "text-muted-foreground",
            state.today && "border-primary",
            state.selected && "bg-accent font-semibold text-accent-foreground",
          );
          if (state.outsideRange)
            return (
              <span
                aria-labelledby={`${calendarId}-${day.date}-label ${calendarId}-${day.date}-booking`}
                aria-disabled="true"
                className={cn(className, "opacity-35")}
              >
                {content}
              </span>
            );
          return (
            <Link
              href={href(day.date)}
              aria-labelledby={`${calendarId}-${day.date}-label ${calendarId}-${day.date}-booking`}
              aria-current={state.selected ? "date" : undefined}
              tabIndex={day.date === focusedDate ? 0 : -1}
              className={cn(
                className,
                "hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              )}
              ref={(element) => {
                if (element) links.current.set(day.date, element);
                else links.current.delete(day.date);
              }}
              onFocus={() => setFocusedDate(day.date)}
              onClick={(event) => choose(event, day.date)}
            >
              {content}
            </Link>
          );
        }}
      />
      <div className="mt-3 flex items-center justify-between border-t border-border pt-2">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-primary"
          />
          <Suspense
            fallback={<span role="status">예약 표시를 불러오고 있어요</span>}
          >
            <BookingDateLegend source={bookingDates} />
          </Suspense>
        </p>
        <Button asChild variant="ghost">
          <Link href={href(today)} onClick={(event) => choose(event, today)}>
            오늘
          </Link>
        </Button>
      </div>
    </>
  );
}

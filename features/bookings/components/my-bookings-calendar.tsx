"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "cn";
import { BookingChip } from "@/components/booking-chip";
import { MonthGrid } from "@/components/calendar/month-grid";
import { PageContainer, PageHeading } from "@/components/page-container";
import { SpacePhoto } from "@/components/photos/space-photo";
import {
  shouldInterceptNavigation,
  useOptimisticNavigation,
  type NavigateAction,
} from "@/components/optimistic-navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { bookingChipKind } from "@/features/bookings/booking-chip-state";
import {
  myBookingsCalendarHref,
  normalizeMyBookingsMonth,
} from "@/features/bookings/calendar";
import {
  floorHref,
  formatBookingDate,
  formatBookingTime,
  relativeBookingStatus,
} from "@/features/bookings/format";
import type {
  MyCalendarBooking,
  MyBookingsMonthData,
} from "@/features/bookings/types";
import {
  buildMonthGrid,
  calendarWeekdayLabels,
  isCalendarArrowKey,
  moveCalendarDate,
  parseCalendarMonth,
  type CalendarDay,
} from "@/lib/calendar/month";
import { addDays } from "@/lib/time/zoned";
import { CancelBookingButton } from "./cancel-booking-button";
import { MyBookingsCalendarBodySkeleton } from "./my-bookings-calendar-skeleton";
import { MyBookingsViewLinks } from "./my-bookings-view-links";

export function MyBookingCalendarDay({
  day,
  bookings,
  now,
  today,
}: {
  day: CalendarDay;
  bookings: MyCalendarBooking[];
  now: string;
  today: string;
}) {
  return (
    <>
      <span
        className={cn(
          "inline-flex size-7 items-center justify-center rounded-full text-sm font-medium",
          day.date === today && "bg-foreground text-background",
        )}
      >
        {day.day}
      </span>
      <span
        data-slot="calendar-booking-chips"
        className="mt-1 hidden space-y-1 md:block"
      >
        {bookings.slice(0, 2).map((booking) => (
          <BookingChip key={booking.id} kind={bookingChipKind(booking, now)}>
            {
              formatBookingTime(
                booking.start,
                booking.end,
                booking.timezone,
              ).split("–")[0]
            }{" "}
            {booking.spaceName}
          </BookingChip>
        ))}
        {bookings.length > 2 && (
          <span className="block px-1 text-xs text-muted-foreground">
            +{bookings.length - 2}건 더
          </span>
        )}
      </span>
      <span
        data-slot="calendar-booking-dots"
        className="mt-1 flex h-1 items-center justify-center gap-1 md:hidden"
      >
        {bookings.slice(0, 3).map((booking) => (
          <span
            key={booking.id}
            aria-hidden="true"
            className={cn(
              "size-1 shrink-0 rounded-full",
              bookingChipKind(booking, now) === "past"
                ? "bg-muted-foreground"
                : bookingChipKind(booking, now) === "ongoing"
                  ? "bg-primary"
                  : "bg-primary/40",
            )}
          />
        ))}
        <span className="sr-only">예약 {bookings.length}건</span>
      </span>
    </>
  );
}

function SelectedDayPanel({
  day,
  data,
}: {
  day: string | null;
  data: MyBookingsMonthData;
}) {
  const bookings = data.bookings
    .filter((booking) => booking.date === day)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const canBook =
    day !== null && day >= data.today && day <= addDays(data.today, 60);
  return (
    <section
      aria-label="선택한 날짜 예약"
      className="space-y-4 self-start rounded-xl border border-border bg-card p-5 shadow-card"
    >
      {day === null ? (
        <p className="text-sm text-muted-foreground">날짜를 골라 주세요</p>
      ) : (
        <>
          <div className="space-y-1">
            {(day === data.today || day === addDays(data.today, 1)) && (
              <p className="text-xs font-medium text-muted-foreground">
                {day === data.today ? "오늘" : "내일"}
              </p>
            )}
            <h2 className="text-lg font-semibold tabular-nums">
              {formatBookingDate(day, data.timezone)}
            </h2>
          </div>
          {bookings.length === 0 ? (
            <p className="py-5 text-sm text-muted-foreground">
              이 날은 예약이 없어요
            </p>
          ) : (
            <ul className="space-y-4">
              {bookings.map((booking) => {
                const kind = bookingChipKind(booking, data.now);
                const status =
                  kind === "past"
                    ? "이용 종료"
                    : relativeBookingStatus(
                        booking.start,
                        booking.end,
                        data.now,
                      );
                return (
                  <li
                    key={booking.id}
                    className="space-y-3 rounded-lg border border-border p-3 has-[[data-cancelling=true]]:opacity-50"
                  >
                    <div className="flex items-start gap-3">
                      <SpacePhoto
                        photo={booking.photo}
                        type={booking.spaceType}
                        decorative
                      />
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-semibold tabular-nums">
                          {formatBookingTime(
                            booking.start,
                            booking.end,
                            booking.timezone,
                          )}
                        </p>
                        <h3 className="text-sm font-semibold">
                          {booking.spaceName}
                        </h3>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {booking.branchName} · {booking.floorName} ·{" "}
                      {booking.teamName ?? "개인"}
                      {booking.title ? ` · ${booking.title}` : ""}
                    </p>
                    {status && (
                      <Badge
                        variant="secondary"
                        className={
                          kind === "ongoing"
                            ? "bg-status-mine text-status-mine-foreground"
                            : undefined
                        }
                      >
                        {status}
                      </Badge>
                    )}
                    {kind !== "past" && (
                      <div className="flex flex-wrap gap-2">
                        <Button asChild variant="outline">
                          <Link
                            href={floorHref(
                              booking.branchId,
                              booking.floorId,
                              booking.date,
                              booking.spaceId,
                            )}
                          >
                            공간 보기
                          </Link>
                        </Button>
                        {booking.canCancel && (
                          <CancelBookingButton
                            bookingId={booking.id}
                            triggerLabel="예약 취소"
                          />
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {canBook && (
            <Button asChild className="w-full">
              <Link href={`/booking?date=${day}`}>이 날짜에 예약하기</Link>
            </Button>
          )}
        </>
      )}
    </section>
  );
}

export function MyBookingsCalendar({
  data,
  navigateAction,
}: {
  data: MyBookingsMonthData;
  navigateAction?: NavigateAction;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const navigate = useCallback<NavigateAction>(
    (href) => router.push(href),
    [router],
  );
  const selection = useOptimisticNavigation(
    data.month,
    navigateAction ?? navigate,
  );
  const pending = selection.isPending && selection.value !== data.month;
  const visible = normalizeMyBookingsMonth(
    { month: selection.value },
    data.today,
  );
  const parsed = parseCalendarMonth(visible.month);
  const month = buildMonthGrid(parsed.year, parsed.month);
  const searchKey = search.toString();
  const requestedDay = search.getAll("day");
  const normalizedDay = normalizeMyBookingsMonth(
    {
      month: data.month,
      day: requestedDay.length === 1 ? requestedDay[0] : undefined,
    },
    data.today,
  ).day;
  const [localDay, setLocalDay] = useState<{
    searchKey: string;
    month: string;
    day: string;
  } | null>(null);
  if (
    localDay &&
    (localDay.searchKey !== searchKey || localDay.month !== data.month)
  )
    setLocalDay(null);
  const selectedDay =
    localDay?.searchKey === searchKey && localDay.month === data.month
      ? localDay.day
      : normalizedDay;
  const [focus, setFocus] = useState<{ month: string; day: string }>({
    month: data.month,
    day: data.day ?? `${data.month}-01`,
  });
  const focusDay =
    focus.month === data.month ? focus.day : (selectedDay ?? month.firstDate);
  const links = useRef(new Map<string, HTMLAnchorElement>());
  const byDay = new Map<string, MyCalendarBooking[]>();
  for (const booking of data.bookings) {
    const list = byDay.get(booking.date) ?? [];
    list.push(booking);
    byDay.set(booking.date, list);
  }
  for (const list of byDay.values())
    list.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  function chooseDay(day: string) {
    setLocalDay({ searchKey, month: data.month, day });
    setFocus({ month: data.month, day });
    window.history.pushState(null, "", myBookingsCalendarHref(data.month, day));
  }
  return (
    <PageContainer as="main" width="wide" className="space-y-6">
      <PageHeading
        title="내 예약"
        description={`${parseCalendarMonth(data.month).month}월 예약 ${data.bookings.length}건`}
        action={
          <Button asChild>
            <Link href="/booking">공간 예약하기</Link>
          </Button>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MyBookingsViewLinks view="calendar" />
        <nav
          aria-label="예약 달 이동"
          className="flex flex-wrap items-center gap-2"
        >
          <Button asChild variant="outline">
            <a
              href={myBookingsCalendarHref(data.today.slice(0, 7), data.today)}
              onClick={(event) => {
                if (!shouldInterceptNavigation(event)) return;
                event.preventDefault();
                if (data.month === data.today.slice(0, 7) && !pending)
                  chooseDay(data.today);
                else
                  selection.change(
                    data.today.slice(0, 7),
                    myBookingsCalendarHref(data.today.slice(0, 7), data.today),
                  );
              }}
            >
              오늘
            </a>
          </Button>
          {visible.previousHref ? (
            <Button asChild variant="ghost" size="icon">
              <a
                aria-label="이전 달"
                href={visible.previousHref}
                onClick={(event) => {
                  if (!shouldInterceptNavigation(event)) return;
                  event.preventDefault();
                  selection.change(
                    visible.previousMonth!,
                    visible.previousHref!,
                  );
                }}
              >
                <ChevronLeft />
              </a>
            </Button>
          ) : (
            <Button variant="ghost" size="icon" aria-label="이전 달" disabled>
              <ChevronLeft />
            </Button>
          )}
          <h2 className="min-w-36 text-center text-lg font-semibold tabular-nums">
            {parsed.year}년 {parsed.month}월
          </h2>
          {visible.nextHref ? (
            <Button asChild variant="ghost" size="icon">
              <a
                aria-label="다음 달"
                href={visible.nextHref}
                onClick={(event) => {
                  if (!shouldInterceptNavigation(event)) return;
                  event.preventDefault();
                  selection.change(visible.nextMonth!, visible.nextHref!);
                }}
              >
                <ChevronRight />
              </a>
            </Button>
          ) : (
            <Button variant="ghost" size="icon" aria-label="다음 달" disabled>
              <ChevronRight />
            </Button>
          )}
        </nav>
      </div>
      {pending ? (
        <MyBookingsCalendarBodySkeleton month={visible.month} />
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <MonthGrid
            month={month}
            label={`${parsed.year}년 ${parsed.month}월 내 예약`}
            className="overflow-hidden rounded-xl border border-border bg-card shadow-card"
            cellClassName="border-t border-r border-border last:border-r-0"
            onDayKeyDown={(event, day) => {
              if (!isCalendarArrowKey(event.key) || !day.inMonth) return;
              event.preventDefault();
              const next = moveCalendarDate(day.date, event.key, {
                month: month.month,
                minDate: month.firstDate,
                maxDate: month.lastDate,
                allowMonthChange: false,
              });
              setFocus({ month: data.month, day: next });
              links.current.get(next)?.focus();
            }}
            renderDay={(day) => {
              if (!day.inMonth)
                return (
                  <span className="flex h-11 items-center justify-center p-1 text-sm text-muted-foreground opacity-40 md:block md:h-auto md:min-h-28 md:p-2">
                    {day.day}
                  </span>
                );
              const bookings = byDay.get(day.date) ?? [];
              return (
                <a
                  ref={(element) => {
                    if (element) links.current.set(day.date, element);
                    else links.current.delete(day.date);
                  }}
                  href={myBookingsCalendarHref(data.month, day.date)}
                  aria-label={`${parsed.month}월 ${day.day}일 ${calendarWeekdayLabels[day.weekday]}, 예약 ${bookings.length}건`}
                  aria-current={selectedDay === day.date ? "date" : undefined}
                  tabIndex={focusDay === day.date ? 0 : -1}
                  className={cn(
                    "flex h-11 flex-col items-center px-2 py-1 focus-visible:relative focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring md:block md:h-auto md:min-h-28 md:p-2",
                    selectedDay === day.date &&
                      "bg-accent ring-1 ring-primary ring-inset",
                  )}
                  onFocus={() => setFocus({ month: data.month, day: day.date })}
                  onClick={(event) => {
                    if (!shouldInterceptNavigation(event)) return;
                    event.preventDefault();
                    chooseDay(day.date);
                  }}
                >
                  <MyBookingCalendarDay
                    day={day}
                    bookings={bookings}
                    now={data.now}
                    today={data.today}
                  />
                </a>
              );
            }}
          />
          <SelectedDayPanel day={selectedDay} data={data} />
        </div>
      )}
    </PageContainer>
  );
}

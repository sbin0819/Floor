"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "cn";
import { MonthGrid } from "@/components/calendar/month-grid";
import { PageContainer, PageHeading } from "@/components/page-container";
import {
  shouldInterceptNavigation,
  useOptimisticNavigation,
  type NavigateAction,
} from "@/components/optimistic-navigation";
import { Button } from "@/components/ui/button";
import {
  myBookingsCalendarHref,
  normalizeMyBookingsMonth,
} from "@/features/bookings/calendar";
import type {
  MyBookingsMonthData,
  MyBookingsMonthMeta,
  MyBookingsMonthStream,
} from "@/features/bookings/types";
import {
  buildMonthGrid,
  calendarWeekdayLabels,
  isCalendarArrowKey,
  moveCalendarDate,
  parseCalendarMonth,
} from "@/lib/calendar/month";
import {
  CalendarBookingData,
  type CalendarBookings,
} from "./my-bookings-calendar-data";
import {
  CalendarDayNumber,
  CalendarDayBookings,
  CalendarDayBookingsPending,
} from "./my-bookings-calendar-day";
import { SelectedDayPanel } from "./my-bookings-calendar-panel";
import { MyBookingsCalendarToolbar } from "./my-bookings-calendar-toolbar";

export { MyBookingCalendarDay } from "./my-bookings-calendar-day";

type DaySelection = { month: string; day: string };

function isCalendarRoute(
  pathname: string,
  search: Pick<URLSearchParams, "get" | "getAll">,
) {
  return (
    pathname.replace(/\/$/, "") === "/bookings" &&
    search.getAll("view").length === 1 &&
    search.get("view") === "calendar"
  );
}

function CalendarView({
  meta,
  bookings,
  navigateAction,
}: {
  meta: MyBookingsMonthMeta;
  bookings: Exclude<CalendarBookings, null>;
  navigateAction?: NavigateAction;
}) {
  const id = useId();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const routeActive = isCalendarRoute(pathname, search);
  const navigate = useCallback<NavigateAction>(
    (href) => router.push(href),
    [router],
  );
  const selection = useOptimisticNavigation(
    meta.month,
    navigateAction ?? navigate,
  );
  const visible = normalizeMyBookingsMonth(
    { month: selection.value },
    meta.today,
  );
  const parsed = parseCalendarMonth(visible.month);
  const month = buildMonthGrid(parsed.year, parsed.month);
  const source = visible.month === meta.month ? bookings : null;
  const searchKey = search.toString();
  const requestedDay = search.getAll("day");
  const normalizedDay = normalizeMyBookingsMonth(
    {
      month: visible.month,
      day: requestedDay.length === 1 ? requestedDay[0] : undefined,
    },
    meta.today,
  ).day;
  const [localDay, setLocalDay] = useState<
    (DaySelection & { searchKey: string }) | null
  >(null);
  const [queuedDay, setQueuedDay] = useState<DaySelection | null>(null);
  const appliedDay = useRef<DaySelection | null>(null);
  if (
    localDay &&
    (!routeActive ||
      localDay.searchKey !== searchKey ||
      localDay.month !== visible.month)
  )
    setLocalDay(null);
  if (
    queuedDay &&
    (!routeActive ||
      (!selection.isPending &&
        meta.month === queuedDay.month &&
        (search.getAll("month").length !== 1 ||
          search.get("month") !== queuedDay.month ||
          (requestedDay.length === 1 && requestedDay[0] === queuedDay.day))))
  )
    setQueuedDay(null);
  const selectedDay =
    queuedDay?.month === visible.month
      ? queuedDay.day
      : localDay?.searchKey === searchKey && localDay.month === visible.month
        ? localDay.day
        : normalizedDay;
  const [focus, setFocus] = useState<DaySelection>({
    month: meta.month,
    day: meta.day ?? `${meta.month}-01`,
  });
  const focusDay =
    focus.month === visible.month
      ? focus.day
      : (selectedDay ?? month.firstDate);
  const links = useRef(new Map<string, HTMLAnchorElement>());

  useLayoutEffect(
    () => () => {
      // 숨겨진 달력의 이전 선택이 Activity 복귀 때 주소를 덮어쓰지 않는다.
      setQueuedDay(null);
      setLocalDay(null);
    },
    [],
  );
  useEffect(() => {
    if (
      !routeActive ||
      selection.isPending ||
      !queuedDay ||
      meta.month !== queuedDay.month ||
      appliedDay.current === queuedDay
    )
      return;
    const current = new URL(window.location.href);
    if (
      !isCalendarRoute(current.pathname, current.searchParams) ||
      current.searchParams.getAll("month").length !== 1 ||
      current.searchParams.get("month") !== queuedDay.month
    )
      return;
    // 진행 중인 라우터 이동을 native history가 취소하지 않도록 마지막 날짜만 합친다.
    appliedDay.current = queuedDay;
    window.history.pushState(
      null,
      "",
      myBookingsCalendarHref(queuedDay.month, queuedDay.day),
    );
  }, [routeActive, selection.isPending, queuedDay, meta.month]);
  useEffect(() => {
    const restore = () => {
      setQueuedDay(null);
      setLocalDay(null);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  function chooseDay(day: string) {
    const current = new URL(window.location.href);
    if (!isCalendarRoute(current.pathname, current.searchParams)) return;
    const next = { month: visible.month, day };
    setFocus(next);
    if (selection.isPending) {
      setQueuedDay(next);
      return;
    }
    setLocalDay({ ...next, searchKey });
    window.history.pushState(null, "", myBookingsCalendarHref(next.month, day));
  }
  function changeMonth(next: string, href: string) {
    const current = new URL(window.location.href);
    if (!isCalendarRoute(current.pathname, current.searchParams)) return;
    setQueuedDay(null);
    setLocalDay(null);
    selection.change(next, href);
  }
  const visibleMeta = { ...meta, ...visible };
  return (
    <PageContainer as="main" width="wide" className="space-y-6">
      <PageHeading
        title="내 예약"
        description={
          <CalendarBookingData
            source={source}
            fallback={
              <span aria-busy="true">
                <span role="status" className="sr-only">
                  예약을 불러오고 있어요.
                </span>
                <span
                  aria-hidden="true"
                  className="inline-block h-5 w-32 animate-pulse rounded-md bg-muted motion-reduce:animate-none"
                />
              </span>
            }
          >
            {(items) => `${parsed.month}월 예약 ${items.length}건`}
          </CalendarBookingData>
        }
        action={
          <Button asChild>
            <Link href="/booking">공간 예약하기</Link>
          </Button>
        }
      />
      <MyBookingsCalendarToolbar
        selection={visible}
        onMonthChange={changeMonth}
        onToday={() => {
          if (visible.month === meta.today.slice(0, 7)) chooseDay(meta.today);
          else
            changeMonth(
              meta.today.slice(0, 7),
              myBookingsCalendarHref(meta.today.slice(0, 7), meta.today),
            );
        }}
      />
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
            setFocus({ month: visible.month, day: next });
            links.current.get(next)?.focus();
          }}
          renderDay={(day) => {
            if (!day.inMonth)
              return (
                <span className="flex h-11 items-center justify-center p-1 text-sm text-muted-foreground opacity-40 md:block md:h-auto md:min-h-28 md:p-2">
                  {day.day}
                </span>
              );
            const dateId = `${id}-${day.date}-date`;
            const countId = `${id}-${day.date}-count`;
            return (
              <a
                key={day.date}
                ref={(element) => {
                  if (element) links.current.set(day.date, element);
                  else links.current.delete(day.date);
                }}
                href={myBookingsCalendarHref(visible.month, day.date)}
                aria-labelledby={`${dateId} ${countId}`}
                aria-current={selectedDay === day.date ? "date" : undefined}
                tabIndex={focusDay === day.date ? 0 : -1}
                className={cn(
                  "flex h-11 flex-col items-center px-2 py-1 focus-visible:relative focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring md:block md:h-auto md:min-h-28 md:p-2",
                  selectedDay === day.date &&
                    "bg-accent ring-1 ring-primary ring-inset",
                )}
                onFocus={() =>
                  setFocus({ month: visible.month, day: day.date })
                }
                onClick={(event) => {
                  if (!shouldInterceptNavigation(event)) return;
                  event.preventDefault();
                  chooseDay(day.date);
                }}
              >
                <span id={dateId} className="sr-only">
                  {parsed.month}월 {day.day}일{" "}
                  {calendarWeekdayLabels[day.weekday]},
                </span>
                <CalendarDayNumber day={day} today={meta.today} />
                <CalendarBookingData
                  source={source}
                  fallback={<CalendarDayBookingsPending labelId={countId} />}
                >
                  {(items) => (
                    <CalendarDayBookings
                      labelId={countId}
                      now={meta.now}
                      bookings={items
                        .filter((booking) => booking.date === day.date)
                        .sort(
                          (a, b) => Date.parse(a.start) - Date.parse(b.start),
                        )}
                    />
                  )}
                </CalendarBookingData>
              </a>
            );
          }}
        />
        <SelectedDayPanel
          day={selectedDay}
          meta={visibleMeta}
          source={source}
        />
      </div>
    </PageContainer>
  );
}

export function StreamingMyBookingsCalendar({
  meta,
  bookings,
  navigateAction,
}: MyBookingsMonthStream & { navigateAction?: NavigateAction }) {
  return (
    <CalendarView
      meta={meta}
      bookings={bookings}
      navigateAction={navigateAction}
    />
  );
}

export function MyBookingsCalendar({
  data,
  navigateAction,
}: {
  data: MyBookingsMonthData;
  navigateAction?: NavigateAction;
}) {
  return (
    <CalendarView
      meta={data}
      bookings={data.bookings}
      navigateAction={navigateAction}
    />
  );
}

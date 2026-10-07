import { parseCalendarMonth, shiftCalendarMonth } from "@/lib/calendar/month";
import { addDays } from "@/lib/time/zoned";

export type MyBookingsMonthInput = { month?: unknown; day?: unknown };
export type MyBookingsMonthSelection = {
  month: string;
  day: string | null;
  today: string;
  minMonth: string;
  maxMonth: string;
  previousMonth: string | null;
  nextMonth: string | null;
  previousHref: string | null;
  nextHref: string | null;
};

export function myBookingsCalendarHref(month: string, day?: string | null) {
  const query = new URLSearchParams({ view: "calendar", month });
  if (day) query.set("day", day);
  return `/bookings?${query}`;
}

function validMonth(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    parseCalendarMonth(value);
    return true;
  } catch {
    return false;
  }
}

function selectedDay(value: unknown, month: string): string | null {
  if (typeof value !== "string" || value.slice(0, 7) !== month) return null;
  try {
    return addDays(value, 0);
  } catch {
    return null;
  }
}

export function normalizeMyBookingsMonth(
  input: MyBookingsMonthInput,
  today: string,
): MyBookingsMonthSelection {
  addDays(today, 0);
  const currentMonth = today.slice(0, 7);
  const minMonth = shiftCalendarMonth(currentMonth, -6);
  const maxMonth = addDays(today, 60).slice(0, 7);
  const month =
    validMonth(input.month) &&
    input.month >= minMonth &&
    input.month <= maxMonth
      ? input.month
      : currentMonth;
  const day =
    selectedDay(input.day, month) ?? (month === currentMonth ? today : null);
  const previousMonth = month > minMonth ? shiftCalendarMonth(month, -1) : null;
  const nextMonth = month < maxMonth ? shiftCalendarMonth(month, 1) : null;
  return {
    month,
    day,
    today,
    minMonth,
    maxMonth,
    previousMonth,
    nextMonth,
    previousHref: previousMonth ? myBookingsCalendarHref(previousMonth) : null,
    nextHref: nextMonth ? myBookingsCalendarHref(nextMonth) : null,
  };
}

export function myBookingsMonthReadRange(month: string) {
  parseCalendarMonth(month);
  const firstDate = `${month}-01`;
  const afterMonth = `${shiftCalendarMonth(month, 1)}-01`;
  // 지점의 UTC 오프셋으로 월이 바뀌는 예약을 빠뜨리지 않고 현지 날짜로 다시 거른다.
  return {
    start: new Date(`${addDays(firstDate, -1)}T00:00:00.000Z`),
    end: new Date(`${addDays(afterMonth, 1)}T00:00:00.000Z`),
  };
}

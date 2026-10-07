import { getOpenHours, type OpenHours } from "@/lib/time/open-hours";
import { addDays, weekday, type DayKey } from "@/lib/time/zoned";

export const calendarWeekdays = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
] as const satisfies readonly DayKey[];

export const calendarWeekdayLabels: Record<DayKey, string> = {
  sun: "일요일",
  mon: "월요일",
  tue: "화요일",
  wed: "수요일",
  thu: "목요일",
  fri: "금요일",
  sat: "토요일",
};

export type CalendarDay = {
  date: string;
  day: number;
  weekday: DayKey;
  inMonth: boolean;
};
export type CalendarMonth = {
  month: string;
  firstDate: string;
  lastDate: string;
  weeks: CalendarDay[][];
};
export type CalendarDateRange = { minDate: string; maxDate: string };
export type CalendarDayState = {
  outsideRange: boolean;
  closed: boolean | null;
  today: boolean;
  selected: boolean;
  marked: boolean;
};
export type CalendarArrowKey =
  "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

function validDate(date: string): string {
  return addDays(date, 0);
}

function validRange({ minDate, maxDate }: CalendarDateRange) {
  validDate(minDate);
  validDate(maxDate);
  if (minDate > maxDate) throw new RangeError("Calendar range is reversed.");
}

function monthKey(year: number, month: number): string {
  if (
    !Number.isInteger(year) ||
    year < 1 ||
    year > 9999 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  )
    throw new RangeError("Expected a valid calendar year and month.");
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

export function parseCalendarMonth(month: string): {
  year: number;
  month: number;
} {
  if (!/^\d{4}-\d{2}$/u.test(month))
    throw new RangeError("Expected a YYYY-MM month.");
  const year = Number(month.slice(0, 4));
  const number = Number(month.slice(5, 7));
  monthKey(year, number);
  return { year, month: number };
}

export function shiftCalendarMonth(month: string, offset: number): string {
  const parsed = parseCalendarMonth(month);
  if (!Number.isSafeInteger(offset))
    throw new RangeError("Month offset must be an integer.");
  const absolute = parsed.year * 12 + parsed.month - 1 + offset;
  return monthKey(Math.floor(absolute / 12), (((absolute % 12) + 12) % 12) + 1);
}

function monthBounds(year: number, month: number) {
  const key = monthKey(year, month);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const length =
    month === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
  return {
    month: key,
    firstDate: `${key}-01`,
    lastDate: `${key}-${length}`,
    length,
  };
}

export function buildMonthGrid(year: number, month: number): CalendarMonth {
  const bounds = monthBounds(year, month);
  const leading = calendarWeekdays.indexOf(weekday(bounds.firstDate));
  const first = addDays(bounds.firstDate, -leading);
  const weekCount = Math.ceil((leading + bounds.length) / 7);
  return {
    month: bounds.month,
    firstDate: bounds.firstDate,
    lastDate: bounds.lastDate,
    weeks: Array.from({ length: weekCount }, (_, weekIndex) =>
      Array.from({ length: 7 }, (_, dayIndex) => {
        const date = addDays(first, weekIndex * 7 + dayIndex);
        return {
          date,
          day: Number(date.slice(8, 10)),
          weekday: calendarWeekdays[dayIndex]!,
          inMonth: date.slice(0, 7) === bounds.month,
        };
      }),
    ),
  };
}

export function getCalendarDayState(
  date: string,
  options: CalendarDateRange & {
    today: string;
    selectedDate?: string | null;
    markedDates?: ReadonlySet<string>;
    openHours?: OpenHours;
  },
): CalendarDayState {
  validDate(date);
  validDate(options.today);
  if (options.selectedDate !== undefined && options.selectedDate !== null)
    validDate(options.selectedDate);
  validRange(options);
  return {
    outsideRange: date < options.minDate || date > options.maxDate,
    closed:
      options.openHours === undefined
        ? null
        : getOpenHours(options.openHours, date) === null,
    today: date === options.today,
    selected: date === options.selectedDate,
    marked: options.markedDates?.has(date) ?? false,
  };
}

export function isCalendarArrowKey(key: string): key is CalendarArrowKey {
  return ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key);
}

export function moveCalendarDate(
  date: string,
  key: CalendarArrowKey,
  options: CalendarDateRange & { month: string; allowMonthChange: boolean },
): string {
  validDate(date);
  validRange(options);
  const parsed = parseCalendarMonth(options.month);
  const bounds = monthBounds(parsed.year, parsed.month);
  const first = options.allowMonthChange
    ? options.minDate
    : options.minDate > bounds.firstDate
      ? options.minDate
      : bounds.firstDate;
  const last = options.allowMonthChange
    ? options.maxDate
    : options.maxDate < bounds.lastDate
      ? options.maxDate
      : bounds.lastDate;
  if (first > last)
    throw new RangeError("Calendar month does not intersect the date range.");
  const movement: Record<CalendarArrowKey, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -7,
    ArrowDown: 7,
  };
  const candidate = addDays(date, movement[key]);
  return candidate < first ? first : candidate > last ? last : candidate;
}

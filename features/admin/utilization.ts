import { getOpenHours, type OpenHours } from "@/lib/time/open-hours";
import {
  addDays,
  dayKeys,
  localDate,
  weekday,
  zonedDateTime,
} from "@/lib/time/zoned";
import type { DashboardPeriod, DashboardRange } from "./dashboard-types";

export type UtilizationRange = { start: string; end: string };
export type UtilizationMinutes = {
  bookedMinutes: number;
  operatingMinutes: number;
};

export function dashboardPeriod(
  date: string,
  range: DashboardRange,
): DashboardPeriod {
  const start =
    range === "week"
      ? addDays(date, -dayKeys.indexOf(weekday(date)))
      : range === "30days"
        ? addDays(date, -29)
        : date;
  const days = range === "week" ? 7 : range === "30days" ? 30 : 1;
  const end = addDays(start, days);
  const previousStart = addDays(start, range === "day" ? -7 : -days);
  return {
    start,
    end,
    previousStart,
    previousEnd: addDays(previousStart, days),
  };
}

export function normalizeDashboardDate(
  value: unknown,
  now: Date,
  timezone: string,
): string {
  if (typeof value === "string") {
    try {
      addDays(value, -60);
      addDays(value, 8);
      return value;
    } catch {
      /* 주소의 잘못된 날짜는 지점의 오늘로 돌아간다. */
    }
  }
  return localDate(now, timezone);
}

export function dashboardOpenRanges(
  start: string,
  end: string,
  timezone: string,
  hours: OpenHours,
): UtilizationRange[] {
  const result: UtilizationRange[] = [];
  for (let date = start; date < end; date = addDays(date, 1)) {
    const open = getOpenHours(hours, date);
    if (!open) continue;
    const from = zonedDateTime(date, open.open, timezone);
    const until = zonedDateTime(date, open.close, timezone);
    if (from < until)
      result.push({ start: from.toISOString(), end: until.toISOString() });
  }
  return result;
}

type Interval = readonly [number, number];
function union(ranges: readonly UtilizationRange[]): Interval[] {
  const result: [number, number][] = [];
  for (const [start, end] of ranges
    .map(({ start, end }) => [Date.parse(start), Date.parse(end)] as const)
    .sort((a, b) => a[0] - b[0])) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end)
      continue;
    const last = result.at(-1);
    if (last && last[1] >= start) last[1] = Math.max(last[1], end);
    else result.push([start, end]);
  }
  return result;
}
function subtract(
  ranges: readonly Interval[],
  blocks: readonly Interval[],
): Interval[] {
  return ranges.flatMap(([start, end]) => {
    const result: Interval[] = [];
    let cursor = start;
    for (const [from, until] of blocks) {
      if (until <= cursor || from >= end) continue;
      if (from > cursor) result.push([cursor, Math.min(from, end)]);
      cursor = Math.max(cursor, until);
      if (cursor >= end) break;
    }
    if (cursor < end) result.push([cursor, end]);
    return result;
  });
}
export function utilizationOf({
  open,
  bookings,
  blocks,
}: {
  open: readonly UtilizationRange[];
  bookings: readonly UtilizationRange[];
  blocks: readonly UtilizationRange[];
}): UtilizationMinutes & { utilization: number | null } {
  const available = subtract(union(open), union(blocks));
  const reserved = union(bookings);
  const operatingMinutes = available.reduce(
    (sum, [start, end]) => sum + (end - start) / 60_000,
    0,
  );
  const bookedMinutes = available.reduce(
    (sum, [start, end]) =>
      sum +
      reserved.reduce(
        (value, [from, until]) =>
          value +
          Math.max(0, Math.min(end, until) - Math.max(start, from)) / 60_000,
        0,
      ),
    0,
  );
  return {
    operatingMinutes,
    bookedMinutes,
    utilization: utilizationRatio({ bookedMinutes, operatingMinutes }),
  };
}
export function utilizationRatio({
  bookedMinutes,
  operatingMinutes,
}: UtilizationMinutes): number | null {
  return operatingMinutes > 0
    ? Math.max(0, Math.min(1, bookedMinutes / operatingMinutes))
    : null;
}
export function combinedUtilization(
  values: readonly UtilizationMinutes[],
): number | null {
  return utilizationRatio(
    values.reduce(
      (sum, value) => ({
        bookedMinutes: sum.bookedMinutes + value.bookedMinutes,
        operatingMinutes: sum.operatingMinutes + value.operatingMinutes,
      }),
      { bookedMinutes: 0, operatingMinutes: 0 },
    ),
  );
}

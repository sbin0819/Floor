import { getSpaceStatus } from "@/features/bookings/status";
import type { OperatingWindow } from "@/features/bookings/operating-state";
import { formatBookingTime } from "@/features/bookings/format";
import {
  localDate,
  localTime,
  timeToMinutes,
  zonedDateTime,
} from "@/lib/time/zoned";

export type AvailabilityKind = "other" | "mine" | "maintenance";
export type AvailabilityInterval = {
  start: string;
  end: string;
  kind: AvailabilityKind;
};
type SourceRange = { start: Date; end: Date };
export type AvailabilityInput = {
  window: OperatingWindow | null;
  bookings: readonly (SourceRange & {
    userId: string;
    teamId: string | null;
  })[];
  blocks: readonly SourceRange[];
  userId: string;
  teamIds: readonly string[];
};
export type AvailabilitySummary =
  | { status: "free" | "mine" | "maintenance"; until: string }
  | { status: "busy"; availableAt: string | null }
  | { status: "outside_hours" };

type NumericRange = { start: number; end: number };
type NumericInterval = NumericRange & { kind: AvailabilityKind };

function validRange(start: number, end: number): NumericRange {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end)
    throw new RangeError("Expected a finite, non-empty time range.");
  return { start, end };
}

function numericWindow(window: OperatingWindow): NumericRange {
  return validRange(Date.parse(window.start), Date.parse(window.end));
}

function mergeRanges(ranges: readonly NumericRange[]): NumericRange[] {
  const result: NumericRange[] = [];
  for (const range of [...ranges].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  )) {
    const previous = result.at(-1);
    if (previous && range.start <= previous.end)
      previous.end = Math.max(previous.end, range.end);
    else result.push({ ...range });
  }
  return result;
}

function sourceIntervals(input: AvailabilityInput): NumericInterval[] {
  const teamIds = new Set(input.teamIds);
  return [
    ...input.bookings.map((booking): NumericInterval => ({
      ...validRange(booking.start.getTime(), booking.end.getTime()),
      kind:
        booking.userId === input.userId ||
        (booking.teamId !== null && teamIds.has(booking.teamId))
          ? "mine"
          : "other",
    })),
    ...input.blocks.map((block): NumericInterval => ({
      ...validRange(block.start.getTime(), block.end.getTime()),
      kind: "maintenance",
    })),
  ];
}

function mergeKinds(intervals: readonly NumericInterval[]): NumericInterval[] {
  return (["other", "mine", "maintenance"] as const)
    .flatMap((kind) =>
      mergeRanges(intervals.filter((interval) => interval.kind === kind)).map(
        (range) => ({ ...range, kind }),
      ),
    )
    .sort(
      (a, b) =>
        a.start - b.start || a.end - b.end || a.kind.localeCompare(b.kind),
    );
}

export function buildAvailabilityIntervals(
  input: AvailabilityInput,
): AvailabilityInterval[] {
  if (!input.window) return [];
  const window = numericWindow(input.window);
  return mergeKinds(sourceIntervals(input)).flatMap((interval) => {
    const start = Math.max(interval.start, window.start);
    const end = Math.min(interval.end, window.end);
    return start < end
      ? [
          {
            start: new Date(start).toISOString(),
            end: new Date(end).toISOString(),
            kind: interval.kind,
          },
        ]
      : [];
  });
}

/** 평면도는 영업 구간 밖까지 이어지는 점검의 실제 종료 시각도 보여준다. */
export function buildPlanIntervals(
  input: AvailabilityInput,
): AvailabilityInterval[] {
  return mergeKinds(sourceIntervals(input)).map(({ start, end, kind }) => ({
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    kind,
  }));
}

export function getAvailabilitySummary(
  input: AvailabilityInput & { now: Date },
): AvailabilitySummary {
  const current = input.now.getTime();
  if (!Number.isFinite(current))
    throw new RangeError("Invalid current instant.");
  const window = input.window && numericWindow(input.window);
  if (!window || current < window.start || current >= window.end)
    return { status: "outside_hours" };
  const intervals = sourceIntervals(input);
  const status = getSpaceStatus({
    accessible: true,
    now: input.now,
    bookings: [...input.bookings],
    blocks: [...input.blocks],
    userId: input.userId,
    teamIds: [...input.teamIds],
  });
  if (status === "maintenance" || status === "mine") {
    // 요약은 띠에 맞춰 자르기 전의 끝을 사용해 다음 날 점검도 알린다.
    const active = mergeKinds(intervals).find(
      (interval) =>
        interval.kind === status &&
        interval.start <= current &&
        current < interval.end,
    );
    if (!active)
      throw new Error("An active interval must exist for the current status.");
    return { status, until: new Date(active.end).toISOString() };
  }
  if (status === "busy") {
    const occupied = mergeRanges(intervals).find(
      (range) => range.start <= current && current < range.end,
    );
    return {
      status,
      availableAt:
        occupied && occupied.end < window.end
          ? new Date(occupied.end).toISOString()
          : null,
    };
  }
  const next = intervals
    .filter((interval) => interval.start > current)
    .reduce((end, interval) => Math.min(end, interval.start), window.end);
  return { status: "free", until: new Date(next).toISOString() };
}

export function availabilityLabel(
  intervals: readonly AvailabilityInterval[],
  timeZone: string,
): string {
  const labels: Record<AvailabilityKind, string> = {
    other: "예약",
    mine: "내 예약",
    maintenance: "점검",
  };
  return intervals.length === 0
    ? "예약된 시간이 없어요"
    : intervals
        .map(
          (interval) =>
            `${labels[interval.kind]} ${formatBookingTime(interval.start, interval.end, timeZone)}`,
        )
        .join(", ");
}

export function intervalPosition(
  range: OperatingWindow,
  window: OperatingWindow,
): { left: number; width: number } | null {
  const bounds = numericWindow(window);
  const interval = numericWindow(range);
  const start = Math.max(bounds.start, interval.start);
  const end = Math.min(bounds.end, interval.end);
  if (start >= end) return null;
  return {
    left: ((start - bounds.start) / (bounds.end - bounds.start)) * 100,
    width: ((end - start) / (bounds.end - bounds.start)) * 100,
  };
}

export function availabilityCurrentPosition(
  now: string,
  window: OperatingWindow,
): { pastWidth: number; line: number | null } {
  const bounds = numericWindow(window);
  const current = Date.parse(now);
  if (!Number.isFinite(current))
    throw new RangeError("Invalid current instant.");
  const position =
    ((current - bounds.start) / (bounds.end - bounds.start)) * 100;
  return {
    pastWidth: Math.max(0, Math.min(position, 100)),
    line: current >= bounds.start && current < bounds.end ? position : null,
  };
}

export function availabilityTicks(
  window: OperatingWindow,
  timeZone: string,
): { value: string; label: string; position: number }[] {
  const bounds = numericWindow(window);
  const start = new Date(bounds.start);
  const date = localDate(start, timeZone);
  const close = new Date(bounds.end);
  const dayEnd = zonedDateTime(date, "24:00", timeZone).getTime();
  const candidates = [bounds.start];
  const openingMinutes = timeToMinutes(localTime(start, timeZone));
  for (
    let minutes = (Math.floor(openingMinutes / 240) + 1) * 240;
    minutes < 1440;
    minutes += 240
  ) {
    const value = zonedDateTime(
      date,
      `${String(minutes / 60).padStart(2, "0")}:00`,
      timeZone,
    ).getTime();
    if (value > bounds.start && value < bounds.end) candidates.push(value);
  }
  candidates.push(bounds.end);
  return [...new Set(candidates)].map((value) => {
    const clock =
      value === dayEnd
        ? "24:00"
        : localTime(value === bounds.end ? close : new Date(value), timeZone);
    return {
      value: new Date(value).toISOString(),
      label: clock.endsWith(":00") ? clock.slice(0, 2) : clock,
      position: ((value - bounds.start) / (bounds.end - bounds.start)) * 100,
    };
  });
}

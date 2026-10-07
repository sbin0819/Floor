import { customType } from "drizzle-orm/pg-core";

export type TimeRange = { start: Date; end: Date };

function assertRange({ start, end }: TimeRange) {
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    start >= end
  ) {
    throw new Error(
      "A time range must have finite dates and start before end.",
    );
  }
}

export function serializeTimeRange(value: TimeRange): string {
  assertRange(value);
  return `["${value.start.toISOString()}","${value.end.toISOString()}")`;
}

export function parseTimeRange(value: string): TimeRange {
  const match = /^\["?([^",]+)"?,"?([^",]+)"?\)$/.exec(value);
  if (!match?.[1] || !match[2]) {
    throw new Error("Expected a finite [start, end) timestamp range.");
  }
  const range = { start: new Date(match[1]), end: new Date(match[2]) };
  assertRange(range);
  return range;
}

export const tstzrange = customType<{ data: TimeRange; driverData: string }>({
  dataType: () => "tstzrange",
  toDriver: serializeTimeRange,
  fromDriver: parseTimeRange,
});

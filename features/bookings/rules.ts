import { getOpenHours } from "@/lib/time/open-hours";
import {
  addDays,
  localDate,
  localTime,
  SLOT_MINUTES,
  timeToMinutes,
  zonedDateTime,
} from "@/lib/time/zoned";

export type BookingTimeReason =
  | "not_aligned"
  | "not_same_day"
  | "in_past"
  | "outside_hours"
  | "closed_day"
  | "too_short";

export type BookingSlot = {
  start: string;
  end: string;
  label: string;
  endLabel: string;
};

type DayOptions = {
  date: string;
  timeZone: string;
  openHours: unknown;
};

export function bookingDayRange(date: string, timeZone: string) {
  return {
    start: zonedDateTime(date, "00:00", timeZone),
    end: zonedDateTime(date, "24:00", timeZone),
  };
}

export function daysBetweenDates(from: string, to: string): number {
  const first = new Date(`${addDays(from, 0)}T00:00:00Z`).getTime();
  const last = new Date(`${addDays(to, 0)}T00:00:00Z`).getTime();
  return (last - first) / 86_400_000;
}

export function bookingMinutes(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / 60_000;
}

export function currentSlotStart(now: Date, timeZone: string): Date {
  const minutesIntoSlot =
    timeToMinutes(localTime(now, timeZone)) % SLOT_MINUTES;
  // 현지 시각을 다시 해석하면 DST 종료일의 두 번째 01시가 첫 번째로 돌아간다.
  return new Date(
    Math.floor(now.getTime() / 60_000) * 60_000 - minutesIntoSlot * 60_000,
  );
}

function isAligned(instant: Date, timeZone: string): boolean {
  return (
    Number.isFinite(instant.getTime()) &&
    timeToMinutes(localTime(instant, timeZone)) % SLOT_MINUTES === 0 &&
    instant.getUTCSeconds() === 0 &&
    instant.getUTCMilliseconds() === 0
  );
}

export function validateBookingTime({
  start,
  end,
  now,
  timeZone,
  openHours,
}: {
  start: Date;
  end: Date;
  now: Date;
  timeZone: string;
  openHours: unknown;
}): BookingTimeReason | null {
  if (!isAligned(start, timeZone) || !isAligned(end, timeZone))
    return "not_aligned";
  if (bookingMinutes(start, end) < SLOT_MINUTES) return "too_short";
  const date = localDate(start, timeZone);
  if (end > bookingDayRange(date, timeZone).end) return "not_same_day";
  if (start < currentSlotStart(now, timeZone)) return "in_past";
  const hours = getOpenHours(openHours, date);
  if (!hours) return "closed_day";
  if (
    start < zonedDateTime(date, hours.open, timeZone) ||
    end > zonedDateTime(date, hours.close, timeZone)
  )
    return "outside_hours";
  return null;
}

export function createBookingSlots({
  date,
  timeZone,
  openHours,
}: DayOptions): BookingSlot[] {
  const hours = getOpenHours(openHours, date);
  if (!hours) return [];
  const open = zonedDateTime(date, hours.open, timeZone).getTime();
  const close = zonedDateTime(date, hours.close, timeZone).getTime();
  const step = SLOT_MINUTES * 60_000;
  const dayEnd = bookingDayRange(date, timeZone).end.getTime();
  const slots: BookingSlot[] = [];
  for (let cursor = open; cursor + step <= close; cursor += step) {
    const start = new Date(cursor);
    const end = new Date(cursor + step);
    slots.push({
      start: start.toISOString(),
      end: end.toISOString(),
      label: localTime(start, timeZone),
      endLabel: end.getTime() === dayEnd ? "24:00" : localTime(end, timeZone),
    });
  }
  return slots;
}

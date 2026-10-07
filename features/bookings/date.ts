import { addDays, localDate } from "@/lib/time/zoned";
import { daysBetweenDates } from "@/features/bookings/rules";

export function normalizeBookingDateForToday(
  value: unknown,
  today: string,
): string {
  if (typeof value !== "string") return today;
  try {
    return addDays(value, 0) === value &&
      value >= today &&
      value <= addDays(today, 60)
      ? value
      : today;
  } catch {
    return today;
  }
}

export function normalizeBookingDate(
  value: unknown,
  now: Date,
  timeZone: string,
): string {
  return normalizeBookingDateForToday(value, localDate(now, timeZone));
}

export function getBookingDateWindow(today: string, requestedDate: unknown) {
  const selected = normalizeBookingDateForToday(requestedDate, today);
  const offset = daysBetweenDates(today, selected);
  const first = Math.floor(offset / 7) * 7;
  return {
    selected,
    days: Array.from({ length: 7 }, (_, index) => ({
      date: addDays(today, first + index),
      disabled: first + index > 60,
    })),
    previous: first === 0 ? null : addDays(today, Math.max(0, offset - 7)),
    next: first + 6 >= 60 ? null : addDays(today, Math.min(60, offset + 7)),
  };
}

import { addDays, localDate } from "@/lib/time/zoned";

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

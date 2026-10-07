import type { BookingChipKind } from "@/components/booking-chip";

export type { BookingChipKind } from "@/components/booking-chip";

export function bookingChipKind(
  range: { start: string; end: string },
  now: string,
): BookingChipKind {
  const start = Date.parse(range.start);
  const end = Date.parse(range.end);
  const current = Date.parse(now);
  if (![start, end, current].every(Number.isFinite) || start >= end)
    throw new RangeError("Expected a valid reservation and current instant.");
  return current >= end ? "past" : current >= start ? "ongoing" : "upcoming";
}

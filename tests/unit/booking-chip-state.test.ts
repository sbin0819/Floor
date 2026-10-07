import { expect, it } from "vitest";
import { bookingChipKind } from "@/features/bookings/booking-chip-state";

const range = { start: "2026-10-08T01:00:00Z", end: "2026-10-08T02:00:00Z" };
it.each([
  ["2026-10-08T00:59:59.999Z", "upcoming"],
  [range.start, "ongoing"],
  ["2026-10-08T01:59:59.999Z", "ongoing"],
  [range.end, "past"],
  ["2026-10-09T01:00:00Z", "past"],
] as const)(
  "classifies %s with half-open booking boundaries",
  (now, expected) => {
    expect(bookingChipKind(range, now)).toBe(expected);
  },
);
it("compares instants rather than local clock strings across DST", () => {
  expect(
    bookingChipKind(
      { start: "2026-11-01T01:30:00-07:00", end: "2026-11-01T01:30:00-08:00" },
      "2026-11-01T01:00:00-08:00",
    ),
  ).toBe("ongoing");
});
it.each([
  [{ start: "invalid", end: range.end }, range.start],
  [{ start: range.end, end: range.start }, range.start],
  [range, "invalid"],
] as const)("rejects invalid instants or reversed ranges", (booking, now) => {
  expect(() => bookingChipKind(booking, now)).toThrow(RangeError);
});

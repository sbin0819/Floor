import { describe, expect, it } from "vitest";
import {
  myBookingsCalendarHref,
  myBookingsMonthReadRange,
  normalizeMyBookingsMonth,
} from "@/features/bookings/calendar";

const today = "2026-10-07";
describe("my booking calendar normalization", () => {
  it("defaults to today's month and selected date with bounded adjacent links", () => {
    expect(normalizeMyBookingsMonth({}, today)).toEqual({
      month: "2026-10",
      day: today,
      today,
      minMonth: "2026-04",
      maxMonth: "2026-12",
      previousMonth: "2026-09",
      nextMonth: "2026-11",
      previousHref: "/bookings?view=calendar&month=2026-09",
      nextHref: "/bookings?view=calendar&month=2026-11",
    });
  });

  it.each([
    undefined,
    null,
    "",
    202610,
    ["2026-10"],
    "2026-1",
    "2026-00",
    "2026-13",
    "2026-10-01",
    "2026-03",
    "2027-01",
    "0000-10",
  ])("treats invalid or out-of-range month %j as this month", (month) => {
    expect(normalizeMyBookingsMonth({ month }, today)).toMatchObject({
      month: "2026-10",
      day: today,
    });
  });

  it("includes the whole earliest and latest months and disables their outer links", () => {
    expect(
      normalizeMyBookingsMonth({ month: "2026-04", day: "2026-04-01" }, today),
    ).toMatchObject({
      month: "2026-04",
      day: "2026-04-01",
      previousMonth: null,
      previousHref: null,
      nextMonth: "2026-05",
    });
    expect(
      normalizeMyBookingsMonth({ month: "2026-12", day: "2026-12-31" }, today),
    ).toMatchObject({
      month: "2026-12",
      day: "2026-12-31",
      nextMonth: null,
      nextHref: null,
    });
  });

  it("allows a third future month when today is December 31", () => {
    expect(
      normalizeMyBookingsMonth({ month: "2027-03" }, "2026-12-31"),
    ).toMatchObject({
      month: "2027-03",
      day: null,
      minMonth: "2026-06",
      maxMonth: "2027-03",
      nextHref: null,
    });
  });

  it("subtracts six calendar months across a year boundary", () => {
    expect(normalizeMyBookingsMonth({}, "2026-01-31").minMonth).toBe("2025-07");
  });

  it.each([
    undefined,
    null,
    "",
    [today],
    7,
    "2026-09-07",
    "2026-10-32",
    "2026-10-7",
    "bad-date",
  ])(
    "ignores invalid day %j and uses today only in the current month",
    (day) => {
      expect(normalizeMyBookingsMonth({ day }, today).day).toBe(today);
      expect(
        normalizeMyBookingsMonth({ month: "2026-11", day }, today).day,
      ).toBeNull();
    },
  );

  it("keeps past dates and leap days in the chosen month", () => {
    expect(normalizeMyBookingsMonth({ day: "2026-10-01" }, today).day).toBe(
      "2026-10-01",
    );
    expect(
      normalizeMyBookingsMonth(
        { month: "2028-02", day: "2028-02-29" },
        "2028-03-01",
      ).day,
    ).toBe("2028-02-29");
    expect(
      normalizeMyBookingsMonth(
        { month: "2027-02", day: "2027-02-29" },
        "2027-03-01",
      ).day,
    ).toBeNull();
  });

  it("rejects an invalid server-provided today", () => {
    expect(() => normalizeMyBookingsMonth({}, "2026-02-30")).toThrow(
      RangeError,
    );
  });

  it("constructs real calendar URLs with an optional day", () => {
    expect(myBookingsCalendarHref("2026-10", today)).toBe(
      "/bookings?view=calendar&month=2026-10&day=2026-10-07",
    );
    expect(myBookingsCalendarHref("2026-10", null)).toBe(
      "/bookings?view=calendar&month=2026-10",
    );
  });
});

describe("my booking calendar broad UTC read range", () => {
  it.each([
    ["2026-10", "2026-09-30T00:00:00.000Z", "2026-11-02T00:00:00.000Z"],
    ["2028-02", "2028-01-31T00:00:00.000Z", "2028-03-02T00:00:00.000Z"],
    ["2026-12", "2026-11-30T00:00:00.000Z", "2027-01-02T00:00:00.000Z"],
  ])("expands %s by a full UTC day on both sides", (month, start, end) => {
    const result = myBookingsMonthReadRange(month);
    expect(result.start.toISOString()).toBe(start);
    expect(result.end.toISOString()).toBe(end);
  });
});

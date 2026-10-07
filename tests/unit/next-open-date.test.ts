import { describe, expect, it } from "vitest";
import { nextOpenDate } from "@/features/bookings/next-open-date";
import type { OpenHours } from "@/lib/time/open-hours";

const allClosed: OpenHours = {
  mon: null,
  tue: null,
  wed: null,
  thu: null,
  fri: null,
  sat: null,
  sun: null,
};

describe("next open date", () => {
  it("starts after the selected date and uses the existing default operating hours", () => {
    expect(
      nextOpenDate({ date: "2026-10-07", today: "2026-10-07", openHours: {} }),
    ).toBe("2026-10-08");
  });

  it("skips every closed day, including a weekend", () => {
    expect(
      nextOpenDate({
        date: "2026-10-09",
        today: "2026-10-07",
        openHours: { sat: null, sun: null },
      }),
    ).toBe("2026-10-12");
  });

  it("returns null when every day is closed", () => {
    expect(
      nextOpenDate({
        date: "2026-10-07",
        today: "2026-10-07",
        openHours: allClosed,
      }),
    ).toBeNull();
  });

  it("finds the only operating weekday", () => {
    expect(
      nextOpenDate({
        date: "2026-10-07",
        today: "2026-10-07",
        openHours: { ...allClosed, wed: { open: "10:00", close: "24:00" } },
      }),
    ).toBe("2026-10-14");
  });

  it("includes the sixtieth day", () => {
    expect(
      nextOpenDate({ date: "2026-12-05", today: "2026-10-07", openHours: {} }),
    ).toBe("2026-12-06");
  });

  it("does not include the selected date at the end of the window", () => {
    expect(
      nextOpenDate({ date: "2026-12-06", today: "2026-10-07", openHours: {} }),
    ).toBeNull();
  });

  it("returns null if the next opening would be after day sixty", () => {
    expect(
      nextOpenDate({
        date: "2026-12-05",
        today: "2026-10-07",
        openHours: { sun: null },
      }),
    ).toBeNull();
  });

  it("keeps the search ceiling relative to today, not the selected date", () => {
    expect(
      nextOpenDate({
        date: "2026-12-05",
        today: "2026-10-07",
        openHours: { ...allClosed, wed: { open: "09:00", close: "22:00" } },
      }),
    ).toBeNull();
  });

  it("crosses a year boundary without depending on the host timezone", () => {
    expect(
      nextOpenDate({
        date: "2026-12-31",
        today: "2026-12-31",
        openHours: { fri: null, sat: null, sun: null },
      }),
    ).toBe("2027-01-04");
  });

  it.each([
    ["2028-02-28", "2028-02-29"],
    ["2027-02-28", "2027-03-01"],
    ["2026-03-07", "2026-03-08"],
    ["2026-10-31", "2026-11-01"],
  ])("uses calendar dates across leap days and DST: %s", (date, expected) => {
    expect(nextOpenDate({ date, today: date, openHours: {} })).toBe(expected);
  });

  it.each([
    { date: "2026-02-30", today: "2026-02-01" },
    { date: "2026-10-07", today: "bad-date" },
  ])("rejects invalid calendar dates %j", ({ date, today }) => {
    expect(() => nextOpenDate({ date, today, openHours: {} })).toThrow(
      RangeError,
    );
  });
});

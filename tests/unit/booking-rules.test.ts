import { describe, expect, it } from "vitest";
import {
  bookingDayRange,
  bookingMinutes,
  createBookingSlots,
  currentSlotStart,
  daysBetweenDates,
  validateBookingTime,
  type BookingTimeReason,
} from "@/features/bookings/rules";
import { localTime } from "@/lib/time/zoned";

const date = "2026-10-07";
const instant = (time: string) => new Date(`${date}T${time}+09:00`);
const now = instant("10:10:17.500");
const base = { now, timeZone: "Asia/Seoul", openHours: {} };

describe("booking time validation", () => {
  it.each<[string, string, BookingTimeReason | null]>([
    ["10:00:00", "10:30:00", null],
    ["10:30:00", "11:30:00", null],
    ["10:15:00", "11:00:00", "not_aligned"],
    ["10:00:01", "11:00:00", "not_aligned"],
    ["10:00:00.001", "11:00:00", "not_aligned"],
    ["10:00:00", "11:15:00", "not_aligned"],
    ["10:00:00", "10:00:00", "too_short"],
    ["11:00:00", "10:00:00", "too_short"],
    ["09:30:00", "10:30:00", "in_past"],
    ["21:30:00", "22:00:00", null],
    ["21:30:00", "22:30:00", "outside_hours"],
  ])("validates %s–%s as %s", (start, end, expected) => {
    expect(
      validateBookingTime({
        ...base,
        start: instant(start),
        end: instant(end),
      }),
    ).toBe(expected);
  });

  it("rejects invalid instants without throwing", () => {
    expect(
      validateBookingTime({
        ...base,
        start: new Date("invalid"),
        end: instant("11:00:00"),
      }),
    ).toBe("not_aligned");
  });

  it("checks hours for the booking's date and defaults missing weekday keys", () => {
    const earlyNow = instant("07:00:00");
    expect(
      validateBookingTime({
        ...base,
        now: earlyNow,
        start: instant("08:30:00"),
        end: instant("09:30:00"),
      }),
    ).toBe("outside_hours");
    expect(
      validateBookingTime({
        ...base,
        start: instant("10:00:00"),
        end: instant("11:00:00"),
        openHours: { wed: null },
      }),
    ).toBe("closed_day");
    expect(
      validateBookingTime({
        ...base,
        start: instant("10:00:00"),
        end: instant("11:00:00"),
        openHours: { thu: null },
      }),
    ).toBeNull();
  });

  it("allows exactly 24:00 but rejects a booking crossing into the next day's first slot", () => {
    const start = instant("23:30:00");
    const options = {
      ...base,
      openHours: { wed: { open: "00:00", close: "24:00" } },
      start,
    };
    expect(
      validateBookingTime({
        ...options,
        end: new Date("2026-10-08T00:00:00+09:00"),
      }),
    ).toBeNull();
    expect(
      validateBookingTime({
        ...options,
        end: new Date("2026-10-08T00:30:00+09:00"),
      }),
    ).toBe("not_same_day");
  });

  it("keeps the specified validation precedence", () => {
    const closed = { ...base, openHours: { wed: null } };
    expect(
      validateBookingTime({
        ...closed,
        start: instant("09:15:00"),
        end: new Date("2026-10-08T00:30:00+09:00"),
      }),
    ).toBe("not_aligned");
    expect(
      validateBookingTime({
        ...closed,
        start: instant("09:00:00"),
        end: new Date("2026-10-08T00:30:00+09:00"),
      }),
    ).toBe("not_same_day");
    expect(
      validateBookingTime({
        ...closed,
        start: instant("08:00:00"),
        end: instant("09:00:00"),
      }),
    ).toBe("in_past");
    expect(
      validateBookingTime({
        ...closed,
        start: instant("22:30:00"),
        end: instant("23:00:00"),
      }),
    ).toBe("closed_day");
  });

  it("accepts a half-hour spanning the backward DST change", () => {
    const start = new Date("2026-11-01T01:30:00-04:00");
    const end = new Date("2026-11-01T01:00:00-05:00");
    expect(bookingMinutes(start, end)).toBe(30);
    expect(
      validateBookingTime({
        start,
        end,
        now: new Date("2026-11-01T00:00:00-04:00"),
        timeZone: "America/New_York",
        openHours: { sun: { open: "00:00", close: "24:00" } },
      }),
    ).toBeNull();
  });

  it("floors the current instant within the second DST occurrence, not the first", () => {
    const current = new Date("2026-11-01T01:10:59.999-05:00");
    expect(currentSlotStart(current, "America/New_York").toISOString()).toBe(
      "2026-11-01T06:00:00.000Z",
    );
    expect(
      validateBookingTime({
        start: new Date("2026-11-01T01:30:00-04:00"),
        end: new Date("2026-11-01T01:00:00-05:00"),
        now: current,
        timeZone: "America/New_York",
        openHours: { sun: { open: "00:00", close: "24:00" } },
      }),
    ).toBe("in_past");
  });
});

describe("day ranges and slots", () => {
  it("uses the branch calendar rather than elapsed 24-hour periods", () => {
    expect(daysBetweenDates("2026-03-08", "2026-03-09")).toBe(1);
    expect(daysBetweenDates("2026-11-01", "2026-11-02")).toBe(1);
    expect(daysBetweenDates("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetweenDates("2026-10-07", "2026-10-07")).toBe(0);
    expect(() => daysBetweenDates("2026-02-30", "2026-03-01")).toThrow(
      RangeError,
    );
  });

  it("builds default hours and returns no slots for a closed weekday", () => {
    const slots = createBookingSlots({
      date,
      timeZone: "Asia/Seoul",
      openHours: {},
    });
    expect(slots).toHaveLength(26);
    expect(slots[0]).toEqual({
      start: "2026-10-07T00:00:00.000Z",
      end: "2026-10-07T00:30:00.000Z",
      label: "09:00",
      endLabel: "09:30",
    });
    expect(slots.at(-1)?.endLabel).toBe("22:00");
    expect(
      createBookingSlots({
        date,
        timeZone: "Asia/Seoul",
        openHours: { wed: null },
      }),
    ).toEqual([]);
  });

  it.each([
    ["2026-03-08", 23, 46],
    ["2026-11-01", 25, 50],
  ])("builds actual half-hours on DST date %s", (date, hours, count) => {
    const timeZone = "America/New_York";
    const range = bookingDayRange(date, timeZone);
    expect(bookingMinutes(range.start, range.end)).toBe(hours * 60);
    const slots = createBookingSlots({
      date,
      timeZone,
      openHours: { sun: { open: "00:00", close: "24:00" } },
    });
    expect(slots).toHaveLength(count);
    expect(new Set(slots.map(({ start }) => start)).size).toBe(count);
    expect(slots.at(-1)?.endLabel).toBe("24:00");
    for (const slot of slots)
      expect(bookingMinutes(new Date(slot.start), new Date(slot.end))).toBe(30);
  });

  it("omits nonexistent clock times and preserves repeated times with separate ISO identities", () => {
    const options = {
      timeZone: "America/New_York",
      openHours: { sun: { open: "00:00", close: "04:00" } },
    };
    const spring = createBookingSlots({ ...options, date: "2026-03-08" });
    expect(spring.some(({ label }) => label.startsWith("02:"))).toBe(false);
    const fall = createBookingSlots({ ...options, date: "2026-11-01" });
    expect(
      fall.filter(({ label }) => label === "01:30").map(({ start }) => start),
    ).toEqual(["2026-11-01T05:30:00.000Z", "2026-11-01T06:30:00.000Z"]);
  });

  it("starts at the first valid time if operating hours begin inside a DST gap", () => {
    const slots = createBookingSlots({
      date: "2026-03-08",
      timeZone: "America/New_York",
      openHours: { sun: { open: "02:30", close: "04:00" } },
    });
    expect(slots).toHaveLength(2);
    expect(slots[0]?.label).toBe("03:00");
  });

  it("aligns slots to branch minutes even with a quarter-hour offset", () => {
    const timeZone = "Asia/Kathmandu";
    const current = new Date("2026-10-07T04:25:10Z");
    const start = currentSlotStart(current, timeZone);
    expect(localTime(start, timeZone)).toBe("10:00");
    expect(start.toISOString()).toBe("2026-10-07T04:15:00.000Z");
    expect(
      validateBookingTime({
        start,
        end: new Date("2026-10-07T04:45:00Z"),
        now: current,
        timeZone,
        openHours: {},
      }),
    ).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  getOperatingState,
  getOperatingWindow,
} from "@/features/bookings/operating-state";
import { dayKeys } from "@/lib/time/zoned";

const zone = "Asia/Seoul";
const now = (time: string) => new Date(`2026-10-07T${time}:00+09:00`);
const closed = Object.fromEntries(dayKeys.map((key) => [key, null]));

describe("operating state", () => {
  it.each([
    ["08:59", "before_open"],
    ["09:00", "open"],
    ["21:59", "open"],
    ["22:00", "after_close"],
  ])("uses half-open operating boundaries at %s", (time, status) => {
    expect(getOperatingState(now(time), zone, {}).status).toBe(status);
  });

  it("returns the branch-local day independently of the host zone", () => {
    expect(
      getOperatingState(new Date("2026-10-06T15:30:00Z"), zone, {}).date,
    ).toBe("2026-10-07");
    expect(
      getOperatingState(
        new Date("2026-10-07T00:30:00Z"),
        "America/Los_Angeles",
        {},
      ).date,
    ).toBe("2026-10-06");
  });

  it("defaults missing and malformed hours as specified", () => {
    for (const hours of [{}, undefined, { wed: { open: "bad", close: "bad" } }])
      expect(getOperatingWindow("2026-10-07", zone, hours)).toEqual({
        start: "2026-10-07T00:00:00.000Z",
        end: "2026-10-07T13:00:00.000Z",
      });
  });

  it("finds today's opening before business starts", () => {
    expect(getOperatingState(now("08:00"), zone, {}).nextOpening).toBe(
      "2026-10-07T00:00:00.000Z",
    );
  });

  it("does not report a future opening while already open", () => {
    expect(getOperatingState(now("10:00"), zone, {}).nextOpening).toBeNull();
  });

  it("skips holidays after today's closing", () => {
    expect(
      getOperatingState(now("22:00"), zone, {
        thu: null,
        fri: { open: "10:00", close: "18:00" },
      }).nextOpening,
    ).toBe("2026-10-09T01:00:00.000Z");
  });

  it("finds the same weekday next week when all other weekdays are closed", () => {
    expect(
      getOperatingState(now("22:00"), zone, {
        ...closed,
        wed: { open: "09:00", close: "22:00" },
      }).nextOpening,
    ).toBe("2026-10-14T00:00:00.000Z");
  });

  it("returns null without looping when every weekday is closed", () => {
    expect(getOperatingState(now("10:00"), zone, closed)).toMatchObject({
      status: "closed",
      hours: null,
      window: null,
      nextOpening: null,
    });
  });

  it("supports closing at 24:00", () => {
    expect(
      getOperatingState(now("23:59"), zone, {
        wed: { open: "09:00", close: "24:00" },
      }),
    ).toMatchObject({
      status: "open",
      window: { end: "2026-10-07T15:00:00.000Z" },
    });
  });

  it.each([
    ["2026-03-08", 23],
    ["2026-11-01", 25],
  ] as const)("has %i-hour actual duration on %s", (date, hours) => {
    const window = getOperatingWindow(date, "America/New_York", {
      sun: { open: "00:00", close: "24:00" },
    })!;
    expect(
      (Date.parse(window.end) - Date.parse(window.start)) / 3_600_000,
    ).toBe(hours);
  });

  it("resolves a missing opening to the first valid instant, not 03:30", () => {
    expect(
      getOperatingWindow("2026-03-08", "America/New_York", {
        sun: { open: "02:30", close: "04:00" },
      }),
    ).toEqual({
      start: "2026-03-08T07:00:00.000Z",
      end: "2026-03-08T08:00:00.000Z",
    });
  });

  it("uses the earlier occurrence of a repeated opening", () => {
    expect(
      getOperatingWindow("2026-11-01", "America/New_York", {
        sun: { open: "01:00", close: "02:00" },
      }),
    ).toEqual({
      start: "2026-11-01T05:00:00.000Z",
      end: "2026-11-01T07:00:00.000Z",
    });
  });

  it("treats an entire interval skipped by DST as no actual operating window", () => {
    expect(
      getOperatingWindow("2026-03-08", "America/New_York", {
        sun: { open: "02:00", close: "02:30" },
      }),
    ).toBeNull();
  });
});

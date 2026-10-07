import { describe, expect, it } from "vitest";
import { getBookingDateWindow } from "@/features/bookings/date";
import {
  formatAvailabilityUntil,
  formatBookingDayHeading,
  formatNextOpening,
  relativeBookingStatus,
} from "@/features/bookings/format";
import { addDays } from "@/lib/time/zoned";

const today = "2026-10-07";
const zone = "Asia/Seoul";
const now = "2026-10-07T12:00:00+09:00";

describe("booking date windows", () => {
  it.each([
    [0, 0, null, 7],
    [6, 0, null, 13],
    [7, 7, 0, 14],
    [54, 49, 47, 60],
    [56, 56, 49, null],
    [60, 56, 53, null],
  ])(
    "places day %i in a fixed seven-day window",
    (offset, first, previous, next) => {
      const selected = addDays(today, offset!);
      expect(getBookingDateWindow(today, selected)).toEqual({
        selected,
        days: Array.from({ length: 7 }, (_, index) => ({
          date: addDays(today, first! + index),
          disabled: first! + index > 60,
        })),
        previous: previous === null ? null : addDays(today, previous!),
        next: next === null ? null : addDays(today, next!),
      });
    },
  );

  it.each([
    undefined,
    null,
    "bad",
    "2026-02-30",
    "2026-10-06",
    "2026-12-07",
    [today],
  ])("normalizes an invalid date to today: %j", (value) =>
    expect(getBookingDateWindow(today, value).selected).toBe(today),
  );

  it("moves calendar days across a DST change without elapsed-hour assumptions", () => {
    expect(
      getBookingDateWindow("2026-10-31", "2026-11-07").days.map(
        (day) => day.date,
      ),
    ).toEqual([
      "2026-11-07",
      "2026-11-08",
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
    ]);
  });
});

describe("availability and opening labels", () => {
  it.each([
    ["2026-10-07T15:00:00+09:00", "15:00까지"],
    ["2026-10-08T12:00:00+09:00", "내일 12:00까지"],
    ["2026-10-09T12:00:00+09:00", "10월 9일 12:00까지"],
    ["2026-10-08T00:00:00+09:00", "내일 00:00까지"],
  ])("formats the unclipped end %s", (end, expected) => {
    expect(formatAvailabilityUntil(end, today, zone)).toBe(expected);
  });

  it("uses 24:00 only for the next midnight of an operating/booking day", () => {
    expect(
      formatAvailabilityUntil("2026-10-08T00:00:00+09:00", today, zone, {
        midnightAs24: true,
      }),
    ).toBe("24:00까지");
    expect(
      formatAvailabilityUntil("2026-10-09T00:00:00+09:00", today, zone, {
        midnightAs24: true,
      }),
    ).toBe("10월 9일 00:00까지");
  });

  it.each([
    ["2026-10-07T13:00:00+09:00", "오늘 13:00에 열어요"],
    ["2026-10-08T09:00:00+09:00", "내일 09:00에 열어요"],
    ["2026-10-10T09:00:00+09:00", "토요일 09:00에 열어요"],
    [null, "운영 예정 시간이 없어요"],
  ])("formats the next opening %s", (opening, expected) => {
    expect(formatNextOpening(opening, now, zone)).toBe(expected);
  });

  it("uses the branch's date even when UTC has advanced to tomorrow", () => {
    expect(
      formatAvailabilityUntil(
        "2026-10-07T03:00:00Z",
        "2026-10-06",
        "America/Los_Angeles",
      ),
    ).toBe("20:00까지");
    expect(
      formatNextOpening(
        "2026-10-07T03:00:00Z",
        "2026-10-07T00:00:00Z",
        "America/Los_Angeles",
      ),
    ).toBe("오늘 20:00에 열어요");
  });
});

describe("relative booking labels", () => {
  it.each([
    [0.5, "1분 뒤"],
    [1, "1분 뒤"],
    [59, "59분 뒤"],
    [59.5, "60분 뒤"],
    [60, "1시간 뒤"],
    [119, "1시간 뒤"],
    [120, "2시간 뒤"],
    [1439, "23시간 뒤"],
    [1440, null],
  ])("formats a start %s minutes ahead", (minutes, expected) => {
    const start = Date.parse(now) + Number(minutes) * 60_000;
    expect(
      relativeBookingStatus(
        new Date(start).toISOString(),
        new Date(start + 3_600_000).toISOString(),
        now,
      ),
    ).toBe(expected);
  });

  it("uses half-open progress boundaries", () => {
    const start = "2026-10-07T12:00:00+09:00";
    const end = "2026-10-07T13:00:00+09:00";
    expect(relativeBookingStatus(start, end, start)).toBe("지금 이용 중");
    expect(relativeBookingStatus(start, end, "2026-10-07T12:59:59+09:00")).toBe(
      "지금 이용 중",
    );
    expect(relativeBookingStatus(start, end, end)).toBeNull();
  });

  it("uses elapsed time for repeated DST clock labels", () => {
    expect(
      relativeBookingStatus(
        "2026-11-01T01:30:00-05:00",
        "2026-11-01T02:00:00-05:00",
        "2026-11-01T01:30:00-04:00",
      ),
    ).toBe("1시간 뒤");
  });

  it("groups headings by the branch calendar date", () => {
    expect(formatBookingDayHeading(today, now, zone)).toBe(
      "오늘 · 10월 7일 수요일",
    );
    expect(formatBookingDayHeading("2026-10-08", now, zone)).toBe(
      "내일 · 10월 8일 목요일",
    );
    expect(formatBookingDayHeading("2026-10-09", now, zone)).toBe(
      "10월 9일 금요일",
    );
    expect(
      formatBookingDayHeading(
        "2026-10-06",
        "2026-10-07T00:00:00Z",
        "America/Los_Angeles",
      ),
    ).toBe("오늘 · 10월 6일 화요일");
  });
});

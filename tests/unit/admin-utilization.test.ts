import { describe, expect, it } from "vitest";
import {
  combinedUtilization,
  dashboardOpenRanges,
  dashboardPeriod,
  normalizeDashboardDate,
  utilizationOf,
} from "@/features/admin/utilization";

const interval = (start: string, end: string) => ({
  start: `2026-10-07T${start}:00Z`,
  end: `2026-10-07T${end}:00Z`,
});
describe("dashboard utilization", () => {
  it("clips bookings to opening ranges and excludes overlapping maintenance only once", () => {
    expect(
      utilizationOf({
        open: [interval("09:00", "18:00")],
        bookings: [interval("08:00", "14:00"), interval("17:00", "20:00")],
        blocks: [interval("10:00", "12:00"), interval("11:00", "13:00")],
      }),
    ).toEqual({ operatingMinutes: 360, bookedMinutes: 180, utilization: 0.5 });
  });
  it("preserves half-open boundaries, merges adjacent blocks, and never subtracts outside opening hours", () => {
    expect(
      utilizationOf({
        open: [interval("09:00", "18:00")],
        bookings: [interval("08:00", "09:00"), interval("18:00", "20:00")],
        blocks: [
          interval("07:00", "09:00"),
          interval("10:00", "11:00"),
          interval("11:00", "12:00"),
        ],
      }),
    ).toEqual({ operatingMinutes: 420, bookedMinutes: 0, utilization: 0 });
  });
  it("returns null for closed days and entirely blocked operating time", () => {
    expect(
      utilizationOf({
        open: [],
        bookings: [interval("09:00", "18:00")],
        blocks: [],
      }),
    ).toEqual({ operatingMinutes: 0, bookedMinutes: 0, utilization: null });
    expect(
      utilizationOf({
        open: [interval("09:00", "18:00")],
        bookings: [interval("09:00", "18:00")],
        blocks: [interval("08:00", "20:00")],
      }).utilization,
    ).toBeNull();
  });
  it("weights meeting room minutes instead of averaging room ratios", () => {
    expect(
      combinedUtilization([
        { operatingMinutes: 60, bookedMinutes: 60 },
        { operatingMinutes: 180, bookedMinutes: 0 },
      ]),
    ).toBe(0.25);
    expect(combinedUtilization([])).toBeNull();
  });
  it.each([
    [
      "day",
      {
        start: "2026-10-07",
        end: "2026-10-08",
        previousStart: "2026-09-30",
        previousEnd: "2026-10-01",
      },
    ],
    [
      "week",
      {
        start: "2026-10-05",
        end: "2026-10-12",
        previousStart: "2026-09-28",
        previousEnd: "2026-10-05",
      },
    ],
    [
      "30days",
      {
        start: "2026-09-08",
        end: "2026-10-08",
        previousStart: "2026-08-09",
        previousEnd: "2026-09-08",
      },
    ],
  ] as const)(
    "creates exact %s current and comparison periods",
    (range, expected) => {
      expect(dashboardPeriod("2026-10-07", range)).toEqual(expected);
    },
  );
  it("handles Monday, Sunday and year crossing without depending on process timezone", () => {
    expect(dashboardPeriod("2027-01-03", "week")).toEqual({
      start: "2026-12-28",
      end: "2027-01-04",
      previousStart: "2026-12-21",
      previousEnd: "2026-12-28",
    });
    expect(dashboardPeriod("2026-12-28", "week").start).toBe("2026-12-28");
  });
  it("uses branch-local today for invalid inputs and preserves a valid explicit date", () => {
    const now = new Date("2026-10-07T16:00:00Z");
    for (const input of [
      undefined,
      "2026-02-30",
      "2026-2-1",
      "0001-01-01",
      "0001-02-10",
      "9999-12-31",
      ["2026-10-07"],
    ]) {
      expect(normalizeDashboardDate(input, now, "Asia/Seoul")).toBe(
        "2026-10-08",
      );
      expect(normalizeDashboardDate(input, now, "America/Los_Angeles")).toBe(
        "2026-10-07",
      );
    }
    expect(normalizeDashboardDate("2026-02-28", now, "Asia/Seoul")).toBe(
      "2026-02-28",
    );
  });
  it("shares normal operating defaults and closed-day rules", () => {
    expect(
      dashboardOpenRanges("2026-10-11", "2026-10-12", "Asia/Seoul", {
        sun: null,
      }),
    ).toEqual([]);
    expect(
      dashboardOpenRanges("2026-10-07", "2026-10-08", "Asia/Seoul", {}),
    ).toEqual([
      { start: "2026-10-07T00:00:00.000Z", end: "2026-10-07T13:00:00.000Z" },
    ]);
  });
  it.each([
    ["2026-03-08", "2026-03-09", 180],
    ["2026-11-01", "2026-11-02", 300],
  ] as const)(
    "measures actual elapsed minutes across %s DST",
    (start, end, minutes) => {
      const open = dashboardOpenRanges(start, end, "America/Los_Angeles", {
        sun: { open: "00:00", close: "04:00" },
      });
      expect(utilizationOf({ open, bookings: open, blocks: [] })).toEqual({
        operatingMinutes: minutes,
        bookedMinutes: minutes,
        utilization: 1,
      });
    },
  );
  it("supports a midnight closing boundary", () => {
    expect(
      dashboardOpenRanges("2026-10-07", "2026-10-08", "Asia/Seoul", {
        wed: { open: "22:00", close: "24:00" },
      }),
    ).toEqual([
      { start: "2026-10-07T13:00:00.000Z", end: "2026-10-07T15:00:00.000Z" },
    ]);
  });
});

import { describe, expect, it } from "vitest";
import {
  bookingLimitRole,
  checkBookingLimits,
  remainingDailyMinutes,
  resolveBookingLimits,
} from "@/features/bookings/limits";
import type { PermissionContext } from "@/lib/permissions/types";

const context: PermissionContext = {
  userId: "user",
  teams: [{ teamId: "team", role: "admin" }],
  staffBranchIds: ["operated-branch"],
  roleSettings: {},
};

describe("booking limit roles and settings", () => {
  it.each([
    ["branch", null, "user"],
    ["operated-branch", null, "operator"],
    ["branch", "team", "team_member"],
    ["operated-branch", "team", "team_member"],
  ] as const)(
    "uses the actor's limit role for %s / %s",
    (branchId, teamId, expected) => {
      expect(bookingLimitRole(context, branchId, teamId)).toBe(expected);
    },
  );

  it.each([
    ["user", 120, 120, 7],
    ["team_member", 240, 480, 14],
    ["operator", null, null, null],
  ] as const)(
    "provides documented %s defaults",
    (role, perBooking, perDay, ahead) => {
      expect(resolveBookingLimits(role)).toEqual({
        maxMinutesPerBooking: perBooking,
        maxMinutesPerDay: perDay,
        maxDaysAhead: ahead,
      });
    },
  );

  it("replaces keys independently without converting explicit null or zero into a default", () => {
    expect(resolveBookingLimits("user", { maxMinutesPerBooking: 60 })).toEqual({
      maxMinutesPerBooking: 60,
      maxMinutesPerDay: 120,
      maxDaysAhead: 7,
    });
    expect(
      resolveBookingLimits("team_member", {
        maxMinutesPerDay: null,
        maxDaysAhead: 0,
      }),
    ).toEqual({
      maxMinutesPerBooking: 240,
      maxMinutesPerDay: null,
      maxDaysAhead: 0,
    });
    expect(resolveBookingLimits("operator", { maxMinutesPerDay: 60 })).toEqual({
      maxMinutesPerBooking: null,
      maxMinutesPerDay: 60,
      maxDaysAhead: null,
    });
  });
});

describe("booking limit checks", () => {
  it.each([
    [120, 0, 7, null],
    [121, 0, 7, "per_booking"],
    [60, 60, 7, null],
    [60, 61, 7, "per_day"],
    [60, 0, 8, "days_ahead"],
    [121, 120, 8, "per_booking"],
    [60, 120, 8, "days_ahead"],
  ] as const)(
    "checks duration %i, used %i and days ahead %i",
    (durationMinutes, usedMinutes, daysAhead, expected) => {
      expect(
        checkBookingLimits({
          limits: resolveBookingLimits("user"),
          durationMinutes,
          usedMinutes,
          daysAhead,
        }),
      ).toBe(expected);
    },
  );

  it("allows only today for a zero-day limit", () => {
    const limits = resolveBookingLimits("user", { maxDaysAhead: 0 });
    expect(
      checkBookingLimits({
        limits,
        durationMinutes: 30,
        usedMinutes: 0,
        daysAhead: 0,
      }),
    ).toBeNull();
    expect(
      checkBookingLimits({
        limits,
        durationMinutes: 30,
        usedMinutes: 0,
        daysAhead: 1,
      }),
    ).toBe("days_ahead");
  });

  it("does not enforce null limits", () => {
    expect(
      checkBookingLimits({
        limits: resolveBookingLimits("operator"),
        durationMinutes: 1_440,
        usedMinutes: 10_000,
        daysAhead: 365,
      }),
    ).toBeNull();
  });

  it.each([
    [0, 120],
    [60, 60],
    [120, 0],
    [121, 0],
  ] as const)(
    "calculates remaining minutes after %i used",
    (used, expected) => {
      expect(remainingDailyMinutes(resolveBookingLimits("user"), used)).toBe(
        expected,
      );
    },
  );

  it("represents unlimited daily minutes as null", () => {
    expect(
      remainingDailyMinutes(resolveBookingLimits("operator"), 10_000),
    ).toBeNull();
  });
});

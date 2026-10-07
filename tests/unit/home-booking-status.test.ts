import { describe, expect, it } from "vitest";
import { homeBookingStatus } from "@/features/bookings/home-booking-status";

const booking = {
  start: "2026-10-07T06:00:00Z",
  end: "2026-10-07T07:00:00Z",
  timezone: "Asia/Seoul",
};
describe("next booking status", () => {
  it("reports an ongoing booking and ceiling minutes remaining", () => {
    expect(homeBookingStatus(booking, "2026-10-07T06:25:01Z")).toEqual({
      label: "지금 이용 중",
      remaining: "35분 남음",
      kind: "mine",
    });
  });
  it("includes the start but not end in ongoing state", () => {
    expect(homeBookingStatus(booking, booking.start).kind).toBe("mine");
    expect(homeBookingStatus(booking, booking.end).label).toBe("이용 종료");
  });
  it("describes a later booking today", () => {
    expect(homeBookingStatus(booking, "2026-10-07T03:00:00Z").label).toBe(
      "오늘 · 3시간 뒤",
    );
    expect(homeBookingStatus(booking, "2026-10-07T05:40:00Z").label).toBe(
      "오늘 · 20분 뒤",
    );
  });
  it("uses the booking branch timezone for tomorrow and later dates", () => {
    expect(homeBookingStatus(booking, "2026-10-06T14:00:00Z").label).toBe(
      "내일 · 10월 7일 수",
    );
    expect(homeBookingStatus(booking, "2026-10-05T14:00:00Z").label).toBe(
      "10월 7일 수",
    );
    expect(
      homeBookingStatus(
        { ...booking, timezone: "America/Los_Angeles" },
        "2026-10-06T14:00:00Z",
      ).label,
    ).toMatch(/^오늘/);
  });
  it("keeps a 25-hour DST day on today's label", () => {
    expect(
      homeBookingStatus(
        {
          start: "2026-11-02T07:30:00Z",
          end: "2026-11-02T08:00:00Z",
          timezone: "America/Los_Angeles",
        },
        "2026-11-01T07:00:00Z",
      ).label,
    ).toBe("오늘 · 24시간 뒤");
  });
});

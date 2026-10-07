import { describe, expect, it } from "vitest";
import {
  formatBranchHours,
  summarizeBranchWeek,
} from "@/features/bookings/branch-hours";

describe("branch operating week labels", () => {
  it.each([
    [{ open: "08:00", close: "22:00" }, "08–22"],
    [{ open: "09:00", close: "18:00" }, "09–18"],
    [{ open: "08:30", close: "22:00" }, "08:30–22"],
    [{ open: "08:00", close: "22:30" }, "08–22:30"],
    [{ open: "08:30", close: "22:30" }, "08:30–22:30"],
    [{ open: "00:00", close: "24:00" }, "00–24"],
    [null, "쉼"],
  ])("formats %j as %s", (hours, label) => {
    expect(formatBranchHours(hours)).toBe(label);
  });
  it("keeps Monday-to-Sunday order across the year boundary and only marks the supplied local today", () => {
    const week = summarizeBranchWeek({ sun: null }, "2027-01-01");
    expect(week.map(({ label }) => label)).toEqual([
      "월",
      "화",
      "수",
      "목",
      "금",
      "토",
      "일",
    ]);
    expect(week.filter(({ isToday }) => isToday)).toEqual([
      {
        day: "fri",
        label: "금",
        hoursLabel: "09–22",
        isToday: true,
        accessibleLabel: "금요일 09:00부터 22:00까지, 오늘",
      },
    ]);
    expect(week[6]).toMatchObject({
      day: "sun",
      hoursLabel: "쉼",
      accessibleLabel: "일요일 쉬는 날",
    });
  });
  it("gives closed today a spoken description while keeping the day highlighted", () => {
    const week = summarizeBranchWeek({ sun: null }, "2026-10-11");
    expect(week[6]).toMatchObject({
      isToday: true,
      accessibleLabel: "일요일 쉬는 날, 오늘",
    });
  });
  it("uses the existing read fallback for invalid opening hours", () => {
    const week = summarizeBranchWeek(
      { mon: { open: "broken", close: "23:00" } },
      "2026-10-07",
    );
    expect(week.every(({ hoursLabel }) => hoursLabel === "09–22")).toBe(true);
  });
  it("preserves spoken minutes and end-of-day midnight", () => {
    const week = summarizeBranchWeek(
      { wed: { open: "08:30", close: "24:00" } },
      "2026-10-07",
    );
    expect(week[2]).toMatchObject({
      hoursLabel: "08:30–24",
      accessibleLabel: "수요일 08:30부터 24:00까지, 오늘",
    });
  });
});

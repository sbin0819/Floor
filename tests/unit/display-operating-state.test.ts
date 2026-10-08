import { describe, expect, it } from "vitest";
import { getDisplayOperatingState } from "@/features/bookings/display-operating-state";

const base = {
  date: "2026-10-08",
  timeZone: "Asia/Seoul",
  openHours: { thu: { open: "09:00", close: "21:00" }, sun: null },
};
describe("display operating state", () => {
  it.each([
    ["2026-10-07T23:59:59.000Z", "영업 전 · 09:00–21:00", "none"],
    ["2026-10-08T00:00:00.000Z", "영업 중 · 09:00–21:00", "free"],
    ["2026-10-08T11:59:59.000Z", "영업 중 · 09:00–21:00", "free"],
    ["2026-10-08T12:00:00.000Z", "영업 종료 · 09:00–21:00", "none"],
  ])("uses exact opening and closing boundaries at %s", (now, label, kind) => {
    expect(getDisplayOperatingState({ ...base, now })).toMatchObject({
      isToday: true,
      today: base.date,
      label,
      kind,
    });
  });

  it("keeps the selected date when the display clock crosses midnight", () => {
    const input = { ...base, now: "2026-10-08T15:00:00.000Z" };
    expect(getDisplayOperatingState(input)).toMatchObject({
      today: "2026-10-09",
      isToday: false,
      label: "09:00–21:00",
      kind: "none",
    });
    expect(input.date).toBe("2026-10-08");
  });

  it("does not mark another date as open using today's operating state", () => {
    expect(
      getDisplayOperatingState({
        ...base,
        date: "2026-10-15",
        now: "2026-10-08T01:00:00.000Z",
      }),
    ).toMatchObject({ label: "09:00–21:00", kind: "none", isToday: false });
  });

  it("uses a holiday label for the selected date, including a future holiday", () => {
    expect(
      getDisplayOperatingState({
        ...base,
        date: "2026-10-11",
        now: "2026-10-08T01:00:00.000Z",
      }),
    ).toMatchObject({ label: "쉬는 날", kind: "none", hours: null });
  });

  it("uses the branch timezone through DST without the machine timezone", () => {
    const input = {
      date: "2026-11-01",
      timeZone: "America/New_York",
      openHours: { sun: { open: "01:00", close: "02:00" } },
    };
    for (const now of ["2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z"])
      expect(getDisplayOperatingState({ ...input, now })).toMatchObject({
        isToday: true,
        label: "영업 중 · 01:00–02:00",
        kind: "free",
      });
    expect(
      getDisplayOperatingState({ ...input, now: "2026-11-01T07:00:00Z" }).kind,
    ).toBe("none");
  });
});

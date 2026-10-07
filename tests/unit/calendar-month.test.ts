import { describe, expect, it } from "vitest";
import {
  buildMonthGrid,
  calendarWeekdays,
  getCalendarDayState,
  isCalendarArrowKey,
  moveCalendarDate,
  parseCalendarMonth,
  shiftCalendarMonth,
} from "@/lib/calendar/month";

describe("calendar month grid", () => {
  it.each([
    [2026, 10, "2026-09-27", "2026-10-31", 31, 5],
    [2026, 2, "2026-02-01", "2026-02-28", 28, 4],
    [2028, 2, "2028-01-30", "2028-03-04", 29, 5],
    [2026, 8, "2026-07-26", "2026-09-05", 31, 6],
    [1900, 2, "1900-01-28", "1900-03-03", 28, 5],
    [2000, 2, "2000-01-30", "2000-03-04", 29, 5],
  ])(
    "lays out %s-%s from Sunday through Saturday",
    (year, month, first, last, days, weeks) => {
      const grid = buildMonthGrid(Number(year), Number(month));
      const cells = grid.weeks.flat();
      expect(grid.weeks).toHaveLength(Number(weeks));
      expect(cells[0]?.date).toBe(first);
      expect(cells.at(-1)?.date).toBe(last);
      expect(cells.filter(({ inMonth }) => inMonth)).toHaveLength(Number(days));
      expect(new Set(cells.map(({ date }) => date)).size).toBe(cells.length);
      for (const week of grid.weeks)
        expect(week.map(({ weekday }) => weekday)).toEqual(calendarWeekdays);
    },
  );

  it("keeps years below 100 literal instead of interpreting them as 1900", () => {
    const grid = buildMonthGrid(99, 10);
    expect(grid.firstDate).toBe("0099-10-01");
    expect(grid.lastDate).toBe("0099-10-31");
  });

  it.each([
    [2026, 0],
    [2026, 13],
    [2026, 1.5],
    [0, 10],
    [10000, 10],
    [2026.5, 10],
    [Number.NaN, 10],
  ])("rejects invalid year or month %s %s", (year, month) => {
    expect(() => buildMonthGrid(year, month)).toThrow(RangeError);
  });

  it.each(["2026-1", "2026-00", "2026-13", "0000-12", "2026-01-01", "bad"])(
    "rejects malformed month %s",
    (month) => {
      expect(() => parseCalendarMonth(month)).toThrow(RangeError);
    },
  );

  it("shifts months across years without overflowing the day of month", () => {
    expect(parseCalendarMonth("2026-10")).toEqual({ year: 2026, month: 10 });
    expect(shiftCalendarMonth("2026-12", 3)).toBe("2027-03");
    expect(shiftCalendarMonth("2026-01", -6)).toBe("2025-07");
    expect(() => shiftCalendarMonth("2026-10", 0.5)).toThrow(RangeError);
    expect(() => shiftCalendarMonth("0001-01", -1)).toThrow(RangeError);
    expect(() => shiftCalendarMonth("9999-12", 1)).toThrow(RangeError);
  });
});

describe("calendar day state", () => {
  const range = {
    minDate: "2026-10-07",
    maxDate: "2026-12-06",
    today: "2026-10-07",
  };
  it("includes both range boundaries, today, selection, and booking marks", () => {
    expect(
      getCalendarDayState("2026-10-07", {
        ...range,
        selectedDate: "2026-10-07",
        markedDates: new Set(["2026-10-07"]),
      }),
    ).toEqual({
      outsideRange: false,
      closed: null,
      today: true,
      selected: true,
      marked: true,
    });
    expect(getCalendarDayState("2026-12-06", range).outsideRange).toBe(false);
    expect(getCalendarDayState("2026-10-06", range).outsideRange).toBe(true);
    expect(getCalendarDayState("2026-12-07", range).outsideRange).toBe(true);
  });

  it("distinguishes a closed Sunday from omitted operating hours", () => {
    expect(
      getCalendarDayState("2026-10-11", { ...range, openHours: { sun: null } })
        .closed,
    ).toBe(true);
    expect(
      getCalendarDayState("2026-10-12", { ...range, openHours: { sun: null } })
        .closed,
    ).toBe(false);
    expect(
      getCalendarDayState("2026-10-11", { ...range, openHours: {} }).closed,
    ).toBe(false);
    expect(getCalendarDayState("2026-10-11", range).closed).toBeNull();
  });

  it("rejects invalid calendar dates and reversed ranges", () => {
    for (const date of ["2026-02-29", "2026-10-32", "2026-10-7", "bad"])
      expect(() => getCalendarDayState(date, range)).toThrow(RangeError);
    expect(() =>
      getCalendarDayState("2026-10-07", { ...range, today: "bad" }),
    ).toThrow(RangeError);
    expect(() =>
      getCalendarDayState("2026-10-07", {
        ...range,
        selectedDate: "2026-02-30",
      }),
    ).toThrow(RangeError);
    expect(() =>
      getCalendarDayState("2026-10-07", { ...range, maxDate: "2026-10-06" }),
    ).toThrow(RangeError);
  });
});

describe("calendar keyboard date movement", () => {
  const options = {
    minDate: "2026-10-07",
    maxDate: "2026-12-06",
    month: "2026-10",
    allowMonthChange: true,
  };

  it("moves one day horizontally and one week vertically", () => {
    expect(moveCalendarDate("2026-10-14", "ArrowLeft", options)).toBe(
      "2026-10-13",
    );
    expect(moveCalendarDate("2026-10-14", "ArrowRight", options)).toBe(
      "2026-10-15",
    );
    expect(moveCalendarDate("2026-10-14", "ArrowUp", options)).toBe(
      "2026-10-07",
    );
    expect(moveCalendarDate("2026-10-14", "ArrowDown", options)).toBe(
      "2026-10-21",
    );
  });

  it("clamps at inclusive date boundaries", () => {
    expect(moveCalendarDate("2026-10-07", "ArrowLeft", options)).toBe(
      "2026-10-07",
    );
    expect(moveCalendarDate("2026-10-09", "ArrowUp", options)).toBe(
      "2026-10-07",
    );
    expect(moveCalendarDate("2026-12-06", "ArrowRight", options)).toBe(
      "2026-12-06",
    );
    expect(moveCalendarDate("2026-12-04", "ArrowDown", options)).toBe(
      "2026-12-06",
    );
  });

  it("crosses months only when the consumer permits it", () => {
    expect(moveCalendarDate("2026-10-31", "ArrowRight", options)).toBe(
      "2026-11-01",
    );
    expect(
      moveCalendarDate("2026-10-29", "ArrowDown", {
        ...options,
        allowMonthChange: false,
      }),
    ).toBe("2026-10-31");
    expect(
      moveCalendarDate("2026-11-01", "ArrowLeft", {
        ...options,
        month: "2026-11",
        allowMonthChange: false,
      }),
    ).toBe("2026-11-01");
  });

  it("keeps calendar-day movement stable across a DST boundary", () => {
    expect(
      moveCalendarDate("2026-11-01", "ArrowDown", {
        ...options,
        month: "2026-11",
      }),
    ).toBe("2026-11-08");
  });

  it("rejects impossible inputs and recognizes arrow keys only", () => {
    expect(() => moveCalendarDate("2026-02-30", "ArrowLeft", options)).toThrow(
      RangeError,
    );
    expect(() =>
      moveCalendarDate("2026-10-07", "ArrowLeft", {
        ...options,
        maxDate: "bad",
      }),
    ).toThrow(RangeError);
    expect(() =>
      moveCalendarDate("2026-10-07", "ArrowLeft", {
        ...options,
        month: "2026-09",
        allowMonthChange: false,
      }),
    ).toThrow(RangeError);
    expect(isCalendarArrowKey("ArrowRight")).toBe(true);
    expect(isCalendarArrowKey("ArrowDown")).toBe(true);
    expect(isCalendarArrowKey("Home")).toBe(false);
    expect(isCalendarArrowKey("Enter")).toBe(false);
  });
});

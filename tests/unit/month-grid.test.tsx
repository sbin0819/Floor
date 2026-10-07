import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MonthGrid } from "@/components/calendar/month-grid";
import { buildMonthGrid } from "@/lib/calendar/month";

describe("MonthGrid", () => {
  it("renders Sunday-first weekday headers, weeks, and custom day content", () => {
    render(
      <MonthGrid
        month={buildMonthGrid(2026, 10)}
        label="2026년 10월 날짜"
        renderDay={(day) =>
          day.inMonth ? (
            <a href={`/bookings?view=calendar&day=${day.date}`}>{day.day}</a>
          ) : (
            <span>{day.day}</span>
          )
        }
      />,
    );
    const grid = screen.getByRole("grid", { name: "2026년 10월 날짜" });
    expect(grid).toHaveAttribute("aria-colcount", "7");
    expect(grid).toHaveAttribute("aria-rowcount", "6");
    expect(
      within(grid)
        .getAllByRole("columnheader")
        .map((header) => header.getAttribute("aria-label")),
    ).toEqual([
      "일요일",
      "월요일",
      "화요일",
      "수요일",
      "목요일",
      "금요일",
      "토요일",
    ]);
    expect(within(grid).getAllByRole("row")).toHaveLength(6);
    expect(within(grid).getAllByRole("gridcell")).toHaveLength(35);
    expect(within(grid).getAllByRole("link")).toHaveLength(31);
    expect(within(grid).getByRole("link", { name: "1" })).toHaveAttribute(
      "href",
      "/bookings?view=calendar&day=2026-10-01",
    );
    expect(
      grid.querySelector('[data-date="2026-09-27"] a'),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("leaves roving focus and key interpretation to its consumer", () => {
    const onDayKeyDown = vi.fn();
    render(
      <MonthGrid
        month={buildMonthGrid(2026, 10)}
        label="예약 날짜"
        onDayKeyDown={onDayKeyDown}
        cellClassName="border border-border"
        renderDay={(day) => (
          <a
            href={`#${day.date}`}
            tabIndex={day.date === "2026-10-07" ? 0 : -1}
          >
            {day.date}
          </a>
        )}
      />,
    );
    const active = screen.getByRole("link", { name: "2026-10-07" });
    active.focus();
    fireEvent.keyDown(active, { key: "ArrowRight" });
    expect(onDayKeyDown).toHaveBeenCalledOnce();
    expect(onDayKeyDown.mock.calls[0]?.[1]).toEqual({
      date: "2026-10-07",
      day: 7,
      weekday: "wed",
      inMonth: true,
    });
    expect(active).toHaveFocus();
    expect(
      screen.getAllByRole("link").filter((link) => link.tabIndex === 0),
    ).toHaveLength(1);
    expect(screen.getAllByRole("gridcell")[0]).toHaveClass(
      "border",
      "min-h-11",
    );
  });
});

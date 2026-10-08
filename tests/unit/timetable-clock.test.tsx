import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FloorTimetable } from "@/features/bookings/components/floor-timetable";
import { floorTimetableLayout } from "@/features/bookings/timetable";
import { at, timetableFixture } from "./timetable-fixtures";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("view=timeline"),
}));
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(at(8, 59));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("timetable display clock", () => {
  it("explains before opening and draws a live line at opening without changing the server slots", () => {
    const data = { ...timetableFixture(), now: at(8, 59) };
    const view = render(<FloorTimetable data={data} />);
    expect(screen.getByText("현재 08:59 · 09:00에 열어요")).toBeVisible();
    expect(view.container.querySelector("[data-timetable-clock]")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText("현재 09:00 · 영업 중")).toBeVisible();
    expect(
      view.container.querySelector("[data-timetable-clock]"),
    ).not.toBeNull();
    const marker = view.container.querySelector<HTMLElement>(
      "[data-timetable-clock-label]",
    )!;
    expect(marker).toHaveTextContent("09:00");
    expect(marker.style.left).toContain("clamp(");
    expect(floorTimetableLayout(data, at(10)).rows).toEqual(
      floorTimetableLayout(data).rows,
    );
  });

  it("removes the line at closing and explains why", () => {
    const view = render(
      <FloorTimetable data={{ ...timetableFixture(), now: at(13, 59) }} />,
    );
    expect(
      view.container.querySelector("[data-timetable-clock]"),
    ).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText("현재 14:00 · 오늘 영업이 끝났어요")).toBeVisible();
    expect(view.container.querySelector("[data-timetable-clock]")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "현재 시간으로 이동" }),
    ).not.toBeInTheDocument();
  });

  it("does not show a live line on another date or move the selected date at midnight", () => {
    const data = { ...timetableFixture(), date: "2026-10-07", now: at(23, 59) };
    const view = render(<FloorTimetable data={data} />);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(
      screen.getByRole("grid", { name: "2026-10-07 시간표" }),
    ).toBeVisible();
    expect(
      view.container.querySelector("[data-timetable-clock-status]"),
    ).toBeNull();
    expect(view.container.querySelector("[data-timetable-clock]")).toBeNull();
  });

  it("only recenters after an explicit click, not on each minute", () => {
    const view = render(<FloorTimetable data={timetableFixture()} />);
    const scroller = screen.getByRole("grid").parentElement!;
    const scrollTo = vi.fn();
    Object.defineProperty(scroller, "scrollTo", { value: scrollTo });
    scroller.scrollLeft = 222;
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(scroller.scrollLeft).toBe(222);
    expect(scrollTo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "현재 시간으로 이동" }));
    expect(scrollTo).toHaveBeenCalledOnce();
    expect(
      view.container.querySelector("[data-timetable-clock-label]"),
    ).toHaveTextContent("10:11");
  });

  it.each([
    [8, 30, true, false],
    [9, 0, true, true],
    [20, 59, true, true],
    [21, 0, true, false],
    [22, 0, false, false],
  ])(
    "respects Gangnam/Seongsu operating boundaries at %i:%i",
    (hour, minute, gangnam, seongsu) => {
      const data = timetableFixture();
      const withHours = (open: string, close: string) => ({
        ...data,
        branch: {
          ...data.branch,
          openHours: { ...data.branch.openHours, wed: { open, close } },
        },
      });
      expect(
        floorTimetableLayout(withHours("08:00", "22:00"), at(hour, minute))
          .nowPosition !== null,
      ).toBe(gangnam);
      expect(
        floorTimetableLayout(withHours("09:00", "21:00"), at(hour, minute))
          .nowPosition !== null,
      ).toBe(seongsu);
    },
  );
});

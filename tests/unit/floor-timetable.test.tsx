import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FloorTimetable } from "@/features/bookings/components/floor-timetable";
import {
  selectFloorBookingSlot,
  type FloorBookingSelection,
} from "@/features/bookings/selection";
import type {
  FloorDayData,
  FloorVisibleSpace,
} from "@/features/bookings/types";
import { at, timetableFixture } from "./timetable-fixtures";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("view=timeline"),
}));
function Interactive({ data = timetableFixture() }: { data?: FloorDayData }) {
  const [selection, setSelection] = useState<FloorBookingSelection | null>(
    null,
  );
  return (
    <>
      <FloorTimetable
        data={data}
        selection={selection}
        onSelectSlot={({ spaceId, slots, start }) =>
          setSelection((previous) =>
            selectFloorBookingSlot(spaceId, slots, previous, start),
          )
        }
      />
      <button type="button">예약 줄</button>
      <output aria-label="고른 구간">
        {selection ? JSON.stringify(selection) : "없음"}
      </output>
    </>
  );
}
describe("floor timetable", () => {
  it("uses grid semantics, ordered groups and sticky space links preserving the view", () => {
    render(<Interactive />);
    const grid = screen.getByRole("grid", { name: "2026-10-07 시간표" });
    expect(grid).toHaveAttribute("aria-colcount", "11");
    expect(
      within(grid)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([
      "회의실 A최대 6인 · 모니터",
      "회의실 B최대 6인 · 모니터",
      "데스크 구역최대 6인 · 모니터",
      "라운지최대 6인 · 모니터",
    ]);
    expect(
      within(grid).getByRole("link", { name: /회의실 A/ }),
    ).toHaveAttribute(
      "href",
      "/branches/branch/floors/floor?date=2026-10-07&space=a&view=timeline",
    );
    expect(
      within(grid).getByRole("rowheader", {
        name: "회의실 3곳 · 지금 2곳 비어 있음",
      }),
    ).toBeVisible();
    expect(grid.parentElement).toHaveClass(
      "overflow-x-auto",
      "lg:[--timetable-cell-width:34px]",
      "[--timetable-cell-width:44px]",
    );
    expect(
      within(grid).getByRole("link", { name: /회의실 A/ }).parentElement,
    ).toHaveClass("sticky", "left-0");
  });
  it("contains no name, photo, link, button or schedule on a restricted row", () => {
    const { container } = render(<Interactive />);
    const header = screen.getByRole("rowheader", { name: /전용 공간/ });
    const row = header.closest('[role="row"]')!;
    expect(
      within(row as HTMLElement).queryByRole("link"),
    ).not.toBeInTheDocument();
    expect(
      within(row as HTMLElement).queryByRole("button"),
    ).not.toBeInTheDocument();
    expect(row.querySelector("img")).toBeNull();
    expect(row.querySelector("[data-timetable-block]")).toBeNull();
    expect(row.textContent).toBe("전용 공간다른 팀이 쓰는 공간이에요");
    expect(container.querySelectorAll("[data-timetable-block]")).toHaveLength(
      1,
    );
  });
  it("exposes free cells only, and uses static guidance for nonbookable rows", () => {
    render(<Interactive />);
    expect(
      screen.getByRole("button", { name: "회의실 A, 10:00, 비어 있음" }),
    ).toHaveAttribute("data-floor-timetable-slot", "true");
    expect(
      screen.getByRole("button", { name: "회의실 A, 10:00, 비어 있음" }),
    ).toHaveClass("[scroll-margin-inline-start:var(--timetable-label-width)]");
    for (const label of ["09:00", "09:30", "11:00", "11:30"])
      expect(
        screen.queryByRole("button", { name: `회의실 A, ${label}, 비어 있음` }),
      ).not.toBeInTheDocument();
    expect(screen.getByText("예약 없이 이용해요")).toBeVisible();
    expect(screen.getByText("예약 없이 이용해요")).toHaveClass("sticky");
    expect(
      screen.getByRole("button", { name: "회의실 A, 10:00, 비어 있음" })
        .parentElement,
    ).not.toHaveClass("border-l");
    expect(
      screen.getByText("좌석 12석 · 좌석 예약은 준비 중이에요"),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /라운지,/ }),
    ).not.toBeInTheDocument();
  });
  it("selects a suggested hour, extends a contiguous range and restarts after a block", async () => {
    render(<Interactive />);
    await userEvent.click(
      screen.getByRole("button", { name: "회의실 A, 10:00, 비어 있음" }),
    );
    expect(screen.getByText("새 예약")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "회의실 A, 10:30, 비어 있음" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("link", { name: /회의실 A/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "회의실 A, 12:00, 비어 있음" }),
    );
    expect(screen.getByLabelText("고른 구간")).toHaveTextContent(
      JSON.stringify({ spaceId: "a", start: at(12), end: at(13) }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "회의실 A, 13:30, 비어 있음" }),
    );
    expect(screen.getByLabelText("고른 구간")).toHaveTextContent(
      JSON.stringify({ spaceId: "a", start: at(12), end: at(14) }),
    );
    expect(
      screen.getByRole("button", { name: "회의실 A, 10:00, 비어 있음" }),
    ).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(
      screen.getByRole("button", { name: "회의실 B, 10:30, 비어 있음" }),
    );
    expect(screen.getByLabelText("고른 구간")).toHaveTextContent(
      JSON.stringify({ spaceId: "b", start: at(10, 30), end: at(11, 30) }),
    );
    expect(screen.getAllByText("새 예약")).toHaveLength(1);
  });
  it("has one Tab stop and moves arrows, Home/End, Enter/Space without trapping Tab", async () => {
    render(<Interactive />);
    const grid = screen.getByRole("grid");
    const interactive = () => [
      ...within(grid).getAllByRole("link"),
      ...within(grid).getAllByRole("button"),
    ];
    expect(
      interactive().filter((element) => element.tabIndex === 0),
    ).toHaveLength(1);
    await userEvent.tab();
    expect(screen.getByRole("link", { name: /회의실 A/ })).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    expect(
      screen.getByRole("button", { name: "회의실 A, 12:00, 비어 있음" }),
    ).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(
      screen.getByRole("button", { name: "회의실 B, 12:00, 비어 있음" }),
    ).toHaveAttribute("aria-pressed", "true");
    await userEvent.keyboard("{Home} ");
    expect(
      screen.getByRole("button", { name: "회의실 B, 10:00, 비어 있음" }),
    ).toHaveFocus();
    expect(screen.getByLabelText("고른 구간")).toHaveTextContent(
      JSON.stringify({ spaceId: "b", start: at(10), end: at(11) }),
    );
    await userEvent.keyboard("{End}");
    expect(
      screen.getByRole("button", { name: "회의실 B, 13:30, 비어 있음" }),
    ).toHaveFocus();
    expect(
      interactive().filter((element) => element.tabIndex === 0),
    ).toHaveLength(1);
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "예약 줄" })).toHaveFocus();
  });
  it("renders overlapping reservation and maintenance independently with interval names and colspan", () => {
    const data = timetableFixture();
    const space = data.spaces.find(
      (item): item is FloorVisibleSpace =>
        item.kind === "accessible" && item.id === "a",
    )!;
    space.intervals = [
      { start: at(11), end: at(12), kind: "mine" },
      { start: at(11, 30), end: at(12), kind: "maintenance" },
    ];
    render(<Interactive data={data} />);
    const booking = screen.getByRole("gridcell", {
      name: "내 예약 11:00–12:00",
    });
    const maintenance = screen.getByRole("gridcell", {
      name: "점검 11:30–12:00",
    });
    expect(booking).toHaveAttribute("aria-colspan", "2");
    expect(maintenance).toHaveAttribute("aria-colspan", "1");
    expect(booking).toHaveAttribute("data-lane", "0");
    expect(maintenance).toHaveAttribute("data-lane", "1");
    expect(booking.style.top).not.toBe(maintenance.style.top);
    expect(within(maintenance).getByText("점검")).toHaveClass("sr-only");
    expect(within(booking).getByText("내 예약")).not.toHaveClass("sr-only");
    expect(within(booking).queryByRole("button")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "회의실 A, 11:30, 비어 있음" }),
    ).not.toBeInTheDocument();
  });
  it("draws the server clock and past overlay only on today and dims ended blocks", () => {
    const data = timetableFixture();
    const space = data.spaces.find(
      (item): item is FloorVisibleSpace =>
        item.kind === "accessible" && item.id === "a",
    )!;
    space.intervals.push({ start: at(9), end: at(9, 30), kind: "other" });
    const view = render(<Interactive data={data} />);
    expect(
      view.container.querySelector("[data-timetable-clock]"),
    ).toHaveTextContent("10:10");
    expect(
      view.container.querySelector("[data-timetable-past]"),
    ).not.toBeNull();
    expect(
      screen.getByRole("gridcell", { name: "예약됨 09:00–09:30" }),
    ).toHaveClass("opacity-50");
    view.rerender(
      <Interactive data={{ ...data, isToday: false, date: "2026-10-14" }} />,
    );
    expect(view.container.querySelector("[data-timetable-clock]")).toBeNull();
    expect(view.container.querySelector("[data-timetable-past]")).toBeNull();
  });
  it("passes a real trigger and the minimal free-slot DTO to the shared selection callback", () => {
    const select = vi.fn();
    render(<FloorTimetable data={timetableFixture()} onSelectSlot={select} />);
    const button = screen.getByRole("button", {
      name: "회의실 B, 10:00, 비어 있음",
    });
    fireEvent.click(button);
    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: "b",
        start: at(10),
        trigger: button,
        href: "/branches/branch/floors/floor?date=2026-10-07&space=b&view=timeline",
      }),
    );
    expect(select.mock.calls[0]![0].slots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ start: at(10), state: "free" }),
      ]),
    );
  });
  it("initially scrolls to an hour before now once, preserves manual scroll and resets for another day", () => {
    const width = vi
      .spyOn(Element.prototype, "clientWidth", "get")
      .mockReturnValue(600);
    const scrollWidth = vi
      .spyOn(Element.prototype, "scrollWidth", "get")
      .mockReturnValue(1000);
    const labelWidth = vi
      .spyOn(HTMLElement.prototype, "offsetWidth", "get")
      .mockReturnValue(200);
    try {
      const data = timetableFixture();
      const view = render(<Interactive data={data} />);
      const scroller = screen.getByRole("grid").parentElement!;
      expect(scroller.scrollLeft).toBeCloseTo((1 / 3) * 80);
      scroller.scrollLeft = 180;
      view.rerender(<Interactive data={{ ...data, now: at(10, 20) }} />);
      expect(scroller.scrollLeft).toBe(180);
      view.rerender(
        <Interactive data={{ ...data, isToday: false, date: "2026-10-14" }} />,
      );
      expect(scroller.scrollLeft).toBe(0);
    } finally {
      width.mockRestore();
      scrollWidth.mockRestore();
      labelWidth.mockRestore();
    }
  });
  it("keeps arrow-key focus clear of the sticky label and inside the scrollport", () => {
    render(<Interactive />);
    const grid = screen.getByRole("grid");
    const scroller = grid.parentElement!;
    const first = screen.getByRole("button", {
      name: "회의실 A, 10:00, 비어 있음",
    });
    const last = screen.getByRole("button", {
      name: "회의실 A, 13:30, 비어 있음",
    });
    vi.spyOn(
      within(grid).getByRole("columnheader", { name: "공간" }),
      "getBoundingClientRect",
    ).mockReturnValue(new DOMRect(0, 0, 232, 48));
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 450, 600),
    );
    vi.spyOn(first, "getBoundingClientRect").mockReturnValue(
      new DOMRect(150, 0, 44, 76),
    );
    vi.spyOn(last, "getBoundingClientRect").mockReturnValue(
      new DOMRect(480, 0, 44, 76),
    );
    scroller.scrollLeft = 200;
    fireEvent.keyDown(last, { key: "Home" });
    expect(first).toHaveFocus();
    expect(scroller.scrollLeft).toBe(118);
    fireEvent.keyDown(first, { key: "End" });
    expect(last).toHaveFocus();
    expect(scroller.scrollLeft).toBe(192);
  });
});

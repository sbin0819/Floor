import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FloorDay } from "@/features/bookings/components/floor-day";
import { FloorTimetable } from "@/features/bookings/components/floor-timetable";
import {
  floorTimetableLayout,
  moveTimetableFocus,
  timetableFocusTargets,
} from "@/features/bookings/timetable";
import type {
  DeskPartSummary,
  FloorDayData,
  FloorVisibleSpace,
} from "@/features/bookings/types";
import { at, timetableFixture } from "./timetable-fixtures";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("view=timeline"),
}));

const parts: DeskPartSummary[] = [
  {
    part: "am",
    start: at(9),
    end: at(13),
    selectable: true,
    freeCount: 7,
    myDeskName: null,
  },
  {
    part: "pm",
    start: at(13),
    end: at(14),
    selectable: true,
    freeCount: 5,
    myDeskName: "A-15",
  },
];
function fixture(values: DeskPartSummary[] = parts): FloorDayData {
  const data = timetableFixture();
  data.spaces = data.spaces.map((space) =>
    space.kind === "accessible" && space.id === "desk"
      ? { ...space, deskParts: values }
      : space,
  );
  return data;
}
const amName = "데스크 구역, 오전 09:00–13:00, 빈 자리 7석";
const pmName = "데스크 구역, 오후 13:00–14:00, 내 자리 A-15";

describe("desk floor summaries", () => {
  it("positions two parts on the time axis, opens the selected part, and keeps the area detail link", () => {
    const select = vi.fn();
    const { container } = render(
      <FloorTimetable data={fixture()} onSelectDeskPart={select} />,
    );
    const am = screen.getByRole("button", { name: amName });
    const pm = screen.getByRole("button", { name: pmName });
    expect(am).toHaveClass("bg-status-free");
    expect(pm).toHaveClass("border-primary", "bg-status-mine");
    expect(container.querySelector('[data-desk-part="am"]')).toHaveStyle({
      left: "0%",
      width: "80%",
    });
    expect(container.querySelector('[data-desk-part="pm"]')).toHaveStyle({
      left: "80%",
      width: "20%",
    });
    expect(
      screen.getByRole("rowheader", { name: "데스크 구역 1곳 · 좌석 12석" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: /데스크 구역좌석 12석/ }),
    ).toHaveAttribute(
      "href",
      "/branches/branch/floors/floor?date=2026-10-07&space=desk&detail=1&view=timeline",
    );
    fireEvent.click(pm);
    expect(select).toHaveBeenCalledOnce();
    expect(select).toHaveBeenCalledWith({
      spaceId: "desk",
      part: "pm",
      href: "/branches/branch/floors/floor?date=2026-10-07&space=desk&detail=1&view=timeline",
      trigger: pm,
    });
  });
  it("keeps a full part selectable for inspecting seats without implying availability", () => {
    const select = vi.fn();
    render(
      <FloorTimetable
        data={fixture([{ ...parts[0]!, freeCount: 0 }])}
        onSelectDeskPart={select}
      />,
    );
    const button = screen.getByRole("button", {
      name: "데스크 구역, 오전 09:00–13:00, 자리 없음",
    });
    expect(button).toBeEnabled();
    expect(button).toHaveClass("bg-muted");
    fireEvent.click(button);
    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({ part: "am" }),
    );
  });
  it("renders expired parts as text and accepts a single afternoon part", () => {
    const view = render(
      <FloorTimetable
        data={fixture([{ ...parts[0]!, selectable: false }, parts[1]!])}
      />,
    );
    expect(screen.getByText("오전 · 지난 시간")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: amName }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: pmName })).toBeVisible();
    view.rerender(<FloorTimetable data={fixture([parts[1]!])} />);
    expect(screen.queryByText("오전 · 지난 시간")).not.toBeInTheDocument();
    expect(screen.getAllByText("자리 고르기")).toHaveLength(1);
  });
  it("moves between the space, parts, and closest meeting-room slot with one tab stop", async () => {
    const select = vi.fn();
    render(<FloorTimetable data={fixture()} onSelectDeskPart={select} />);
    const area = screen.getByRole("link", { name: /데스크 구역좌석 12석/ });
    area.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: amName })).toHaveFocus();
    await userEvent.keyboard("{ArrowRight} ");
    expect(screen.getByRole("button", { name: pmName })).toHaveFocus();
    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({ part: "pm" }),
    );
    await userEvent.keyboard("{ArrowUp}");
    expect(
      screen.getByRole("button", { name: "회의실 B, 13:00, 비어 있음" }),
    ).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}{Home}{ArrowLeft}");
    expect(area).toHaveFocus();
    const grid = screen.getByRole("grid");
    expect(
      [
        ...within(grid).getAllByRole("link"),
        ...within(grid).getAllByRole("button"),
      ].filter((item) => item.tabIndex === 0),
    ).toHaveLength(1);
  });
  it("shows list badges and a seat count instead of an availability bar or free-space count", () => {
    render(<FloorDay data={fixture()} />);
    const area = screen.getByRole("link", { name: /데스크 구역/ });
    expect(area).toHaveTextContent("좌석 12석 · 모니터");
    expect(within(area).getByText("오전 빈 자리 7석")).toBeVisible();
    expect(within(area).getByText("오후 내 자리 A-15")).toBeVisible();
    expect(area).toHaveAttribute(
      "href",
      "/branches/branch/floors/floor?date=2026-10-07&space=desk&detail=1&view=timeline",
    );
    expect(within(area).queryByRole("img")).not.toBeInTheDocument();
    expect(area.querySelector('[data-slot="availability-ticks"]')).toBeNull();
    const group = screen.getByRole("heading", {
      name: "데스크 구역",
      level: 2,
    }).parentElement!;
    expect(group).toHaveTextContent("1곳 · 좌석 12석");
    expect(group).not.toHaveTextContent("비어 있음");
  });
  it("marks past badges and leaves areas without seats as walk-in spaces", () => {
    const data = fixture([{ ...parts[0]!, selectable: false }]);
    const base = data.spaces.find(
      (space): space is FloorVisibleSpace =>
        space.kind === "accessible" && space.id === "desk",
    )!;
    data.spaces.push({
      ...base,
      id: "empty-desk",
      name: "자유 데스크",
      deskCount: 0,
      deskParts: undefined,
    });
    render(<FloorDay data={data} />);
    expect(screen.getByText("오전 지남")).toBeVisible();
    expect(screen.getByRole("link", { name: /자유 데스크/ })).toHaveTextContent(
      "예약 없이 이용해요",
    );
  });
  it("does not invent metadata for a restricted desk row", () => {
    const data = fixture();
    data.spaces = [
      { kind: "restricted", id: "hidden-desk", type: "desk_area" },
    ];
    data.groups = [{ type: "desk_area", totalCount: 1, freeCount: null }];
    render(<FloorTimetable data={data} />);
    const row = screen
      .getByRole("rowheader", { name: /전용 공간/ })
      .closest('[role="row"]')! as HTMLElement;
    expect(within(row).queryByRole("link")).not.toBeInTheDocument();
    expect(within(row).queryByRole("button")).not.toBeInTheDocument();
    expect(row).not.toHaveTextContent("좌석");
    expect(
      screen.getByRole("rowheader", { name: "데스크 구역 1곳" }),
    ).toBeVisible();
  });
  it("registers only selectable part starts and moves past disabled parts", () => {
    const rows = floorTimetableLayout(
      fixture([{ ...parts[0]!, selectable: false }, parts[1]!]),
    ).rows;
    expect(
      timetableFocusTargets(rows).filter(({ spaceId }) => spaceId === "desk"),
    ).toEqual([
      { spaceId: "desk", target: "space" },
      { spaceId: "desk", target: "slot", start: at(13) },
    ]);
    expect(
      moveTimetableFocus(
        rows,
        { spaceId: "desk", target: "space" },
        "ArrowRight",
      ),
    ).toEqual({ spaceId: "desk", target: "slot", start: at(13) });
  });
});

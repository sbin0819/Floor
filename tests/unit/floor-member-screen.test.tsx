import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BranchNavigation } from "@/features/bookings/components/branch-navigation";
import { FloorDay } from "@/features/bookings/components/floor-day";
import type { AvailabilitySummary } from "@/features/bookings/availability";
import type { FloorVisibleSpace } from "@/features/bookings/types";
import { floorDayFixture } from "./booking-ui-fixtures";

const navigation = vi.hoisted(() => ({ date: "2026-10-07" }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ branchId: "branch", floorId: "floor" }),
  useSearchParams: () => new URLSearchParams({ date: navigation.date }),
}));
beforeEach(() => {
  navigation.date = "2026-10-07";
});
function space(): FloorVisibleSpace {
  const row = floorDayFixture().spaces[0]!;
  if (row.kind !== "accessible")
    throw new Error("Expected an accessible fixture.");
  return row;
}
function branchNavigation() {
  const data = floorDayFixture();
  return {
    branch: data.branch,
    floors: data.floors,
    branches: [
      { id: "branch", name: "가상 지점" },
      { id: "other", name: "다른 지점" },
    ],
    today: "2026-10-07",
    now: data.now,
  };
}

describe("member floor rows", () => {
  it.each<[AvailabilitySummary, string]>([
    [{ status: "free", until: "2026-10-07T11:00:00+09:00" }, "11:00까지"],
    [{ status: "mine", until: "2026-10-07T12:00:00+09:00" }, "12:00까지"],
    [
      { status: "maintenance", until: "2026-10-08T12:00:00+09:00" },
      "내일 12:00까지",
    ],
    [
      { status: "maintenance", until: "2026-10-09T12:00:00+09:00" },
      "10월 9일 12:00까지",
    ],
    [
      { status: "busy", availableAt: "2026-10-07T13:00:00+09:00" },
      "13:00부터 비어 있음",
    ],
    [{ status: "busy", availableAt: null }, "오늘은 빈 시간이 없어요"],
    [{ status: "free", until: "2026-10-08T00:00:00+09:00" }, "24:00까지"],
  ])("shows the current summary %j", (summary, expected) => {
    render(
      <FloorDay
        data={{ ...floorDayFixture(), spaces: [{ ...space(), summary }] }}
      />,
    );
    expect(screen.getByText(expected)).toBeVisible();
    expect(
      screen.getByRole("img", { name: "예약된 시간이 없어요" }),
    ).toBeVisible();
  });

  it("uses booking counts without a badge or current-time marker on another day", () => {
    const { container } = render(
      <FloorDay
        data={{
          ...floorDayFixture(),
          isToday: false,
          date: "2026-10-08",
          spaces: [{ ...space(), bookingCount: 3 }],
        }}
      />,
    );
    expect(screen.getByText("예약 3건")).toBeVisible();
    expect(screen.queryByText("비어 있음")).not.toBeInTheDocument();
    expect(screen.queryByText(/지금 \d곳/)).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-slot="availability-now"]'),
    ).toBeNull();
  });

  it.each([
    [0, "예약 없이 이용해요"],
    [8, "좌석 8석 · 좌석 예약은 준비 중이에요"],
  ])(
    "omits the bar for a non-bookable space with %i desks",
    (deskCount, text) => {
      render(
        <FloorDay
          data={{
            ...floorDayFixture(),
            spaces: [
              { ...space(), bookable: false, deskCount: Number(deskCount) },
            ],
          }}
        />,
      );
      expect(screen.getByText(String(text))).toBeVisible();
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
      expect(screen.queryByText("비어 있음")).not.toBeInTheDocument();
    },
  );

  it("sorts accessible names and puts a non-interactive restricted row last", () => {
    render(
      <FloorDay
        data={{
          ...floorDayFixture(),
          spaces: [
            { kind: "restricted", id: "restricted", type: "meeting_room" },
            { ...space(), name: "회의실 C", id: "c" },
            { ...space(), name: "회의실 A", id: "a" },
          ],
        }}
      />,
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("회의실 A");
    expect(rows[1]).toHaveTextContent("회의실 C");
    expect(rows[2]).toHaveTextContent("전용 공간 · 다른 팀이 쓰는 공간이에요");
    expect(within(rows[2]!).queryByRole("link")).not.toBeInTheDocument();
    expect(within(rows[2]!).queryByRole("img")).not.toBeInTheDocument();
    expect(rows[2]!.querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("shows the server's visible total and free count only when positive and operating today", () => {
    const data = floorDayFixture();
    const view = render(<FloorDay data={data} />);
    expect(screen.getByText("2곳 · 지금 1곳 비어 있음")).toBeVisible();
    view.rerender(
      <FloorDay
        data={{
          ...data,
          groups: [{ type: "meeting_room", totalCount: 2, freeCount: 0 }],
        }}
      />,
    );
    expect(screen.getByText("2곳")).toBeVisible();
    expect(screen.queryByText(/지금 \d곳/)).not.toBeInTheDocument();
    view.rerender(
      <FloorDay
        data={{
          ...data,
          operatingState: { ...data.operatingState, status: "after_close" },
        }}
      />,
    );
    expect(screen.getByText("2곳")).toBeVisible();
    expect(screen.queryByText(/지금 \d곳/)).not.toBeInTheDocument();
  });
});

describe("member branch and date controls", () => {
  it("opens a keyboard-accessible branch menu with real branch links", async () => {
    render(<BranchNavigation data={branchNavigation()} />);
    fireEvent.keyDown(
      screen.getByRole("button", { name: "가상 지점 · 지점 바꾸기" }),
      { key: "ArrowDown" },
    );
    expect(
      await screen.findByRole("menuitem", { name: "다른 지점" }),
    ).toHaveAttribute("href", "/branches/other");
    expect(
      screen.getByRole("menuitem", { name: "모든 지점 보기" }),
    ).toHaveAttribute("href", "/branches");
    expect(screen.getByRole("menuitem", { name: "가상 지점" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("renders seven days and seven-day arrows, keeping closed days as links", () => {
    const data = branchNavigation();
    data.branch.openHours.sun = null;
    render(<BranchNavigation data={data} />);
    const dates = within(screen.getByRole("navigation", { name: "날짜 선택" }));
    expect(dates.getAllByRole("link")).toHaveLength(8);
    expect(dates.getByRole("button", { name: "이전 7일" })).toBeDisabled();
    expect(dates.getByRole("link", { name: "다음 7일" })).toHaveAttribute(
      "href",
      "/branches/branch/floors/floor?date=2026-10-14",
    );
    expect(
      dates.getByRole("link", { name: "10월 11일 일요일 · 쉬는 날" }),
    ).toHaveAttribute("href", "/branches/branch/floors/floor?date=2026-10-11");
    expect(
      dates.getByRole("link", { name: "오늘 · 10월 7일 수요일" }),
    ).toHaveAttribute("aria-current", "date");
  });

  it("disables the two dates after the maximum and the final right arrow", () => {
    navigation.date = "2026-12-06";
    render(<BranchNavigation data={branchNavigation()} />);
    const dates = within(screen.getByRole("navigation", { name: "날짜 선택" }));
    expect(
      dates.getByRole("button", { name: "12월 7일 월요일" }),
    ).toBeDisabled();
    expect(
      dates.getByRole("button", { name: "12월 8일 화요일" }),
    ).toBeDisabled();
    expect(dates.getByRole("button", { name: "다음 7일" })).toBeDisabled();
    expect(dates.getByRole("link", { name: "이전 7일" })).toHaveAttribute(
      "href",
      "/branches/branch/floors/floor?date=2026-11-29",
    );
  });

  it("clamps the day-54 right arrow to day 60", () => {
    navigation.date = "2026-11-30";
    render(<BranchNavigation data={branchNavigation()} />);
    expect(screen.getByRole("link", { name: "다음 7일" })).toHaveAttribute(
      "href",
      "/branches/branch/floors/floor?date=2026-12-06",
    );
  });

  it("updates operating labels from the server clock and selected date", () => {
    const data = branchNavigation();
    const view = render(<BranchNavigation data={data} />);
    expect(screen.getByLabelText("선택한 날짜 운영 시간")).toHaveTextContent(
      "영업 중 · 09:00–14:00",
    );
    view.rerender(
      <BranchNavigation data={{ ...data, now: "2026-10-07T08:00:00+09:00" }} />,
    );
    expect(screen.getByLabelText("선택한 날짜 운영 시간")).toHaveTextContent(
      "영업 전 · 09:00–14:00",
    );
    view.rerender(
      <BranchNavigation data={{ ...data, now: "2026-10-07T15:00:00+09:00" }} />,
    );
    expect(screen.getByLabelText("선택한 날짜 운영 시간")).toHaveTextContent(
      "영업 종료 · 09:00–14:00",
    );
    navigation.date = "2026-10-08";
    view.rerender(<BranchNavigation data={data} />);
    expect(screen.getByLabelText("선택한 날짜 운영 시간")).toHaveTextContent(
      /^09:00–22:00$/,
    );
    data.branch.openHours.thu = null;
    view.rerender(<BranchNavigation data={data} />);
    expect(screen.getByLabelText("선택한 날짜 운영 시간")).toHaveTextContent(
      /^쉬는 날$/,
    );
  });
});

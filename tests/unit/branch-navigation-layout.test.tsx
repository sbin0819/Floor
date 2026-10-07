import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BranchNavigation } from "@/features/bookings/components/branch-navigation";
import { floorDayFixture } from "./booking-ui-fixtures";

vi.mock("next/navigation", () => ({
  useParams: () => ({ floorId: "floor" }),
  useSearchParams: () => new URLSearchParams("date=2026-10-11"),
}));

function renderNavigation() {
  const data = floorDayFixture();
  data.branch.openHours.sun = null;
  return render(
    <BranchNavigation
      data={{
        branch: data.branch,
        floors: data.floors,
        branches: [],
        today: "2026-10-07",
        now: data.now,
        bookingDates: [],
      }}
      viewControl={
        <nav aria-label="층 화면 보기">
          <a href="?view=list" aria-label="목록 보기">
            목록
          </a>
          <a href="?view=timeline" aria-label="시간표 보기">
            시간표
          </a>
        </nav>
      }
    />,
  );
}

describe("responsive branch toolbar", () => {
  it("renders one operating status and view control and repositions those same nodes", () => {
    renderNavigation();
    const statuses = screen.getAllByLabelText("선택한 날짜 운영 시간");
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toHaveClass("row-start-3", "lg:row-start-1");
    expect(statuses[0]).toHaveTextContent("쉬는 날");
    const views = screen.getAllByRole("navigation", { name: "층 화면 보기" });
    expect(views).toHaveLength(1);
    expect(views[0]!.parentElement).toHaveClass(
      "row-start-3",
      "lg:row-start-1",
    );
    expect(screen.getAllByRole("link", { name: "목록 보기" })).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: "시간표 보기" })).toHaveLength(
      1,
    );
  });

  it("scrolls the date strip while keeping its calendar button outside the scroll region", () => {
    renderNavigation();
    const dates = screen.getByRole("navigation", { name: "날짜 선택" });
    const calendar = screen.getByRole("button", {
      name: "달력에서 날짜 고르기",
    });
    expect(dates).toHaveClass("min-w-0", "flex-1", "overflow-x-auto");
    expect(calendar).toHaveClass("shrink-0");
    expect(dates).not.toContainElement(calendar);
    expect(dates.parentElement).toContainElement(calendar);
    expect(dates.parentElement).toHaveClass("row-start-2");
    expect(screen.getByRole("navigation", { name: "층 선택" })).toHaveClass(
      "flex-nowrap",
      "overflow-x-auto",
    );
  });

  it("leaves holiday explanation to the floor view and keeps the view control on holidays", () => {
    renderNavigation();
    expect(
      screen.queryByText("쉬는 날이에요. 다른 날짜를 골라 주세요"),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "층 화면 보기" }),
    ).toBeInTheDocument();
  });
});

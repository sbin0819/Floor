import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FloorViews } from "@/features/bookings/components/floor-views";
import { SpaceDetailContainer } from "@/features/bookings/components/space-detail-container";
import { floorDayFixture } from "./booking-ui-fixtures";

vi.mock("@/features/floor-plan/use-floor-realtime", () => ({
  useFloorRealtime: () => ({ flashSpaceIds: [] }),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("view=timeline&space=secret"),
  useParams: () => ({ branchId: "branch", floorId: "floor" }),
}));

describe("closed floor day", () => {
  it("renders only one notice instead of either view and clears space on its next-opening link", () => {
    const data = floorDayFixture();
    data.date = "2026-10-11";
    data.openHours = null;
    data.branch.openHours.sun = null;
    data.branch.openHours.mon = { open: "09:00", close: "18:00" };
    render(<FloorViews data={data} initialView={null} />);
    expect(
      screen.getAllByRole("region", { name: "쉬는 날 안내" }),
    ).toHaveLength(1);
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "공간 목록" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("회의실 C")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "다음 영업일 보기" }),
    ).toHaveAttribute(
      "href",
      "/branches/branch/floors/floor?date=2026-10-12&view=timeline",
    );
  });
  it("offers a branch change when no day in the booking window is open", () => {
    const data = floorDayFixture();
    data.openHours = null;
    data.branch.openHours = {
      sun: null,
      mon: null,
      tue: null,
      wed: null,
      thu: null,
      fri: null,
      sat: null,
    };
    render(<FloorViews data={data} initialView="timeline" />);
    expect(screen.getByText("운영 예정 시간이 없어요")).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "다음 영업일 보기" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "지점 바꾸기" })).toHaveAttribute(
      "href",
      "/branches",
    );
  });
  it("never renders a detail or sheet for a confirmed closed date even with space in the URL", () => {
    render(
      <SpaceDetailContainer closed>
        <p>숨겨야 하는 상세</p>
      </SpaceDetailContainer>,
    );
    expect(screen.queryByText("숨겨야 하는 상세")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "예약" }),
    ).not.toBeInTheDocument();
  });
});

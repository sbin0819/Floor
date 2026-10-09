import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  AdminDashboard,
  AdminDashboardSkeleton,
} from "@/features/admin/components/admin-dashboard";
import { AdminDashboardPlan } from "@/features/admin/components/admin-dashboard-plan";
import {
  dashboardComparison,
  dashboardDate,
  dashboardHref,
  dashboardRelativeTime,
} from "@/features/admin/components/admin-dashboard-format";
import {
  adminDashboardFixture,
  adminDashboardPlan,
} from "@/tests/helpers/admin-dashboard";
import type { ComponentProps } from "react";
import type { PlanCanvas } from "@/features/floor-plan/components/plan-canvas";

const mocks = vi.hoisted(() => ({ push: vi.fn(), canvas: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/features/admin/maintenance-actions", () => ({
  endMaintenance: vi.fn(),
}));
vi.mock("@/features/floor-plan/components/plan-canvas", () => ({
  PlanCanvas: (props: ComponentProps<typeof PlanCanvas>) => {
    mocks.canvas(props);
    return <div data-testid="heat-canvas" />;
  },
}));

describe("admin dashboard read-only display", () => {
  it("offers registration and ending only when server confirmed space.manage", () => {
    const data = adminDashboardFixture({ canManageMaintenance: true });
    const client = new QueryClient();
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <AdminDashboard data={data} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("link", { name: "+ 등록" })).toHaveAttribute(
      "href",
      `/admin/branches/${data.branch.id}/maintenance?create=1`,
    );
    expect(screen.getAllByRole("button", { name: /해제/ })).toHaveLength(
      data.maintenance.filter((row) => row.status === "ongoing").length,
    );
    rerender(
      <QueryClientProvider client={client}>
        <AdminDashboard data={{ ...data, canManageMaintenance: false }} />
      </QueryClientProvider>,
    );
    expect(
      screen.queryByRole("link", { name: "+ 등록" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /해제/ }),
    ).not.toBeInTheDocument();
  });
  it("keeps fixed titles while loading without inventing zero or empty data", () => {
    render(<AdminDashboardSkeleton />);
    expect(screen.getByRole("heading", { name: "대시보드" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "대시보드" }).closest("header"),
    ).toHaveClass(
      "sticky",
      "top-[var(--admin-mobile-header-height,0px)]",
      "z-30",
    );
    for (const name of [
      "오늘 예약",
      "회의실 이용률",
      "점검 중",
      "다음 2시간",
      "점검",
    ])
      expect(screen.getByRole("heading", { name })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "대시보드를 불러오고 있어요",
    );
    expect(
      screen.queryByText(/0건|예약이 없어요|점검이 없어요|처리할 신고/),
    ).not.toBeInTheDocument();
  });
  it("renders three cards, all-floor bars, four upcoming rows and read-only maintenance", () => {
    render(<AdminDashboard data={adminDashboardFixture()} />);
    expect(screen.getByRole("region", { name: "오늘 예약" })).toHaveTextContent(
      "42건진행 중 5 · 남은 19",
    );
    expect(
      screen.getByRole("region", { name: "회의실 이용률" }),
    ).toHaveTextContent("68%지난주 같은 요일보다 +6%p");
    expect(screen.getByRole("region", { name: "점검 중" })).toHaveTextContent(
      "회의실 D · 내일 12:00까지",
    );
    expect(
      screen.getByRole("region", { name: "다음 2시간" }).querySelectorAll("li"),
    ).toHaveLength(4);
    expect(screen.getByRole("region", { name: "점검" })).toHaveTextContent(
      "모니터 교체",
    );
    expect(
      screen.queryByRole("button", { name: /등록|해제|취소/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("처리할 신고")).not.toBeInTheDocument();
    expect(screen.queryByTestId("heat-canvas")).not.toBeInTheDocument();
  });
  it("preserves date/range/floor in navigation and submits a new date", () => {
    const data = adminDashboardFixture({ range: "week" });
    render(<AdminDashboard data={data} />);
    const floor = within(
      screen.getByRole("navigation", { name: "대시보드 층" }),
    ).getByRole("link", { name: "7F" });
    expect(floor).toHaveAttribute(
      "href",
      dashboardHref(data, { floorId: data.floors[0]!.id }),
    );
    expect(
      within(
        screen.getByRole("navigation", { name: "대시보드 기간" }),
      ).getByRole("link", { name: "이번 주" }),
    ).toHaveAttribute("aria-current", "page");
    fireEvent.change(screen.getByLabelText("기준일"), {
      target: { value: "2026-10-15" },
    });
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    expect(mocks.push).toHaveBeenLastCalledWith(
      dashboardHref(data, { date: "2026-10-15" }),
      { scroll: false },
    );
  });
  it("selected floor reuses the utilization canvas and never fetches a plan", () => {
    const data = adminDashboardFixture();
    render(
      <AdminDashboard
        data={{
          ...data,
          floorId: data.floors[0]!.id,
          plan: adminDashboardPlan,
        }}
      />,
    );
    expect(screen.getByTestId("heat-canvas")).toBeVisible();
    const props: ComponentProps<typeof PlanCanvas> =
      mocks.canvas.mock.lastCall![0];
    expect(props.document).toBe(adminDashboardPlan.document);
    expect(props.mode).toBe("utilization");
    expect(props.states.get(data.spaces[0]!.id)?.utilization).toBe(
      data.spaces[0]!.utilization,
    );
    expect(props.activeDeskAreaId).toBeUndefined();
  });
  it("keeps the date input DOM and focus when new server date data arrives", () => {
    const data = adminDashboardFixture();
    const { rerender } = render(<AdminDashboard data={data} />);
    const input = screen.getByLabelText("기준일");
    input.focus();
    rerender(
      <AdminDashboard data={{ ...data, date: "2026-10-15", isToday: false }} />,
    );
    expect(screen.getByLabelText("기준일")).toBe(input);
    expect(input).toHaveFocus();
    expect(input).toHaveValue("2026-10-15");
  });
  it("missing plan uses the exact selected floor table, never seats or another floor", () => {
    const data = adminDashboardFixture();
    data.floorId = data.floors[0]!.id;
    data.spaces.push({
      id: "other",
      floorId: "elsewhere",
      type: "meeting_room",
      name: "다른 층 비공개",
      utilization: 0.5,
    });
    data.spaces.push({
      id: "desk",
      floorId: data.floorId!,
      type: "desk",
      name: "개별 좌석",
      utilization: 0.5,
    });
    render(<AdminDashboard data={data} />);
    expect(screen.getByRole("table")).toHaveTextContent("회의실 A91%");
    expect(screen.getByRole("table")).toHaveTextContent("라운지이용률 없음");
    expect(screen.queryByText("다른 층 비공개")).not.toBeInTheDocument();
    expect(screen.queryByText("개별 좌석")).not.toBeInTheDocument();
  });
  it("past dates omit current booking subcounts and null comparison is not zero", () => {
    const data = adminDashboardFixture({
      isToday: false,
      date: "2026-10-13",
      upcoming: [],
      maintenance: [],
    });
    data.cards.previousMeetingUtilization = null;
    render(<AdminDashboard data={data} />);
    expect(
      screen.getByRole("region", { name: "기준일 예약" }),
    ).not.toHaveTextContent("진행 중");
    expect(screen.queryByText(/지난주 같은/)).not.toBeInTheDocument();
    expect(
      screen.getByText("다음 2시간 안에 시작하는 예약이 없어요."),
    ).toBeVisible();
  });
  it("unknown archived document shapes stay unnamed/null rather than borrowing another space", () => {
    render(<AdminDashboardPlan plan={adminDashboardPlan} spaces={[]} />);
    const props: ComponentProps<typeof PlanCanvas> =
      mocks.canvas.mock.lastCall![0];
    expect(
      [...props.states.values()].every(
        (state) => state.name === "" && state.utilization === null,
      ),
    ).toBe(true);
  });
  it("formats branch-local dates and previous period deltas independently of the machine zone", () => {
    expect(dashboardDate("2026-10-14")).toBe("10월 14일 수요일");
    expect(
      dashboardRelativeTime(
        "2026-10-14T16:00:00Z",
        "2026-10-14T14:00:00Z",
        "Asia/Seoul",
      ),
    ).toBe("내일 01:00");
    expect(
      dashboardRelativeTime(
        "2026-10-14T16:00:00Z",
        "2026-10-14T14:00:00Z",
        "America/Los_Angeles",
      ),
    ).toBe("오늘 09:00");
    expect(dashboardComparison(0.5, 0.68, "week")).toBe("지난주보다 -18%p");
    expect(dashboardComparison(0.5, 0.5, "30days")).toBe("앞 30일보다 0%p");
    expect(dashboardComparison(null, 0.5, "day")).toBeNull();
  });
});

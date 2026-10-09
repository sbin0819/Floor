import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminShellNavigation } from "@/features/admin/components/admin-shell-navigation";
import { AdminDashboard } from "@/features/admin/components/admin-dashboard";
import type { AdminShellData } from "@/features/admin/admin-shell-types";
import type { ReportSummary } from "@/features/admin/reports-types";
import { adminDashboardFixture } from "@/tests/helpers/admin-dashboard";

const mocks = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/branches/branch",
  useRouter: () => mocks,
}));
vi.mock("@/components/sign-out-button", () => ({
  SignOutButton: () => <button>로그아웃</button>,
}));
vi.mock("@/features/admin/maintenance-actions", () => ({
  endMaintenance: vi.fn(),
}));
const summary = { count: 7, oldestAt: "2026-10-14T01:30:00.000Z" };
function shell(reportSummary: ReportSummary | null): AdminShellData {
  return {
    branchId: "branch",
    user: { name: "김도윤" },
    branches: [
      {
        id: "branch",
        name: "강남점",
        menus: ["dashboard", "reports"],
        reportSummary,
      },
      {
        id: "other",
        name: "다른 지점",
        menus: ["dashboard", "reports"],
        reportSummary: { count: 99, oldestAt: summary.oldestAt },
      },
    ],
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/admin/branches/branch");
});
describe("report summary menu and dashboard", () => {
  it.each([null, { count: 0, oldestAt: null }])(
    "does not invent a menu badge for %j",
    (reportSummary) => {
      render(<AdminShellNavigation data={shell(reportSummary)} />);
      expect(screen.getByRole("link", { name: "신고" })).toHaveAttribute(
        "href",
        "/admin/branches/branch/reports",
      );
      expect(screen.queryByLabelText(/처리할 신고/)).not.toBeInTheDocument();
      expect(screen.queryByText("99")).not.toBeInTheDocument();
    },
  );
  it("hides the report entry when the authorized menu list excludes it", () => {
    const data = shell(null);
    data.branches[0]!.menus = ["dashboard"];
    render(<AdminShellNavigation data={data} />);
    expect(
      screen.queryByRole("link", { name: /신고/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/처리할 신고/)).not.toBeInTheDocument();
  });
  it("uses only the current branch's grouped count and keeps a navigable 44px link", async () => {
    render(<AdminShellNavigation data={shell(summary)} />);
    const badge = screen.getByLabelText("처리할 신고 7개");
    expect(badge).toHaveTextContent("7");
    expect(badge).toHaveClass("tabular-nums");
    expect(screen.queryByText("99")).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: /신고/ });
    expect(link).toContainElement(badge);
    expect(link).toHaveClass("min-h-11");
    await userEvent.click(link);
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith(
      "/admin/branches/branch/reports",
    );
  });
  it("shows the same positive grouped count in the mobile menu", async () => {
    render(<AdminShellNavigation data={shell(summary)} mobile />);
    await userEvent.click(
      screen.getByRole("button", { name: "운영자 메뉴 열기" }),
    );
    const menu = screen.getByRole("dialog", { name: "운영자 메뉴" });
    expect(within(menu).getByLabelText("처리할 신고 7개")).toBeVisible();
  });
  it("omits the dashboard report card when its permission-gated summary is null", () => {
    const data = { ...adminDashboardFixture(), reportSummary: null };
    render(<AdminDashboard data={data} />);
    expect(
      screen.queryByRole("region", { name: "처리할 신고" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /신고/ }),
    ).not.toBeInTheDocument();
  });
  it("shows an honest zero card without an invented oldest timestamp", () => {
    const data = {
      ...adminDashboardFixture(),
      reportSummary: { count: 0, oldestAt: null },
    };
    render(<AdminDashboard data={data} />);
    const card = screen.getByRole("region", { name: "처리할 신고" });
    expect(within(card).getByRole("link", { name: "0건" })).toHaveAttribute(
      "href",
      `/admin/branches/${data.branch.id}/reports?tab=open`,
    );
    expect(card).toHaveTextContent("처리할 신고가 없어요");
    expect(card).not.toHaveTextContent("가장 오래된 것");
  });
  it("shows the grouped count and oldest age using the server's now", () => {
    const data = { ...adminDashboardFixture(), reportSummary: summary };
    render(<AdminDashboard data={data} />);
    const card = screen.getByRole("region", { name: "처리할 신고" });
    expect(within(card).getByRole("link", { name: "7건" })).toHaveAttribute(
      "href",
      `/admin/branches/${data.branch.id}/reports?tab=open`,
    );
    expect(card).toHaveTextContent("가장 오래된 것 1시간 전");
    expect(card).not.toHaveTextContent("처리할 신고가 없어요");
  });
});

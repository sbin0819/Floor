import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import Page from "@/app/admin/(shell)/branches/[branchId]/reports/page";
import { requireOperatorPage } from "@/lib/auth/session";
import { getBranchReports } from "@/features/admin/queries";
import { ActionError } from "@/lib/actions/result";
import {
  ReportsFrame,
  ReportsSkeleton,
} from "@/features/admin/components/reports-frame";
import { BranchReports } from "@/features/admin/components/branch-reports";
import { AdminForbidden } from "@/features/admin/components/admin-forbidden";
import { branchReportsFixture, reportBranchId } from "@/tests/helpers/reports";
import { resolvePageContent } from "./page-test-utils";
vi.mock("@/lib/auth/session", () => ({ requireOperatorPage: vi.fn() }));
vi.mock("@/features/admin/queries", () => ({ getBranchReports: vi.fn() }));
vi.mock("@/features/admin/report-actions", () => ({ resolveReports: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound() {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOperatorPage).mockResolvedValue({
    userId: "operator",
    name: "운영자",
    email: "not-displayed@example.test",
  });
  vi.mocked(getBranchReports).mockResolvedValue(branchReportsFixture());
});
function page(tab?: string | string[], branchId = reportBranchId) {
  return Page({
    params: Promise.resolve({ branchId }),
    searchParams: Promise.resolve({ tab }),
  });
}
it("고정 틀은 세션·조회 없이 반환하고 모르는 데이터만 Suspense 아래에 둔다", () => {
  const element = page();
  expect(element.type).toBe(ReportsFrame);
  expect(element.props.children.props.fallback.type).toBe(ReportsSkeleton);
  render(
    <ReportsFrame>
      <ReportsSkeleton />
    </ReportsFrame>,
  );
  expect(screen.getByRole("heading", { name: "신고" })).toBeInTheDocument();
  expect(requireOperatorPage).not.toHaveBeenCalled();
  expect(getBranchReports).not.toHaveBeenCalled();
});
it.each(["open", "resolved"] as const)(
  "%s 탭은 직접 가드 뒤 query에 전달한다",
  async (tab) => {
    const result = await resolvePageContent(page(tab).props.children);
    expect(requireOperatorPage).toHaveBeenCalledOnce();
    expect(getBranchReports).toHaveBeenCalledExactlyOnceWith({
      branchId: reportBranchId,
      tab,
    });
    expect(result.type).toBe(BranchReports);
    expect(
      vi.mocked(requireOperatorPage).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(getBranchReports).mock.invocationCallOrder[0]!);
  },
);
it("배열 탭은 기본값이며 부정확한 branchId는 query 전에 404다", async () => {
  await resolvePageContent(page(["resolved"]).props.children);
  expect(getBranchReports).toHaveBeenCalledWith({
    branchId: reportBranchId,
    tab: "open",
  });
  vi.clearAllMocks();
  await expect(
    resolvePageContent(page("open", "wrong").props.children),
  ).rejects.toThrow("NOT_FOUND");
  expect(getBranchReports).not.toHaveBeenCalled();
});
it("비로그인은 조회하지 않는다", async () => {
  vi.mocked(requireOperatorPage).mockRejectedValue(new Error("redirect"));
  await expect(resolvePageContent(page().props.children)).rejects.toThrow(
    "redirect",
  );
  expect(getBranchReports).not.toHaveBeenCalled();
});
it("권한 꺼짐은 안전한 안내다", async () => {
  vi.mocked(getBranchReports).mockRejectedValue(new ActionError("FORBIDDEN"));
  expect((await resolvePageContent(page().props.children)).type).toBe(
    AdminForbidden,
  );
});
it("다른 지점과 없는 지점은 같은 404다", async () => {
  vi.mocked(getBranchReports).mockRejectedValue(new ActionError("NOT_FOUND"));
  await expect(resolvePageContent(page().props.children)).rejects.toThrow(
    "NOT_FOUND",
  );
});
it("예상하지 못한 오류는 빈 목록으로 숨기지 않고 경계에 전달한다", async () => {
  vi.mocked(getBranchReports).mockRejectedValue(new Error("query failure"));
  await expect(resolvePageContent(page().props.children)).rejects.toThrow(
    "query failure",
  );
});

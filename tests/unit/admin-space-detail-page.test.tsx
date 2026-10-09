import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import Page from "@/app/admin/(shell)/branches/[branchId]/floors/[floorId]/spaces/[spaceId]/page";
import { requireOperatorPage } from "@/lib/auth/session";
import { getAdminSpace } from "@/features/admin/queries";
import { ActionError } from "@/lib/actions/result";
import { SpaceDetail } from "@/features/admin/components/space-detail";
import {
  SpaceDetailFrame,
  SpaceDetailSkeleton,
} from "@/features/admin/components/space-detail-frame";
import { AdminForbidden } from "@/features/admin/components/admin-forbidden";
import { adminFloorFixture, adminIds } from "./admin-ui-fixtures";
import { resolvePageContent } from "./page-test-utils";
vi.mock("@/lib/auth/session", () => ({ requireOperatorPage: vi.fn() }));
vi.mock("@/features/admin/queries", () => ({ getAdminSpace: vi.fn() }));
vi.mock("@/features/admin/components/space-detail", () => ({
  SpaceDetail: vi.fn(() => null),
}));
vi.mock("next/navigation", () => ({
  notFound() {
    throw new Error("NOT_FOUND");
  },
}));
const params = {
  branchId: adminIds.branch,
  floorId: adminIds.floor,
  spaceId: adminIds.space,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOperatorPage).mockResolvedValue({
    userId: "operator",
    name: "운영자",
    email: "private@example.test",
  });
  const { spaces, ...floor } = adminFloorFixture();
  vi.mocked(getAdminSpace).mockResolvedValue({
    ...floor,
    space: spaces[0]!,
    photos: [],
    filesEnabled: false,
  });
});
const page = (tab?: string | string[], team?: string | string[]) =>
  Page({
    params: Promise.resolve(params),
    searchParams: Promise.resolve({ tab, team }),
  });
it("returns a fixed shell and page-local Suspense before reading auth or route data", () => {
  const element = Page({
    params: new Promise(() => {}),
    searchParams: new Promise(() => {}),
  });
  expect(element.type).toBe(SpaceDetailFrame);
  expect(element.props.children.props.fallback.type).toBe(SpaceDetailSkeleton);
  render(
    <SpaceDetailFrame>
      <SpaceDetailSkeleton />
    </SpaceDetailFrame>,
  );
  expect(screen.getByRole("heading", { name: "공간 관리" })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent(
    "공간을 불러오고 있어요",
  );
  expect(requireOperatorPage).not.toHaveBeenCalled();
  expect(getAdminSpace).not.toHaveBeenCalled();
});
it.each(["info", "access", "photos"] as const)(
  "guards the %s tab directly before calling its feature query",
  async (tab) => {
    const result = await resolvePageContent(page(tab, "디자인").props.children);
    expect(requireOperatorPage).toHaveBeenCalledOnce();
    expect(getAdminSpace).toHaveBeenCalledExactlyOnceWith(
      params.branchId,
      params.floorId,
      params.spaceId,
      { tab, team: "디자인" },
    );
    expect(
      vi.mocked(requireOperatorPage).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(getAdminSpace).mock.invocationCallOrder[0]!);
    expect(result.type).toBe(SpaceDetail);
    expect(result.props.tab).toBe(tab);
    expect(result.key).toBe(params.spaceId);
  },
);
it("normalizes array tabs but keeps team input for strict query validation", async () => {
  await resolvePageContent(page(["photos"], ["one", "two"]).props.children);
  expect(getAdminSpace).toHaveBeenCalledWith(
    params.branchId,
    params.floorId,
    params.spaceId,
    { tab: "info", team: ["one", "two"] },
  );
});
it("does not invoke the query when the direct session guard redirects", async () => {
  vi.mocked(requireOperatorPage).mockRejectedValue(
    new Error("redirect to login"),
  );
  await expect(resolvePageContent(page().props.children)).rejects.toThrow(
    "redirect to login",
  );
  expect(getAdminSpace).not.toHaveBeenCalled();
});
it("renders the permission-denied UI without manufacturing empty photos", async () => {
  vi.mocked(getAdminSpace).mockRejectedValue(new ActionError("FORBIDDEN"));
  expect((await resolvePageContent(page().props.children)).type).toBe(
    AdminForbidden,
  );
});
it("maps missing and wrong-scope space data to 404", async () => {
  vi.mocked(getAdminSpace).mockRejectedValue(new ActionError("NOT_FOUND"));
  await expect(resolvePageContent(page().props.children)).rejects.toThrow(
    "NOT_FOUND",
  );
});
it("propagates unexpected failures instead of presenting empty data", async () => {
  vi.mocked(getAdminSpace).mockRejectedValue(new Error("query failure"));
  await expect(resolvePageContent(page().props.children)).rejects.toThrow(
    "query failure",
  );
});

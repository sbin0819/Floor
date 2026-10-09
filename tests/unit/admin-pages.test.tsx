import { Suspense } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { notFound } from "next/navigation";
import AdminBranchPage from "@/app/admin/(shell)/branches/[branchId]/spaces/page";
import AdminFloorPage from "@/app/admin/(shell)/branches/[branchId]/floors/[floorId]/page";
import { getAdminBranch, getAdminFloor } from "@/features/admin/queries";
import { requireOperatorPage } from "@/lib/auth/session";
import { ActionError } from "@/lib/actions/result";
import { AdminForbidden } from "@/features/admin/components/admin-forbidden";
import { resolvePageContent } from "./page-test-utils";
import {
  adminBranchFixture,
  adminFloorFixture,
  adminIds,
} from "./admin-ui-fixtures";
vi.mock("@/features/admin/queries", () => ({
  getAdminBranch: vi.fn(),
  getAdminFloor: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireOperatorPage: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("@/features/admin/components/branch-detail", () => ({
  BranchDetail: () => null,
}));
vi.mock("@/features/admin/components/floor-detail", () => ({
  FloorDetail: () => null,
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOperatorPage).mockResolvedValue({
    userId: "operator",
    name: "운영자",
    email: "operator@example.test",
  });
  vi.mocked(getAdminBranch).mockResolvedValue(adminBranchFixture());
  vi.mocked(getAdminFloor).mockResolvedValue(adminFloorFixture());
});
const branchProps = () => ({
  params: Promise.resolve({ branchId: adminIds.branch }),
});
const floorProps = () => ({
  params: Promise.resolve({
    branchId: adminIds.branch,
    floorId: adminIds.floor,
  }),
  searchParams: Promise.resolve({ team: "가상팀" }),
});
it("returns local Suspense shells before any session or query reads", () => {
  expect(AdminBranchPage(branchProps()).type).toBe(Suspense);
  expect(AdminFloorPage(floorProps()).type).toBe(Suspense);
  expect(requireOperatorPage).not.toHaveBeenCalled();
  expect(getAdminBranch).not.toHaveBeenCalled();
  expect(getAdminFloor).not.toHaveBeenCalled();
});
it("checks operator session before branch loading", async () => {
  await resolvePageContent(AdminBranchPage(branchProps()));
  expect(getAdminBranch).toHaveBeenCalledWith(adminIds.branch);
  expect(
    vi.mocked(requireOperatorPage).mock.invocationCallOrder[0],
  ).toBeLessThan(vi.mocked(getAdminBranch).mock.invocationCallOrder[0]!);
});
it("passes both route IDs and server search input only after its guard", async () => {
  await resolvePageContent(AdminFloorPage(floorProps()));
  expect(getAdminFloor).toHaveBeenCalledWith(
    adminIds.branch,
    adminIds.floor,
    "가상팀",
  );
  expect(
    vi.mocked(requireOperatorPage).mock.invocationCallOrder[0],
  ).toBeLessThan(vi.mocked(getAdminFloor).mock.invocationCallOrder[0]!);
});
it.each(["branch", "floor"])(
  "does not load %s data when the guard rejects",
  async (kind) => {
    vi.mocked(requireOperatorPage).mockRejectedValue(
      new Error("LOGIN_REDIRECT"),
    );
    await expect(
      resolvePageContent(
        kind === "branch"
          ? AdminBranchPage(branchProps())
          : AdminFloorPage(floorProps()),
      ),
    ).rejects.toThrow("LOGIN_REDIRECT");
    expect(getAdminBranch).not.toHaveBeenCalled();
    expect(getAdminFloor).not.toHaveBeenCalled();
  },
);
it.each(["branch", "floor"])(
  "maps unauthorized or missing %s to identical notFound",
  async (kind) => {
    vi.mocked(getAdminBranch).mockRejectedValue(new ActionError("NOT_FOUND"));
    vi.mocked(getAdminFloor).mockRejectedValue(new ActionError("NOT_FOUND"));
    await expect(
      resolvePageContent(
        kind === "branch"
          ? AdminBranchPage(branchProps())
          : AdminFloorPage(floorProps()),
      ),
    ).rejects.toThrow("NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
  },
);
it("preserves genuine query failures", async () => {
  vi.mocked(getAdminFloor).mockRejectedValue(new Error("storage unavailable"));
  await expect(
    resolvePageContent(AdminFloorPage(floorProps())),
  ).rejects.toThrow("storage unavailable");
  expect(notFound).not.toHaveBeenCalled();
});
it.each(["branch", "floor"])(
  "shows the permission screen for a disabled %s menu without hiding it as missing",
  async (kind) => {
    vi.mocked(getAdminBranch).mockRejectedValue(new ActionError("FORBIDDEN"));
    vi.mocked(getAdminFloor).mockRejectedValue(new ActionError("FORBIDDEN"));
    const result = await resolvePageContent(
      kind === "branch"
        ? AdminBranchPage(branchProps())
        : AdminFloorPage(floorProps()),
    );
    expect(result).toEqual(expect.objectContaining({ type: AdminForbidden }));
    expect(notFound).not.toHaveBeenCalled();
  },
);

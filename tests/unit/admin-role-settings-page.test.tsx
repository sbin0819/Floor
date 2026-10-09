import { Suspense } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import Page from "@/app/admin/(shell)/branches/[branchId]/roles/page";
import { getRoleSettingsEditor } from "@/features/admin/queries";
import { requireOperatorPage } from "@/lib/auth/session";
import { AdminRoleSettings } from "@/features/admin/components/admin-role-settings";
import { AdminRoleSettingsSkeleton } from "@/features/admin/components/admin-role-settings-frame";
import { AdminForbidden } from "@/features/admin/components/admin-forbidden";
import {
  roleSettingsBranchId,
  roleSettingsFixture,
} from "@/tests/helpers/role-settings";
import { ActionError } from "@/lib/actions/result";
import { resolvePageContent } from "./page-test-utils";
vi.mock("@/features/admin/queries", () => ({ getRoleSettingsEditor: vi.fn() }));
vi.mock("@/features/admin/role-settings-actions", () => ({
  updateRoleSettings: vi.fn(),
  resetRoleSettings: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireOperatorPage: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getRoleSettingsEditor).mockResolvedValue(roleSettingsFixture());
  vi.mocked(requireOperatorPage).mockResolvedValue({
    userId: "operator",
    name: "운영자",
    email: "operator@example.test",
  });
});
function page() {
  return Page({ params: Promise.resolve({ branchId: roleSettingsBranchId }) });
}
it("renders real fixed headings/rows before reading session and permissions", () => {
  const value = page();
  expect(value.type).toBe(Suspense);
  expect(value.props.fallback.type).toBe(AdminRoleSettingsSkeleton);
  expect(requireOperatorPage).not.toHaveBeenCalled();
  expect(getRoleSettingsEditor).not.toHaveBeenCalled();
  render(value.props.fallback);
  expect(screen.getByRole("heading", { name: "역할과 권한" })).toBeVisible();
  expect(screen.getAllByRole("rowheader")).toHaveLength(14);
  expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.queryByText("강남점")).not.toBeInTheDocument();
});
it("guards before calling the permission query and passes branch-scoped data once", async () => {
  const value = await resolvePageContent(page());
  expect(value.type).toBe(AdminRoleSettings);
  expect(value.key).toBe(roleSettingsBranchId);
  expect(getRoleSettingsEditor).toHaveBeenCalledExactlyOnceWith(
    roleSettingsBranchId,
  );
  expect(
    vi.mocked(requireOperatorPage).mock.invocationCallOrder[0],
  ).toBeLessThan(vi.mocked(getRoleSettingsEditor).mock.invocationCallOrder[0]!);
});
it("does not query when the page's own session guard redirects", async () => {
  vi.mocked(requireOperatorPage).mockRejectedValue(new Error("LOGIN"));
  await expect(resolvePageContent(page())).rejects.toThrow("LOGIN");
  expect(getRoleSettingsEditor).not.toHaveBeenCalled();
});
it("shows forbidden without inventing empty defaults and preserves notFound failures", async () => {
  vi.mocked(getRoleSettingsEditor).mockRejectedValueOnce(
    new ActionError("FORBIDDEN"),
  );
  expect((await resolvePageContent(page())).type).toBe(AdminForbidden);
  vi.mocked(getRoleSettingsEditor).mockRejectedValueOnce(
    new ActionError("NOT_FOUND"),
  );
  await expect(resolvePageContent(page())).rejects.toThrow("NOT_FOUND");
  vi.mocked(getRoleSettingsEditor).mockRejectedValueOnce(
    new Error("unavailable"),
  );
  await expect(resolvePageContent(page())).rejects.toThrow("unavailable");
});

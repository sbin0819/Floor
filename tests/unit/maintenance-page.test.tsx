import {
  isValidElement,
  Suspense,
  type ComponentProps,
  type ReactNode,
} from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import MaintenancePage from "@/app/admin/(shell)/branches/[branchId]/maintenance/page";
import {
  AdminMaintenance,
  AdminMaintenanceSkeleton,
} from "@/features/admin/components/admin-maintenance";
import { MaintenanceDialog } from "@/features/admin/components/maintenance-dialog";
import { AdminForbidden } from "@/features/admin/components/admin-forbidden";
import {
  getMaintenanceList,
  previewMaintenance,
} from "@/features/admin/queries";
import { maintenancePreviewHref } from "@/features/admin/maintenance-navigation";
import { requireOperatorPage } from "@/lib/auth/session";
import { ActionError } from "@/lib/actions/result";
import {
  maintenanceBranchId,
  maintenanceFixture,
  maintenancePreviewFixture,
  maintenanceRequest,
} from "@/tests/helpers/maintenance";
import { resolvePageContent } from "./page-test-utils";

vi.mock("@/features/admin/queries", () => ({
  getMaintenanceList: vi.fn(),
  previewMaintenance: vi.fn(),
}));
vi.mock("@/features/admin/maintenance-actions", () => ({
  createMaintenance: vi.fn(),
  updateMaintenance: vi.fn(),
  endMaintenance: vi.fn(),
  deleteMaintenance: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireOperatorPage: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOperatorPage).mockResolvedValue({
    userId: "operator",
    name: "가상 운영자",
    email: "operator@example.test",
  });
  vi.mocked(getMaintenanceList).mockResolvedValue(maintenanceFixture());
  vi.mocked(previewMaintenance).mockResolvedValue(maintenancePreviewFixture());
});
function page(
  search: Record<string, string | string[] | undefined> = {},
  branchId = maintenanceBranchId,
) {
  return MaintenancePage({
    params: Promise.resolve({ branchId }),
    searchParams: Promise.resolve(search),
  });
}
function previewSearch() {
  return Object.fromEntries(
    new URLSearchParams(
      maintenancePreviewHref(
        maintenanceBranchId,
        new URLSearchParams({ dialog: "create" }),
        maintenanceRequest(),
      ).split("?")[1],
    ),
  );
}
function dialogFrom(children: unknown) {
  const first = Array.isArray(children) ? children[0] : children;
  if (
    !isValidElement<ComponentProps<typeof MaintenanceDialog>>(first) ||
    first.type !== MaintenanceDialog
  )
    throw new Error("Expected persistent dialog");
  return first;
}
it("renders the known shell before session or queries", () => {
  const shell = page();
  expect(shell.type).toBe(Suspense);
  expect(shell.props.fallback.type).toBe(AdminMaintenanceSkeleton);
  expect(requireOperatorPage).not.toHaveBeenCalled();
  expect(getMaintenanceList).not.toHaveBeenCalled();
  render(shell.props.fallback);
  expect(screen.getByRole("heading", { name: "점검" })).toBeVisible();
  expect(screen.getAllByRole("columnheader")).toHaveLength(6);
});
it("guards before all queries even when a complete preview URL was supplied", async () => {
  vi.mocked(requireOperatorPage).mockRejectedValue(new Error("LOGIN"));
  await expect(resolvePageContent(page(previewSearch()))).rejects.toThrow(
    "LOGIN",
  );
  expect(getMaintenanceList).not.toHaveBeenCalled();
  expect(previewMaintenance).not.toHaveBeenCalled();
});
it("reads one list and one shared RSC preview only after the page guard", async () => {
  const result = await resolvePageContent(
    page({ ...previewSearch(), reason: "URL에서 받아들이면 안 되는 이유" }),
  );
  expect(result.type).toBe(AdminMaintenance);
  expect(getMaintenanceList).toHaveBeenCalledExactlyOnceWith({
    branchId: maintenanceBranchId,
    tab: "active",
  });
  expect(previewMaintenance).toHaveBeenCalledExactlyOnceWith(
    maintenanceRequest().input,
  );
  expect(
    vi.mocked(requireOperatorPage).mock.invocationCallOrder[0],
  ).toBeLessThan(vi.mocked(getMaintenanceList).mock.invocationCallOrder[0]!);
  const dialog = dialogFrom(result.props.children);
  expect(dialog.props.initialRequest).toEqual(maintenanceRequest());
  expect(JSON.stringify(dialog.props)).not.toContain("URL에서");
  const preview = await resolvePageContent(dialog.props.children);
  expect(preview.props.result).toEqual({
    ok: true,
    data: maintenancePreviewFixture(),
  });
  expect(previewMaintenance).toHaveBeenCalledTimes(1);
});
it("opens create=1 without treating unknown preview as no conflicts", async () => {
  const result = await resolvePageContent(page({ create: "1" }));
  const dialog = dialogFrom(result.props.children);
  expect(dialog.props.kind).toBe("create");
  expect(dialog.props.initialRequest).toBeNull();
  expect(previewMaintenance).not.toHaveBeenCalled();
});
it.each([
  { space: "bad-id" },
  { start: ["now"] },
  { preview: "../secret" },
  { space: "d0000000-0000-4000-8000-000000000001" },
])(
  "does not query malformed or foreign-space previews: %j",
  async (invalid) => {
    const result = await resolvePageContent(
      page({ ...previewSearch(), ...invalid }),
    );
    expect(dialogFrom(result.props.children).props.initialRequest).toBeNull();
    expect(previewMaintenance).not.toHaveBeenCalled();
  },
);
it("does not query a preview for another space while editing", async () => {
  const row = maintenanceFixture().rows[1]!;
  const result = await resolvePageContent(
    page({ ...previewSearch(), dialog: "edit", block: row.id }),
  );
  expect(dialogFrom(result.props.children).props.row).toEqual(row);
  expect(previewMaintenance).not.toHaveBeenCalled();
});
it.each([
  new ActionError("FORBIDDEN"),
  new ActionError("NOT_FOUND"),
  new ActionError("INVALID_INPUT", {
    fieldErrors: { end: ["끝을 확인해 주세요"] },
  }),
])("keeps an unavailable preview inside the dialog", async (error) => {
  vi.mocked(previewMaintenance).mockRejectedValue(error);
  const result = await resolvePageContent(page(previewSearch()));
  const dialog = dialogFrom(result.props.children);
  const preview = await resolvePageContent(dialog.props.children);
  expect(preview.props.result).toEqual({
    ok: false,
    message: expect.any(String),
  });
});
it("does not open editing or deletion for ongoing rows", async () => {
  const row = maintenanceFixture().rows[0]!;
  for (const dialog of ["edit", "delete"]) {
    const result = await resolvePageContent(page({ dialog, block: row.id }));
    render(result.props.children as ReactNode);
    expect(previewMaintenance).not.toHaveBeenCalled();
  }
  expect(screen.getAllByRole("status")).toHaveLength(2);
});
it("maps list permission errors while not inventing empty data", async () => {
  vi.mocked(getMaintenanceList).mockRejectedValueOnce(
    new ActionError("FORBIDDEN"),
  );
  expect((await resolvePageContent(page())).type).toBe(AdminForbidden);
  vi.mocked(getMaintenanceList).mockRejectedValueOnce(
    new ActionError("NOT_FOUND"),
  );
  await expect(resolvePageContent(page())).rejects.toThrow("NOT_FOUND");
  vi.mocked(getMaintenanceList).mockRejectedValueOnce(
    new Error("database unavailable"),
  );
  await expect(resolvePageContent(page())).rejects.toThrow(
    "database unavailable",
  );
});

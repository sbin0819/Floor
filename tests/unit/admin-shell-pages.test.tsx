import { isValidElement, Suspense, type SuspenseProps } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import AdminLayout from "@/app/admin/layout";
import AdminBranchLayout from "@/app/admin/(shell)/branches/[branchId]/layout";
import AdminDashboardPage from "@/app/admin/(shell)/branches/[branchId]/page";
import { getAdminShell } from "@/features/admin/admin-shell-queries";
import { getSession, requireOperatorPage } from "@/lib/auth/session";
import { ActionError } from "@/lib/actions/result";
import { AdminForbidden } from "@/features/admin/components/admin-forbidden";
import { resolvePageContent } from "./page-test-utils";
import type { AdminMenu } from "@/features/admin/admin-shell-types";

vi.mock("@/features/admin/admin-shell-queries", () => ({
  getAdminShell: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(),
  requireOperatorPage: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (href: string) => {
    throw new Error(`REDIRECT:${href}`);
  },
  usePathname: () => "/admin",
  useRouter: () => ({ push: vi.fn() }),
}));
const session = {
  userId: "operator",
  name: "가상 운영자",
  email: "operator@example.test",
};
const props = () => ({ params: Promise.resolve({ branchId: "branch" }) });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(session);
  vi.mocked(requireOperatorPage).mockResolvedValue(session);
  vi.mocked(getAdminShell).mockResolvedValue({
    branchId: "branch",
    branches: [
      {
        id: "branch",
        name: "가상점",
        menus: ["dashboard", "bookings", "spaces"],
      },
    ],
    user: { name: session.name },
  });
});
it("returns fixed layout slots without waiting for the session, params, or menu data", () => {
  const layout = AdminBranchLayout({ ...props(), children: <p>내용</p> });
  expect(layout.props.sidebar.type).toBe(Suspense);
  expect(layout.props.mobile.type).toBe(Suspense);
  expect(getSession).not.toHaveBeenCalled();
  expect(getAdminShell).not.toHaveBeenCalled();
  expect(AdminDashboardPage(props()).type).toBe(Suspense);
  expect(requireOperatorPage).not.toHaveBeenCalled();
});
it("leaves the page in place while the session-only admin layout checks login", async () => {
  const layout = AdminLayout({ children: <p>내용</p> });
  const [boundary, child] = layout.props.children;
  expect(
    isValidElement<SuspenseProps>(boundary) && boundary.type === Suspense,
  ).toBe(true);
  expect(child).toEqual(<p>내용</p>);
  expect(getSession).not.toHaveBeenCalled();
  vi.mocked(getSession).mockResolvedValue(null);
  await expect(resolvePageContent(boundary)).rejects.toThrow(
    "REDIRECT:/admin/login",
  );
});
it("does not issue authenticated menu queries without a session", async () => {
  vi.mocked(getSession).mockResolvedValue(null);
  const layout = AdminBranchLayout({ ...props(), children: null });
  await resolvePageContent(layout.props.sidebar);
  expect(getAdminShell).not.toHaveBeenCalled();
});
it("requests its own layout branch and maps foreign branches to notFound", async () => {
  const layout = AdminBranchLayout({ ...props(), children: null });
  await resolvePageContent(layout.props.sidebar);
  expect(getAdminShell).toHaveBeenCalledWith("branch");
  vi.mocked(getAdminShell).mockRejectedValue(new ActionError("NOT_FOUND"));
  await expect(resolvePageContent(layout.props.mobile)).rejects.toThrow(
    "NOT_FOUND",
  );
});
it.each([
  [["bookings", "spaces"], "bookings"],
  [["spaces"], "spaces"],
] satisfies [AdminMenu[], string][])(
  "redirects a disabled dashboard to first authorized menu %j",
  async (menus, target) => {
    vi.mocked(getAdminShell).mockResolvedValue({
      branchId: "branch",
      branches: [{ id: "branch", name: "가상점", menus }],
      user: { name: session.name },
    });
    await expect(
      resolvePageContent(AdminDashboardPage(props())),
    ).rejects.toThrow(`REDIRECT:/admin/branches/branch/${target}`);
  },
);
it("renders permission denied without a redirect loop when all implemented menus are off", async () => {
  vi.mocked(getAdminShell).mockResolvedValue({
    branchId: "branch",
    branches: [{ id: "branch", name: "가상점", menus: [] }],
    user: { name: session.name },
  });
  expect(await resolvePageContent(AdminDashboardPage(props()))).toEqual(
    expect.objectContaining({ type: AdminForbidden }),
  );
});
it("guards the dashboard itself before querying the layout's menu contract", async () => {
  vi.mocked(requireOperatorPage).mockRejectedValue(new Error("LOGIN_REDIRECT"));
  await expect(resolvePageContent(AdminDashboardPage(props()))).rejects.toThrow(
    "LOGIN_REDIRECT",
  );
  expect(getAdminShell).not.toHaveBeenCalled();
});

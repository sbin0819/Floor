import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminShellNavigation } from "@/features/admin/components/admin-shell-navigation";
import {
  AdminShellFrame,
  AdminSidebarPending,
  AdminMobilePending,
} from "@/features/admin/components/admin-shell-frame";
import {
  adminBranchHref,
  adminMenuAt,
} from "@/features/admin/admin-shell-navigation";
import type { AdminShellData } from "@/features/admin/admin-shell-types";

const mocks = vi.hoisted(() => ({
  pathname: "/admin/branches/a/bookings",
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("@/components/sign-out-button", () => ({
  SignOutButton: () => <button>로그아웃</button>,
}));
const data: AdminShellData = {
  branchId: "a",
  user: { name: "가상 운영자" },
  branches: [
    { id: "a", name: "강남점", menus: ["dashboard", "bookings", "spaces"] },
    { id: "b", name: "성수점", menus: ["bookings", "spaces"] },
    { id: "c", name: "판교점", menus: [] },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.pathname = "/admin/branches/a/bookings";
  window.history.replaceState({}, "", mocks.pathname);
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

describe("admin branch navigation", () => {
  it("shows roles as the current menu and preserves it when changing branches", () => {
    mocks.pathname = "/admin/branches/a/roles";
    const current: AdminShellData = {
      ...data,
      branches: data.branches.map((branch) => ({
        ...branch,
        menus: ["roles"],
      })),
    };
    render(<AdminShellNavigation data={current} />);
    expect(screen.getByRole("link", { name: "역할과 권한" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(adminBranchHref(mocks.pathname, "a", current.branches[1]!)).toBe(
      "/admin/branches/b/roles",
    );
    expect(adminMenuAt("/admin/branches/a/roles-other", "a")).toBeNull();
  });
  it("shows the ongoing maintenance badge only with that menu and preserves maintenance when switching branches", () => {
    mocks.pathname = "/admin/branches/a/maintenance";
    const current: AdminShellData = {
      ...data,
      branches: data.branches.map((branch) => ({
        ...branch,
        menus: [...branch.menus, "maintenance"],
        maintenanceCount: 2,
      })),
    };
    render(<AdminShellNavigation data={current} />);
    const badge = screen.getByLabelText("진행 중인 점검 2개");
    expect(badge).toHaveTextContent("2");
    expect(badge.closest("a")).toHaveAttribute("aria-current", "page");
    expect(adminBranchHref(mocks.pathname, "a", current.branches[1]!)).toBe(
      "/admin/branches/b/maintenance",
    );
  });
  it.each([
    ["/admin/branches/a/bookings", 1, "/admin/branches/b/bookings"],
    ["/admin/branches/a/spaces", 1, "/admin/branches/b/spaces"],
    ["/admin/branches/a", 1, "/admin/branches/b/bookings"],
    ["/admin/branches/a/floors/f", 1, "/admin/branches/b/bookings"],
    ["/admin/branches/a/floors/f/spaces/s", 1, "/admin/branches/b/bookings"],
    ["/admin/branches/a/bookings", 2, "/admin/branches/c"],
  ] as const)(
    "switches %s to the visible menu of target %s",
    (path, index, href) => {
      expect(adminBranchHref(path, "a", data.branches[index]!)).toBe(href);
    },
  );
  it("does not treat other branch or prefix-similar routes as the current branch", () => {
    expect(adminMenuAt("/admin/branches/ab/bookings", "a")).toBeNull();
    expect(adminMenuAt("/admin/branches/a/bookings-other", "a")).toBeNull();
    expect(adminMenuAt("/admin/branches/a/floors/f", "a")).toBe("spaces");
  });
  it("shows only authorized implemented links and the server-selected branch in SSR", () => {
    const limited = { ...data, branchId: "b" };
    mocks.pathname = "/admin/branches/b/bookings";
    const html = renderToString(<AdminShellNavigation data={limited} />);
    expect(html).toContain("성수점");
    render(<AdminShellNavigation data={limited} />);
    const nav = screen.getByRole("navigation", { name: "운영자 메뉴" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((node) => node.textContent),
    ).toEqual(["예약 현황", "공간 관리"]);
    expect(
      screen.queryByRole("link", { name: "대시보드" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "예약 현황" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByText("가상 운영자")).toBeVisible();
    for (const label of ["점검", "공지", "역할과 권한", "평면도 편집", "신고"])
      expect(
        screen.queryByRole("link", { name: label }),
      ).not.toBeInTheDocument();
  });
  it("keeps ordinary link hrefs and modifier clicks while client navigation responds immediately", async () => {
    render(<AdminShellNavigation data={data} />);
    const link = screen.getByRole("link", { name: "공간 관리" });
    expect(link).toHaveAttribute("href", "/admin/branches/a/spaces");
    fireEvent.click(link, { ctrlKey: true });
    expect(mocks.push).not.toHaveBeenCalled();
    fireEvent.click(link);
    expect(mocks.push).toHaveBeenCalledWith("/admin/branches/a/spaces");
    await act(async () => {});
  });
  it("ignores a preserved branch's click after leaving its route", () => {
    render(<AdminShellNavigation data={data} />);
    window.history.replaceState({}, "", "/teams");
    fireEvent.click(screen.getByRole("link", { name: "공간 관리" }));
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it("changes branch through the accessible select and falls back to the target's first menu", async () => {
    mocks.pathname = "/admin/branches/a/floors/f";
    window.history.replaceState({}, "", mocks.pathname);
    const user = userEvent.setup();
    render(<AdminShellNavigation data={data} />);
    await user.click(
      screen.getByRole("combobox", { name: "운영 지점 바꾸기" }),
    );
    await user.click(screen.getByRole("option", { name: "성수점" }));
    expect(mocks.push).toHaveBeenCalledWith("/admin/branches/b/bookings");
  });
  it("opens one mobile sheet with trapped keyboard focus and restores the menu trigger", async () => {
    const user = userEvent.setup();
    render(<AdminShellNavigation data={data} mobile />);
    const trigger = screen.getByRole("button", { name: "운영자 메뉴 열기" });
    trigger.focus();
    await user.keyboard("{Enter}");
    const dialog = screen.getByRole("dialog", { name: "운영자 메뉴" });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveClass("size-11");
  });
  it("renders no branch name, permission link or user name in the frame's pending areas", () => {
    const { container } = render(
      <AdminShellFrame
        sidebar={<AdminSidebarPending />}
        mobile={<AdminMobilePending />}
      >
        <main>내용</main>
      </AdminShellFrame>,
    );
    expect(screen.getByRole("link", { name: "Floor" })).toHaveAttribute(
      "href",
      "/admin",
    );
    expect(screen.getByRole("link", { name: "멤버 화면으로" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.queryByText("강남점")).not.toBeInTheDocument();
    expect(screen.queryByText("가상 운영자")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "예약 현황" }),
    ).not.toBeInTheDocument();
    expect(container.querySelector("header")).toHaveClass(
      "sticky",
      "top-0",
      "z-45",
    );
  });
});

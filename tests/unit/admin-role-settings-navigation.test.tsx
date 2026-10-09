import { Activity, type ReactNode } from "react";
import Link from "next/link";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { AdminRoleSettings } from "@/features/admin/components/admin-role-settings";
import { AdminShellNavigation } from "@/features/admin/components/admin-shell-navigation";
import { requestAdminNavigation } from "@/features/admin/admin-navigation-guard";
import {
  roleSettingsBranchId,
  roleSettingsFixture,
  roleSettingsPath,
} from "@/tests/helpers/role-settings";
import type { AdminShellData } from "@/features/admin/admin-shell-types";

const mocks = vi.hoisted(() => ({
  pathname: "",
  router: { push: vi.fn(), refresh: vi.fn() },
  signOut: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  usePathname: () => mocks.pathname,
}));
vi.mock("@/features/admin/role-settings-actions", () => ({
  updateRoleSettings: vi.fn(),
  resetRoleSettings: vi.fn(),
}));
vi.mock("@/lib/auth/client", () => ({
  authClient: { signOut: mocks.signOut },
}));
vi.mock("@/lib/auth/redirect-after-sign-out", () => ({
  redirectAfterSignOut: mocks.redirect,
}));
const shell: AdminShellData = {
  branchId: roleSettingsBranchId,
  user: { name: "가상 운영자" },
  branches: [
    { id: roleSettingsBranchId, name: "강남점", menus: ["dashboard", "roles"] },
    { id: "other", name: "판교점", menus: ["roles"] },
  ],
};
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.pathname = roleSettingsPath;
  window.history.replaceState({}, "", roleSettingsPath);
  mocks.signOut.mockResolvedValue({ error: null });
});
function provide(children: ReactNode, client = new QueryClient()) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function editor() {
  return <AdminRoleSettings data={roleSettingsFixture()} />;
}
function dirty() {
  fireEvent.click(
    within(screen.getByRole("table", { name: "역할별 권한" })).getByRole(
      "switch",
      { name: "팀원: 개인으로 예약" },
    ),
  );
}
it("leaves ordinary anchors intact, blocks current-tab internal links once and restores focus on Escape", async () => {
  const user = userEvent.setup();
  render(
    provide(
      <>
        {editor()}
        <Link href="/teams">팀으로</Link>
      </>,
    ),
  );
  dirty();
  const link = screen.getByRole("link", { name: "팀으로" });
  expect(link).toHaveAttribute("href", "/teams");
  await user.click(link);
  expect(mocks.router.push).not.toHaveBeenCalled();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  await user.keyboard("{Escape}");
  expect(link).toHaveFocus();
  expect(screen.getByText("바꾼 것 1개")).toBeVisible();
  await user.click(link);
  await user.click(screen.getByRole("button", { name: "저장하지 않고 이동" }));
  await waitFor(() =>
    expect(mocks.router.push).toHaveBeenCalledExactlyOnceWith("/teams"),
  );
});
it("ignores modified clicks, other targets, downloads, external URLs, and hash-only links", () => {
  render(
    provide(
      <>
        {editor()}
        <a href="/teams" target="_blank">
          새 창
        </a>
        <a href="/manual" download>
          내려받기
        </a>
        <a href="https://example.test/">외부</a>
        <a href={`${roleSettingsPath}#limits`}>한도</a>
        <Link href="/teams">팀</Link>
      </>,
    ),
  );
  dirty();
  for (const name of ["새 창", "내려받기", "외부", "한도"])
    fireEvent.click(screen.getByRole("link", { name }));
  fireEvent.click(screen.getByRole("link", { name: "팀" }), { ctrlKey: true });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(mocks.router.push).not.toHaveBeenCalled();
});
it("blocks the menu's imperative router navigation and branch Select before optimistic selection", async () => {
  const user = userEvent.setup();
  render(
    provide(
      <>
        <AdminShellNavigation data={shell} />
        {editor()}
      </>,
    ),
  );
  dirty();
  await user.click(screen.getByRole("link", { name: "대시보드" }));
  expect(mocks.router.push).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "계속 편집하기" }));
  await user.click(screen.getByRole("combobox", { name: "운영 지점 바꾸기" }));
  await user.click(screen.getByRole("option", { name: "판교점" }));
  expect(
    screen.getByRole("dialog", { name: "저장하지 않고 떠날까요?" }),
  ).toBeVisible();
  expect(mocks.router.push).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "저장하지 않고 이동" }));
  await waitFor(() =>
    expect(mocks.router.push).toHaveBeenCalledExactlyOnceWith(
      "/admin/branches/other/roles",
    ),
  );
});
it("asks before authentication writes, rearms after failed logout, and retains the draft", async () => {
  const user = userEvent.setup();
  mocks.signOut.mockResolvedValueOnce({ error: { message: "private error" } });
  render(
    provide(
      <>
        <AdminShellNavigation data={shell} />
        {editor()}
      </>,
    ),
  );
  dirty();
  await user.click(screen.getByRole("button", { name: "로그아웃" }));
  expect(mocks.signOut).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "저장하지 않고 이동" }));
  await waitFor(() => expect(mocks.signOut).toHaveBeenCalledOnce());
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "로그아웃하지 못했어요",
  );
  expect(mocks.redirect).not.toHaveBeenCalled();
  expect(screen.getByText("바꾼 것 1개")).toBeVisible();
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  await user.click(screen.getByRole("button", { name: "로그아웃" }));
  expect(mocks.signOut).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "저장하지 않고 이동" }));
  await waitFor(() =>
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith("/login"),
  );
  const successfulUnload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(successfulUnload);
  expect(successfulUnload.defaultPrevented).toBe(false);
});
it("only registers beforeunload while dirty and removes it on undo/unmount", () => {
  const view = render(provide(editor()));
  const event = () => {
    const value = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(value);
    return value.defaultPrevented;
  };
  expect(event()).toBe(false);
  dirty();
  expect(event()).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "되돌리기" }));
  expect(event()).toBe(false);
  dirty();
  view.unmount();
  expect(event()).toBe(false);
});
it("allows browser Back/Activity and restores the same draft without intercepting another page", async () => {
  const data = roleSettingsFixture();
  const client = new QueryClient();
  const tree = (mode: "visible" | "hidden") =>
    provide(
      <Activity mode={mode}>
        <AdminRoleSettings data={data} />
      </Activity>,
      client,
    );
  const view = render(tree("visible"));
  dirty();
  const proceed = vi.fn();
  window.history.replaceState({}, "", "/teams");
  window.dispatchEvent(new PopStateEvent("popstate"));
  view.rerender(tree("hidden"));
  act(() => requestAdminNavigation(proceed));
  expect(proceed).toHaveBeenCalledOnce();
  window.history.replaceState({}, "", roleSettingsPath);
  view.rerender(tree("visible"));
  expect(screen.getByText("바꾼 것 1개")).toBeVisible();
  act(() => requestAdminNavigation(proceed));
  expect(proceed).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("dialog")).toBeVisible();
  view.unmount();
  act(() => requestAdminNavigation(proceed));
  expect(proceed).toHaveBeenCalledTimes(2);
});
it("does not execute an old confirmation after leaving its branch path", () => {
  render(provide(editor()));
  dirty();
  const proceed = vi.fn();
  act(() => requestAdminNavigation(proceed));
  window.history.replaceState({}, "", "/admin/branches/other/roles");
  fireEvent.click(screen.getByRole("button", { name: "저장하지 않고 이동" }));
  expect(proceed).not.toHaveBeenCalled();
});
it("rearms dirty protection when a synchronous router continuation fails", async () => {
  render(provide(editor()));
  dirty();
  const proceed = vi.fn(() => {
    throw new Error("navigation failed");
  });
  act(() => requestAdminNavigation(proceed));
  fireEvent.click(screen.getByRole("button", { name: "저장하지 않고 이동" }));
  await waitFor(() => expect(proceed).toHaveBeenCalledOnce());
  const next = vi.fn();
  act(() => requestAdminNavigation(next));
  expect(next).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeVisible();
});

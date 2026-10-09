import { Activity, type ReactNode } from "react";
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
import { toast } from "sonner";
import {
  AdminRoleSettings,
  staleRoleSettingsMessage,
} from "@/features/admin/components/admin-role-settings";
import {
  updateRoleSettings,
  resetRoleSettings,
} from "@/features/admin/role-settings-actions";
import {
  roleSettingsBranchId,
  roleSettingsFixture,
  roleSettingsPath,
} from "@/tests/helpers/role-settings";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/features/admin/role-settings-actions", () => ({
  updateRoleSettings: vi.fn(),
  resetRoleSettings: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", roleSettingsPath);
  vi.mocked(updateRoleSettings).mockResolvedValue({
    ok: true,
    data: { updatedAt: "2026-10-09T03:00:00.000Z" },
  });
  vi.mocked(resetRoleSettings).mockResolvedValue({
    ok: true,
    data: { updatedAt: null },
  });
});
function provider(
  children: ReactNode,
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } }),
) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function matrix() {
  return within(screen.getByRole("table", { name: "역할별 권한" }));
}
function toggle(name: string) {
  return matrix().getByRole("switch", { name });
}
function limits() {
  return within(screen.getByRole("table", { name: "예약 한도" }));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("renders all fourteen ordered rows, locked switch descriptions and readonly team permissions", () => {
  const { container } = render(
    provider(<AdminRoleSettings data={roleSettingsFixture()} />),
  );
  expect(matrix().getAllByRole("row")).toHaveLength(15);
  expect(matrix().getAllByRole("switch")).toHaveLength(56);
  expect(toggle("운영자: 역할과 권한 바꾸기")).toBeChecked();
  expect(toggle("운영자: 역할과 권한 바꾸기")).toBeDisabled();
  expect(toggle("운영자: 역할과 권한 바꾸기")).toHaveAccessibleDescription(
    "끌 수 없어요",
  );
  expect(
    toggle("일반 사용자: 공지 보내기, 라운지·신고 관리"),
  ).not.toBeChecked();
  expect(
    toggle("일반 사용자: 공지 보내기, 라운지·신고 관리"),
  ).toHaveAccessibleDescription("운영자만 가질 수 있어요");
  expect(toggle("팀원: 팀 스페이스 쓰기")).toBeChecked();
  expect(toggle("팀원: 팀 스페이스 쓰기")).toHaveAccessibleDescription(
    "팀 안의 권한이라 지점에서 바꿀 수 없어요",
  );
  expect(screen.getByText("바꾼 것 0개")).toBeVisible();
  expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  expect(container.querySelector("header")).toHaveClass(
    "sticky",
    "top-[var(--admin-mobile-header-height,0px)]",
  );
});
it("counts changed cells once, supports keyboard toggling and restores the server snapshot", async () => {
  const user = userEvent.setup();
  const data = roleSettingsFixture();
  data.roles.user.permissions = [];
  data.roles.user.stored = true;
  render(provider(<AdminRoleSettings data={data} />));
  const target = toggle("일반 사용자: 개인으로 예약");
  target.focus();
  await user.keyboard(" ");
  expect(target).toBeChecked();
  expect(target).toHaveFocus();
  expect(screen.getByText("바꾼 것 1개")).toBeVisible();
  expect(matrix().getByRole("img", { name: "바꾼 칸" })).toHaveClass(
    "bg-status-busy-strong",
  );
  await user.click(screen.getByRole("button", { name: "되돌리기" }));
  expect(target).not.toBeChecked();
  expect(screen.getByText("바꾼 것 0개")).toBeVisible();
});
it("does not invent dirty cells from malformed historical locked values, nor normalize untouched roles", async () => {
  const user = userEvent.setup();
  const data = roleSettingsFixture();
  data.roles.user.permissions.push("space.manage");
  data.roles.operator.permissions = [];
  render(provider(<AdminRoleSettings data={data} />));
  expect(toggle("일반 사용자: 공간·점검 관리")).not.toBeChecked();
  expect(toggle("운영자: 역할과 권한 바꾸기")).toBeChecked();
  expect(screen.getByText("바꾼 것 0개")).toBeVisible();
  await user.click(toggle("팀원: 개인으로 예약"));
  await user.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(updateRoleSettings).toHaveBeenCalledTimes(1));
  expect(vi.mocked(updateRoleSettings).mock.calls[0]).toHaveLength(1);
  expect(updateRoleSettings).toHaveBeenCalledWith({
    branchId: roleSettingsBranchId,
    expectedUpdatedAt: null,
    roles: [expect.objectContaining({ role: "team_member" })],
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("keeps undefined defaults distinct from unlimited and restores omitted fields when returning to the original value", async () => {
  const user = userEvent.setup();
  const data = roleSettingsFixture();
  data.roles.user.limits = {};
  render(provider(<AdminRoleSettings data={data} />));
  const select = limits().getByRole("combobox", {
    name: "일반 사용자: 한 번에 최대",
  });
  expect(select).toHaveTextContent("2시간");
  await user.click(select);
  await user.click(screen.getByRole("option", { name: "제한 없음" }));
  expect(screen.getByText("바꾼 것 1개")).toBeVisible();
  await user.click(select);
  await user.click(screen.getByRole("option", { name: "2시간" }));
  expect(screen.getByText("바꾼 것 0개")).toBeVisible();
  await user.click(toggle("팀원: 개인으로 예약"));
  await user.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(updateRoleSettings).toHaveBeenCalledTimes(1));
  expect(updateRoleSettings).toHaveBeenCalledWith(
    expect.objectContaining({
      roles: [expect.objectContaining({ role: "team_member" })],
    }),
  );
});
it("warns for rights inherited from user and restores focus when the confirmation is cancelled", async () => {
  const user = userEvent.setup();
  render(provider(<AdminRoleSettings data={roleSettingsFixture()} />));
  await user.click(toggle("일반 사용자: 평면도·공간 보기"));
  const save = screen.getByRole("button", { name: "저장" });
  await user.click(save);
  const dialog = screen.getByRole("dialog", { name: "내 권한도 꺼져요" });
  expect(within(dialog).getByText("평면도·공간 보기")).toBeVisible();
  expect(updateRoleSettings).not.toHaveBeenCalled();
  await user.keyboard("{Escape}");
  expect(save).toHaveFocus();
  await user.click(save);
  await user.click(screen.getByRole("button", { name: "권한을 끄고 저장" }));
  await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
  expect(screen.getByText("바꾼 것 0개")).toBeVisible();
  expect(toast.success).toHaveBeenCalledWith(
    "저장했어요. 이미 잡힌 예약은 바뀌지 않고, 다음 예약부터 적용돼요",
  );
});
it("keeps input DOM and draft on STALE until an explicit reload returns fresh props", async () => {
  const user = userEvent.setup();
  const data = roleSettingsFixture();
  const client = new QueryClient();
  vi.mocked(updateRoleSettings).mockResolvedValueOnce({
    ok: false,
    code: "STALE",
  });
  const view = render(provider(<AdminRoleSettings data={data} />, client));
  const target = toggle("팀원: 개인으로 예약");
  await user.click(target);
  await user.click(screen.getByRole("button", { name: "저장" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    staleRoleSettingsMessage,
  );
  expect(toggle("팀원: 개인으로 예약")).toBe(target);
  expect(target).toBeChecked();
  const fresh = roleSettingsFixture();
  fresh.updatedAt = "2026-10-09T02:00:00Z";
  view.rerender(provider(<AdminRoleSettings data={fresh} />, client));
  expect(target).toBeChecked();
  await user.click(screen.getByRole("button", { name: "새로 불러오기" }));
  expect(router.replace).toHaveBeenCalledOnce();
  const href = vi.mocked(router.replace).mock.calls[0]![0] as string;
  const key = new URL(href, window.location.href).searchParams.get("reload")!;
  expect(key).toMatch(/^[0-9a-f-]{36}$/);
  view.rerender(
    provider(
      <AdminRoleSettings data={{ ...fresh }} readKey="outdated" />,
      client,
    ),
  );
  expect(target).toBeChecked();
  expect(screen.getByRole("button", { name: "불러오는 중…" })).toBeDisabled();
  view.rerender(
    provider(<AdminRoleSettings data={{ ...fresh }} readKey={key} />, client),
  );
  expect(toggle("팀원: 개인으로 예약")).toBe(target);
  expect(target).not.toBeChecked();
  expect(screen.getByText("바꾼 것 0개")).toBeVisible();
});
it("does not let a late pre-save RSC response restore old permissions or version", async () => {
  const user = userEvent.setup();
  const client = new QueryClient();
  const data = roleSettingsFixture();
  const view = render(provider(<AdminRoleSettings data={data} />, client));
  await user.click(toggle("팀원: 개인으로 예약"));
  await user.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(router.refresh).toHaveBeenCalledOnce());
  view.rerender(provider(<AdminRoleSettings data={{ ...data }} />, client));
  expect(toggle("팀원: 개인으로 예약")).toBeChecked();
  await user.click(toggle("팀원: 평면도·공간 보기"));
  await user.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(updateRoleSettings).toHaveBeenCalledTimes(2));
  expect(vi.mocked(updateRoleSettings).mock.calls[1]![0]).toMatchObject({
    expectedUpdatedAt: "2026-10-09T03:00:00.000Z",
  });
});
it("keeps reset defaults against an old RSC response while a matching explicit reload can accept null", async () => {
  const user = userEvent.setup();
  const client = new QueryClient();
  const data = roleSettingsFixture();
  data.roles.user.permissions = [];
  data.updatedAt = "2026-10-09T02:00:00.000Z";
  const view = render(provider(<AdminRoleSettings data={data} />, client));
  await user.click(screen.getByRole("button", { name: "기본값으로 되돌리기" }));
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "기본값으로 되돌리기",
    }),
  );
  await waitFor(() => expect(resetRoleSettings).toHaveBeenCalledOnce());
  view.rerender(provider(<AdminRoleSettings data={{ ...data }} />, client));
  expect(toggle("일반 사용자: 개인으로 예약")).toBeChecked();
  vi.mocked(updateRoleSettings).mockResolvedValueOnce({
    ok: false,
    code: "STALE",
  });
  await user.click(toggle("팀원: 개인으로 예약"));
  await user.click(screen.getByRole("button", { name: "저장" }));
  await screen.findByRole("alert");
  await user.click(screen.getByRole("button", { name: "새로 불러오기" }));
  const key = new URL(
    router.replace.mock.calls[0]![0] as string,
    window.location.href,
  ).searchParams.get("reload")!;
  view.rerender(
    provider(
      <AdminRoleSettings data={roleSettingsFixture()} readKey={key} />,
      client,
    ),
  );
  expect(toggle("팀원: 개인으로 예약")).not.toBeChecked();
});
it("never applies a deferred A save to a different branch instance after Activity restoration", async () => {
  const pending = deferred<Awaited<ReturnType<typeof updateRoleSettings>>>();
  vi.mocked(updateRoleSettings).mockReturnValue(pending.promise);
  const client = new QueryClient();
  const data = roleSettingsFixture();
  const other = {
    ...roleSettingsFixture(),
    branch: { id: "other", name: "다른점", timezone: "Asia/Seoul" },
    context: { branchId: "other", isOperator: true as const },
  };
  const tree = (mode: "visible" | "hidden", value = data) =>
    provider(
      <Activity mode={mode}>
        <AdminRoleSettings data={value} />
      </Activity>,
      client,
    );
  const view = render(tree("visible"));
  fireEvent.click(toggle("팀원: 개인으로 예약"));
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(updateRoleSettings).toHaveBeenCalledOnce());
  window.history.replaceState({}, "", "/admin/branches/other/roles");
  view.rerender(tree("hidden", other));
  await act(async () =>
    pending.resolve({ ok: true, data: { updatedAt: "2026-10-09T03:00:00Z" } }),
  );
  view.rerender(tree("visible", other));
  expect(toggle("팀원: 개인으로 예약")).not.toBeChecked();
  expect(screen.getByText("다른점")).toBeVisible();
  expect(router.refresh).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
});
it("only calls reset after confirmation and sends the exact optimistic concurrency timestamp", async () => {
  const user = userEvent.setup();
  const data = roleSettingsFixture();
  data.updatedAt = "2026-10-09T01:00:00.000Z";
  data.roles.user.permissions = [];
  render(provider(<AdminRoleSettings data={data} />));
  await user.click(screen.getByRole("button", { name: "기본값으로 되돌리기" }));
  expect(resetRoleSettings).not.toHaveBeenCalled();
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "기본값으로 되돌리기",
    }),
  );
  await waitFor(() =>
    expect(resetRoleSettings).toHaveBeenCalledExactlyOnceWith({
      branchId: roleSettingsBranchId,
      expectedUpdatedAt: data.updatedAt,
    }),
  );
  expect(toggle("일반 사용자: 개인으로 예약")).toBeChecked();
});
it("deduplicates immediate submits and does not refresh or toast over another route", async () => {
  const result = deferred<Awaited<ReturnType<typeof updateRoleSettings>>>();
  vi.mocked(updateRoleSettings).mockReturnValue(result.promise);
  render(provider(<AdminRoleSettings data={roleSettingsFixture()} />));
  fireEvent.click(toggle("팀원: 개인으로 예약"));
  const save = screen.getByRole("button", { name: "저장" });
  fireEvent.click(save);
  fireEvent.click(save);
  await waitFor(() => expect(updateRoleSettings).toHaveBeenCalledTimes(1));
  window.history.replaceState({}, "", "/teams");
  await act(async () =>
    result.resolve({ ok: true, data: { updatedAt: "2026-10-09T03:00:00Z" } }),
  );
  expect(router.refresh).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
});
it("preserves a Back/Activity draft, removes hidden blockers, and restores a late failed save once", async () => {
  const result = deferred<Awaited<ReturnType<typeof updateRoleSettings>>>();
  vi.mocked(updateRoleSettings).mockReturnValue(result.promise);
  const client = new QueryClient();
  const data = roleSettingsFixture();
  const tree = (mode: "hidden" | "visible") =>
    provider(
      <Activity mode={mode}>
        <AdminRoleSettings data={data} />
      </Activity>,
      client,
    );
  const view = render(tree("visible"));
  const target = toggle("팀원: 개인으로 예약");
  fireEvent.click(target);
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(updateRoleSettings).toHaveBeenCalledOnce());
  window.history.replaceState({}, "", "/teams");
  view.rerender(tree("hidden"));
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(false);
  await act(async () => result.resolve({ ok: false, code: "STALE" }));
  expect(router.refresh).not.toHaveBeenCalled();
  window.history.replaceState({}, "", roleSettingsPath);
  window.dispatchEvent(new PopStateEvent("popstate"));
  view.rerender(tree("visible"));
  expect(toggle("팀원: 개인으로 예약")).toBe(target);
  expect(target).toBeChecked();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    staleRoleSettingsMessage,
  );
});
it("shows mobile role accordions below 1024 and preserves expanded sections while toggling", () => {
  const { container } = render(
    provider(<AdminRoleSettings data={roleSettingsFixture()} />),
  );
  const section = screen.getByRole("region", {
    name: "역할별 권한과 예약 한도",
  });
  expect(section).toHaveClass("lg:hidden");
  expect(
    screen.getByRole("table", { name: "역할별 권한" }).closest("section"),
  ).toHaveClass("hidden", "lg:block");
  const details = section.querySelectorAll("details")[1]!;
  fireEvent.click(details.querySelector("summary")!);
  details.open = true;
  fireEvent.click(
    within(details).getByRole("switch", { name: "팀원: 개인으로 예약" }),
  );
  expect(details.open).toBe(true);
  expect(container.querySelectorAll("details")).toHaveLength(4);
});

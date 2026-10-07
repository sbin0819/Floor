import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { AccessEditor } from "@/features/admin/components/access-editor";
import { setFloorAccess, setSpaceAccess } from "@/features/admin/actions";
import type { AdminFloorData, AdminSpace } from "@/features/admin/types";
import {
  adminFloorFixture,
  adminIds,
  adminSpaceFixture,
} from "./admin-ui-fixtures";
const navigation = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => "/admin/branches/branch/floors/floor",
}));
vi.mock("@/features/admin/actions", () => ({
  setFloorAccess: vi.fn(),
  setSpaceAccess: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(setFloorAccess).mockResolvedValue({
    ok: true,
    data: { floorId: adminIds.floor, changedSpaces: [] },
  });
  vi.mocked(setSpaceAccess).mockResolvedValue({
    ok: true,
    data: { spaceId: adminIds.space },
  });
});
function display(data: AdminFloorData, space?: AdminSpace) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AccessEditor data={data} space={space} />
    </QueryClientProvider>,
  );
}
it("disables everyone when the floor is team-only with a connected reason", () => {
  const data = adminFloorFixture();
  data.floor.access = "teams";
  display(data, adminSpaceFixture());
  expect(screen.getByRole("radio", { name: "모두" })).toBeDisabled();
  expect(
    screen.getByRole("radio", { name: "모두" }),
  ).toHaveAccessibleDescription('층이 "지정한 팀"이라 고를 수 없어요');
  expect(screen.getByRole("radio", { name: "층 설정을 따름" })).toBeEnabled();
});
it("disables everyone and teams for a closed floor", () => {
  const data = adminFloorFixture();
  data.floor.access = "closed";
  display(data, adminSpaceFixture());
  expect(screen.getByRole("radio", { name: "모두" })).toBeDisabled();
  expect(screen.getByRole("radio", { name: "지정한 팀" })).toBeDisabled();
  expect(screen.getByRole("radio", { name: "닫힘" })).toBeEnabled();
});
it("keeps access controls read-only without editAccess", () => {
  const data = adminFloorFixture();
  data.permissions.editAccess = false;
  display(data);
  expect(screen.getByRole("radio", { name: "모두" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  expect(screen.getByRole("radio", { name: "모두" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "이용 대상 저장" })).toBeDisabled();
});
it("keeps archived space access read-only even when management is permitted", () => {
  const space = adminSpaceFixture();
  space.archivedAt = "2026-10-07T00:00:00Z";
  display(adminFloorFixture(), space);
  expect(screen.getByRole("radio", { name: "모두" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "이용 대상 저장" })).toBeDisabled();
});
it("validates at least one team and connects the group error", async () => {
  display(adminFloorFixture());
  await userEvent.click(screen.getByRole("radio", { name: "지정한 팀" }));
  await userEvent.click(screen.getByRole("button", { name: "이용 대상 저장" }));
  expect(setFloorAccess).not.toHaveBeenCalled();
  expect(
    screen.getByRole("textbox", { name: "팀 이름으로 찾기" }),
  ).toHaveAttribute("aria-invalid", "true");
  expect(
    screen.getByRole("group", { name: "허용할 팀" }),
  ).toHaveAccessibleDescription("이용할 팀을 1곳 이상 20곳 이하로 골라 주세요");
});
it("searches through URL query and selects a server-provided result", async () => {
  const data = adminFloorFixture();
  data.teamSearch = {
    query: "가상",
    valid: true,
    results: [
      { id: adminIds.team, name: "가상팀", homeBranchName: "가상 강남점" },
    ],
  };
  display(data);
  await userEvent.click(screen.getByRole("radio", { name: "지정한 팀" }));
  await userEvent.click(screen.getByRole("button", { name: "찾기" }));
  expect(navigation.replace).toHaveBeenCalledWith(
    "/admin/branches/branch/floors/floor?team=%EA%B0%80%EC%83%81",
    { scroll: false },
  );
  await userEvent.click(
    within(screen.getByRole("list", { name: "팀 검색 결과" })).getByRole(
      "button",
      { name: "선택" },
    ),
  );
  expect(
    within(screen.getByRole("list", { name: "고른 팀" })).getByText("가상팀"),
  ).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "이용 대상 저장" }));
  await waitFor(() =>
    expect(setFloorAccess).toHaveBeenCalledWith({
      floorId: adminIds.floor,
      access: "teams",
      teamIds: [adminIds.team],
    }),
  );
  expect(navigation.refresh).toHaveBeenCalledOnce();
});
it("does not allow teams outside a restricted floor", async () => {
  const data = adminFloorFixture();
  data.floor.access = "teams";
  data.floor.allowedTeams = [];
  data.teamSearch = {
    query: "가상",
    valid: true,
    results: [{ id: adminIds.team, name: "가상팀", homeBranchName: null }],
  };
  display(data, adminSpaceFixture());
  await userEvent.click(screen.getByRole("radio", { name: "지정한 팀" }));
  expect(screen.getByRole("button", { name: "선택" })).toBeDisabled();
});
it("does not impose the floor's twenty-team limit on a space", async () => {
  const data = adminFloorFixture();
  const space = adminSpaceFixture();
  space.access = "teams";
  space.allowedTeams = Array.from({ length: 20 }, (_, index) => ({
    id: `40000000-0000-4000-8000-${String(index + 2).padStart(12, "0")}`,
    name: `팀${index + 2}`,
  }));
  data.teamSearch = {
    query: "가상",
    valid: true,
    results: [{ id: adminIds.team, name: "가상팀", homeBranchName: null }],
  };
  display(data, space);
  expect(screen.getByRole("button", { name: "선택" })).toBeEnabled();
  await userEvent.click(screen.getByRole("button", { name: "선택" }));
  await userEvent.click(screen.getByRole("button", { name: "이용 대상 저장" }));
  await waitFor(() => expect(setSpaceAccess).toHaveBeenCalled());
  expect(
    (vi.mocked(setSpaceAccess).mock.calls[0]![0] as { teamIds: string[] })
      .teamIds,
  ).toHaveLength(21);
});
it("announces automatically adjusted and closed space names", async () => {
  vi.mocked(setFloorAccess).mockResolvedValue({
    ok: true,
    data: {
      floorId: adminIds.floor,
      changedSpaces: [
        { id: adminIds.space, name: "회의실 A", access: "closed" },
      ],
    },
  });
  display(adminFloorFixture());
  await userEvent.click(screen.getByRole("button", { name: "이용 대상 저장" }));
  expect(
    await screen.findByText(
      "저장했어요. 공간 1곳의 이용 대상도 층에 맞게 바뀌었어요. 회의실 A은 쓸 수 있는 팀이 없어 닫힘이 됐어요",
    ),
  ).toBeVisible();
});
it("clears grants from the payload when a non-team choice is saved", async () => {
  const data = adminFloorFixture();
  data.floor.access = "teams";
  data.floor.allowedTeams = [{ id: adminIds.team, name: "가상팀" }];
  display(data);
  await userEvent.click(screen.getByRole("radio", { name: "닫힘" }));
  await userEvent.click(screen.getByRole("button", { name: "이용 대상 저장" }));
  await waitFor(() =>
    expect(setFloorAccess).toHaveBeenCalledWith({
      floorId: adminIds.floor,
      access: "closed",
      teamIds: [],
    }),
  );
});

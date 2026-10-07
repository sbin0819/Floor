import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BranchForm } from "@/features/admin/components/branch-form";
import { FloorForm } from "@/features/admin/components/floor-form";
import { SpaceForm } from "@/features/admin/components/space-form";
import { SpaceTable } from "@/features/admin/components/space-table";
import { AdminNav } from "@/features/admin/components/admin-nav";
import { adminErrorMessage } from "@/features/admin/components/use-admin-mutation";
import {
  createSpace,
  updateSpace,
  updateBranch,
  createFloor,
  updateFloor,
  archiveSpace,
  restoreSpace,
} from "@/features/admin/actions";
import type { ActionResult } from "@/lib/actions/result";
import {
  adminBranchFixture,
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
  updateBranch: vi.fn(),
  createFloor: vi.fn(),
  updateFloor: vi.fn(),
  createSpace: vi.fn(),
  updateSpace: vi.fn(),
  archiveSpace: vi.fn(),
  restoreSpace: vi.fn(),
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
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createSpace).mockResolvedValue({
    ok: true,
    data: { spaceId: adminIds.space },
  });
  vi.mocked(updateSpace).mockResolvedValue({
    ok: true,
    data: { spaceId: adminIds.space },
  });
  vi.mocked(updateBranch).mockResolvedValue({
    ok: true,
    data: { branchId: adminIds.branch },
  });
  vi.mocked(createFloor).mockResolvedValue({
    ok: true,
    data: { floorId: adminIds.floor },
  });
  vi.mocked(updateFloor).mockResolvedValue({
    ok: true,
    data: { floorId: adminIds.floor },
  });
  vi.mocked(archiveSpace).mockResolvedValue({
    ok: true,
    data: { spaceId: adminIds.space },
  });
  vi.mocked(restoreSpace).mockResolvedValue({
    ok: true,
    data: { spaceId: adminIds.space },
  });
});
function display(children: ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      {children}
    </QueryClientProvider>,
  );
}

describe("space management forms", () => {
  it("validates required fields and connects errors to inputs", async () => {
    display(<SpaceForm floorId={adminIds.floor} canManage />);
    await userEvent.click(screen.getByRole("button", { name: "공간 더하기" }));
    expect(createSpace).not.toHaveBeenCalled();
    expect(screen.getByLabelText("공간 이름")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByLabelText("정원")).toHaveAccessibleDescription(
      "정원을 입력해 주세요",
    );
  });
  it("renders server duplicate-name errors beside the field", async () => {
    vi.mocked(updateSpace).mockResolvedValue({
      ok: false,
      code: "INVALID_INPUT",
      fieldErrors: { name: ["이 층에 같은 이름의 공간이 있어요"] },
    });
    display(
      <SpaceForm
        floorId={adminIds.floor}
        space={adminSpaceFixture()}
        canManage
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "공간 정보 저장" }),
    );
    expect(
      await screen.findByText("이 층에 같은 이름의 공간이 있어요"),
    ).toBeVisible();
    expect(screen.getByLabelText("공간 이름")).toHaveAccessibleDescription(
      "이 층에 같은 이름의 공간이 있어요",
    );
  });
  it("forces lounge booking off and allows an empty capacity", async () => {
    display(<SpaceForm floorId={adminIds.floor} canManage />);
    await userEvent.click(screen.getByRole("combobox", { name: "종류" }));
    await userEvent.click(screen.getByRole("option", { name: "라운지" }));
    expect(screen.getByRole("switch", { name: "예약 가능" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "예약 가능" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await userEvent.type(screen.getByLabelText("공간 이름"), "휴식 라운지");
    await userEvent.click(screen.getByRole("button", { name: "공간 더하기" }));
    await waitFor(() =>
      expect(createSpace).toHaveBeenCalledWith({
        floorId: adminIds.floor,
        type: "lounge",
        name: "휴식 라운지",
        capacity: null,
        bookable: false,
        amenities: [],
      }),
    );
  });
  it("does not send immutable type or floor when updating", async () => {
    display(
      <SpaceForm
        floorId={adminIds.floor}
        space={adminSpaceFixture()}
        canManage
      />,
    );
    expect(screen.getByRole("combobox", { name: "종류" })).toBeDisabled();
    await userEvent.click(
      screen.getByRole("button", { name: "공간 정보 저장" }),
    );
    await waitFor(() =>
      expect(updateSpace).toHaveBeenCalledWith({
        spaceId: adminIds.space,
        name: "회의실 A",
        capacity: 6,
        bookable: true,
        amenities: ["monitor"],
      }),
    );
    expect(vi.mocked(updateSpace).mock.calls[0]).toHaveLength(1);
  });
  it("validates an existing non-lounge empty capacity before sending", async () => {
    display(
      <SpaceForm
        floorId={adminIds.floor}
        space={adminSpaceFixture()}
        canManage
      />,
    );
    await userEvent.clear(screen.getByLabelText("정원"));
    await userEvent.click(
      screen.getByRole("button", { name: "공간 정보 저장" }),
    );
    expect(updateSpace).not.toHaveBeenCalled();
    expect(screen.getByLabelText("정원")).toHaveAccessibleDescription(
      "정원을 입력해 주세요",
    );
  });
  it("locks immediate repeated and parallel submissions then refreshes", async () => {
    let finish!: (value: ActionResult<{ spaceId: string }>) => void;
    vi.mocked(updateSpace).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    display(
      <>
        <SpaceForm
          floorId={adminIds.floor}
          space={adminSpaceFixture()}
          canManage
        />
        <FloorForm
          branchId={adminIds.branch}
          floor={adminFloorFixture().floor}
        />
      </>,
    );
    const form = screen
      .getByRole("button", { name: "공간 정보 저장" })
      .closest("form")!;
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
      fireEvent.submit(
        screen.getByRole("button", { name: "층 정보 저장" }).closest("form")!,
      );
    });
    await waitFor(() => expect(updateSpace).toHaveBeenCalledTimes(1));
    expect(updateFloor).not.toHaveBeenCalled();
    expect(
      screen.getAllByRole("button", { name: "저장하고 있어요" })[0],
    ).toBeDisabled();
    await act(async () =>
      finish({ ok: true, data: { spaceId: adminIds.space } }),
    );
    await waitFor(() => expect(navigation.refresh).toHaveBeenCalledOnce());
  });
  it("keeps information visible but read only without permission", () => {
    display(
      <SpaceForm
        floorId={adminIds.floor}
        space={adminSpaceFixture()}
        canManage={false}
      />,
    );
    expect(screen.getByLabelText("공간 이름")).toHaveValue("회의실 A");
    expect(screen.getByLabelText("공간 이름")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "공간 정보 저장" }),
    ).toBeDisabled();
  });
});
describe("branch hours and floors", () => {
  it("toggles closed-day selectors and submits all seven days and raw blank address", async () => {
    const branch = adminBranchFixture().branch;
    branch.address = null;
    display(<BranchForm branch={branch} canManage />);
    await userEvent.click(
      screen.getByRole("switch", { name: "월요일 쉬는 날" }),
    );
    expect(screen.getByLabelText("월요일 시작")).toBeDisabled();
    expect(screen.getByLabelText("월요일 끝")).toBeDisabled();
    await userEvent.click(
      screen.getByRole("button", { name: "지점 정보 저장" }),
    );
    await waitFor(() => expect(updateBranch).toHaveBeenCalled());
    const input = vi.mocked(updateBranch).mock.calls[0]![0] as {
      address: string;
      openHours: Record<string, unknown>;
    };
    expect(input.address).toBe("");
    expect(Object.keys(input.openHours)).toHaveLength(7);
    expect(input.openHours.mon).toBeNull();
  });
  it("rejects reversed operating hours in the actual selectors", async () => {
    display(<BranchForm branch={adminBranchFixture().branch} canManage />);
    await userEvent.click(screen.getByLabelText("월요일 끝"));
    await userEvent.click(screen.getByRole("option", { name: "08:30" }));
    await userEvent.click(
      screen.getByRole("button", { name: "지점 정보 저장" }),
    );
    expect(updateBranch).not.toHaveBeenCalled();
    expect(screen.getByLabelText("월요일 끝")).toHaveAccessibleDescription(
      "종료 시각은 시작 시각보다 늦어야 해요",
    );
  });
  it("creates a floor with an omitted default sort order", async () => {
    display(<FloorForm branchId={adminIds.branch} />);
    await userEvent.type(screen.getByLabelText("층 번호"), "8");
    await userEvent.type(screen.getByLabelText("층 이름"), "8F");
    await userEvent.click(screen.getByRole("button", { name: "층 더하기" }));
    await waitFor(() =>
      expect(createFloor).toHaveBeenCalledWith({
        branchId: adminIds.branch,
        level: 8,
        name: "8F",
      }),
    );
  });
  it("shows floor number uniqueness errors", async () => {
    vi.mocked(updateFloor).mockResolvedValue({
      ok: false,
      code: "INVALID_INPUT",
      fieldErrors: { level: ["이미 있는 층이에요"] },
    });
    display(
      <FloorForm
        branchId={adminIds.branch}
        floor={adminFloorFixture().floor}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "층 정보 저장" }));
    expect(await screen.findByText("이미 있는 층이에요")).toBeVisible();
  });
});
describe("space table", () => {
  it("allows archived space information edits while preserving archived state", async () => {
    const data = adminFloorFixture();
    data.spaces[0]!.archivedAt = "2026-10-07T00:00:00Z";
    display(<SpaceTable data={data} />);
    await userEvent.click(
      screen.getByRole("switch", { name: "보관된 공간 보기" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "고치기" }));
    expect(screen.getByLabelText("공간 이름")).toBeEnabled();
    await userEvent.click(
      screen.getByRole("button", { name: "공간 정보 저장" }),
    );
    await waitFor(() => expect(updateSpace).toHaveBeenCalled());
    expect(
      (vi.mocked(updateSpace).mock.calls[0]![0] as Record<string, unknown>)
        .archivedAt,
    ).toBeUndefined();
  });
  it("displays the duplicate-name field message when restore has no input form", async () => {
    vi.mocked(restoreSpace).mockResolvedValue({
      ok: false,
      code: "INVALID_INPUT",
      fieldErrors: { name: ["이 층에 같은 이름의 공간이 있어요"] },
    });
    const data = adminFloorFixture();
    data.spaces[0]!.archivedAt = "2026-10-07T00:00:00Z";
    display(<SpaceTable data={data} />);
    await userEvent.click(
      screen.getByRole("switch", { name: "보관된 공간 보기" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "되살리기" }));
    expect(
      await screen.findByText("이 층에 같은 이름의 공간이 있어요"),
    ).toBeVisible();
  });
  it("hides archived rows by default and restores them without editing", async () => {
    const data = adminFloorFixture();
    data.spaces[0]!.archivedAt = "2026-10-07T00:00:00Z";
    display(<SpaceTable data={data} />);
    expect(screen.queryByText("회의실 A")).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("switch", { name: "보관된 공간 보기" }),
    );
    expect(screen.getByText("보관됨")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "되살리기" }));
    await waitFor(() =>
      expect(restoreSpace).toHaveBeenCalledWith({ spaceId: adminIds.space }),
    );
  });
  it("requires confirmation to archive and shows SPACE_IN_USE", async () => {
    vi.mocked(archiveSpace).mockResolvedValue({
      ok: false,
      code: "SPACE_IN_USE",
    });
    display(<SpaceTable data={adminFloorFixture()} />);
    await userEvent.click(screen.getByRole("button", { name: "보관" }));
    expect(archiveSpace).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "보관하기" }),
    );
    expect(
      await within(dialog).findByText(adminErrorMessage("SPACE_IN_USE")),
    ).toBeVisible();
  });
  it("keys editing forms by target so previous inputs do not leak", async () => {
    const data = adminFloorFixture();
    data.spaces.push({
      ...adminSpaceFixture(),
      id: "30000000-0000-4000-8000-000000000002",
      name: "회의실 B",
    });
    display(<SpaceTable data={data} />);
    await userEvent.click(
      screen.getAllByRole("button", { name: "고치기" })[0]!,
    );
    await userEvent.clear(screen.getByLabelText("공간 이름"));
    await userEvent.type(screen.getByLabelText("공간 이름"), "남기지 않음");
    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    await userEvent.click(
      screen.getAllByRole("button", { name: "고치기" })[1]!,
    );
    expect(screen.getByLabelText("공간 이름")).toHaveValue("회의실 B");
  });
});
it("shows only implemented admin menu links with active location", () => {
  render(<AdminNav />);
  expect(screen.getByRole("link", { name: "지점" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getAllByRole("link")).toHaveLength(2);
  expect(screen.getByRole("link", { name: "멤버 화면으로" })).toHaveAttribute(
    "href",
    "/",
  );
});

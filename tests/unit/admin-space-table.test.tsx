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
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SpaceTable } from "@/features/admin/components/space-table";
import {
  archiveSpace,
  restoreSpace,
  updateSpace,
} from "@/features/admin/actions";
import type { AdminFloorData } from "@/features/admin/types";
import type { ActionResult } from "@/lib/actions/result";
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
  archiveSpace: vi.fn(),
  restoreSpace: vi.fn(),
  updateSpace: vi.fn(),
  createSpace: vi.fn(),
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
  for (const action of [archiveSpace, restoreSpace, updateSpace])
    vi.mocked(action).mockResolvedValue({
      ok: true,
      data: { spaceId: adminIds.space },
    });
});
function display(data = adminFloorFixture()) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const content = (value: AdminFloorData) => (
    <QueryClientProvider client={client}>
      <SpaceTable data={value} />
    </QueryClientProvider>
  );
  const result = render(content(data));
  return {
    ...result,
    rerenderData: (value: AdminFloorData) => result.rerender(content(value)),
  };
}
async function choose(name: string, action: string) {
  await userEvent.click(screen.getByRole("button", { name: `${name} 동작` }));
  await userEvent.click(screen.getByRole("menuitem", { name: action }));
}

describe("grouped operator space table", () => {
  it("groups five space types, sorts names within a group and exposes six columns", () => {
    const data = adminFloorFixture();
    data.spaces = [
      { ...adminSpaceFixture(), id: "z", name: "회의실 Z" },
      {
        ...adminSpaceFixture(),
        id: "lounge",
        type: "lounge",
        name: "라운지",
        bookable: false,
      },
      {
        ...adminSpaceFixture(),
        id: "area",
        type: "desk_area",
        name: "데스크 구역",
        bookable: false,
        deskCount: 8,
      },
      {
        ...adminSpaceFixture(),
        id: "phone",
        type: "phone_booth",
        name: "폰부스",
      },
      {
        ...adminSpaceFixture(),
        id: "seminar",
        type: "seminar",
        name: "세미나실",
      },
      adminSpaceFixture(),
    ];
    display(data);
    const tables = screen.getAllByRole("table");
    expect(tables).toHaveLength(5);
    expect(
      tables.map((table) => table.querySelector("caption")?.textContent),
    ).toEqual([
      "회의실 공간 관리",
      "세미나실 공간 관리",
      "폰부스 공간 관리",
      "데스크 구역 공간 관리",
      "라운지 공간 관리",
    ]);
    expect(
      within(tables[0]!)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["이름", "정원", "예약 가능", "편의 시설", "이용 대상", "동작"]);
    expect(within(tables[0]!).getAllByRole("row")[1]).toHaveTextContent(
      "회의실 A",
    );
    expect(within(tables[0]!).getAllByRole("row")[2]).toHaveTextContent(
      "회의실 Z",
    );
    const areaName = screen.getByText("좌석 8석").closest("td")!;
    expect(areaName).toHaveTextContent("데스크 구역");
    expect(
      screen.getAllByText("예약 가능", { selector: ".sr-only" }),
    ).toHaveLength(4);
    expect(
      screen.getAllByText("예약 불가", { selector: ".sr-only" }),
    ).toHaveLength(2);
    expect(screen.getAllByText("층 설정을 따름")[0]).toHaveAttribute(
      "data-slot",
      "badge",
    );
    expect(screen.getAllByText("모니터", { exact: true })).toHaveLength(6);
    expect(within(tables[3]!).getByText("모니터")).toBeVisible();
  });

  it("hides archived rows until enabled, then renders a dimmed row and explicit badge", async () => {
    const data = adminFloorFixture();
    data.spaces[0]!.archivedAt = "2026-10-07T00:00:00Z";
    display(data);
    expect(
      screen.queryByRole("button", { name: "회의실 A 동작" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("switch", { name: "보관된 공간 보기" }),
    );
    expect(screen.getByText("보관됨")).toHaveAttribute("data-slot", "badge");
    expect(screen.getByText("보관됨").closest("tr")).toHaveClass("opacity-50");
  });

  it("focuses the access heading after the menu opens the shared dialog and restores the trigger", async () => {
    display();
    const trigger = screen.getByRole("button", { name: "회의실 A 동작" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "이용 대상" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "공간 이용 대상" }),
      ).toHaveFocus(),
    );
    expect(screen.getByLabelText("공간 이름")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("opens edit at the first enabled input and restores focus after closing", async () => {
    display();
    const trigger = screen.getByRole("button", { name: "회의실 A 동작" });
    await choose("회의실 A", "고치기");
    await waitFor(() =>
      expect(screen.getByLabelText("공간 이름")).toHaveFocus(),
    );
    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("restores the row menu focus after dismissing the archive confirmation", async () => {
    display();
    const trigger = screen.getByRole("button", { name: "회의실 A 동작" });
    await choose("회의실 A", "보관");
    expect(screen.getByRole("dialog")).toHaveAccessibleName(
      "이 공간을 보관할까요?",
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(archiveSpace).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "keeps read-only edit and access entries operable on an archived=%s space",
    async (archived) => {
      const data = adminFloorFixture();
      data.permissions = { manageSpaces: false, editAccess: false };
      if (archived) data.spaces[0]!.archivedAt = "2026-10-07T00:00:00Z";
      display(data);
      if (archived)
        await userEvent.click(
          screen.getByRole("switch", { name: "보관된 공간 보기" }),
        );
      await userEvent.click(
        screen.getByRole("button", { name: "회의실 A 동작" }),
      );
      for (const name of ["고치기", "이용 대상"])
        expect(screen.getByRole("menuitem", { name })).not.toHaveAttribute(
          "aria-disabled",
          "true",
        );
      const blocked = screen.getByRole("menuitem", {
        name: archived ? "되살리기" : "보관",
      });
      expect(blocked).toHaveAttribute("aria-disabled", "true");
      expect(blocked).toHaveAccessibleDescription(
        "공간을 보관하거나 되살릴 권한이 없어요",
      );
      await userEvent.click(
        screen.getByRole("menuitem", { name: "이용 대상" }),
      );
      expect(
        screen.getByText("읽기 전용이에요. 공간 정보를 고칠 권한이 없어요"),
      ).toBeVisible();
      expect(
        screen.getByText("읽기 전용이에요. 이용 대상을 고칠 권한이 없어요"),
      ).toBeVisible();
      expect(screen.getByLabelText("공간 이름")).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "이용 대상 저장" }),
      ).toBeDisabled();
      expect(archiveSpace).not.toHaveBeenCalled();
      expect(restoreSpace).not.toHaveBeenCalled();
    },
  );

  it.each<[AdminFloorData["permissions"], boolean, boolean]>([
    [{ manageSpaces: false, editAccess: true }, true, false],
    [{ manageSpaces: true, editAccess: false }, false, true],
  ])(
    "preserves independent permissions %j",
    async (permissions, infoDisabled, accessDisabled) => {
      display({ ...adminFloorFixture(), permissions });
      await choose("회의실 A", "고치기");
      expect(screen.getByLabelText("공간 이름").hasAttribute("disabled")).toBe(
        infoDisabled,
      );
      expect(
        screen
          .getByRole("button", { name: "이용 대상 저장" })
          .hasAttribute("disabled"),
      ).toBe(accessDisabled);
    },
  );

  it("preserves archived information editing but keeps access read-only", async () => {
    const data = adminFloorFixture();
    data.spaces[0]!.archivedAt = "2026-10-07T00:00:00Z";
    display(data);
    await userEvent.click(
      screen.getByRole("switch", { name: "보관된 공간 보기" }),
    );
    await choose("회의실 A", "이용 대상");
    expect(screen.getByLabelText("공간 이름")).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "이용 대상 저장" }),
    ).toBeDisabled();
  });

  it("keeps the table mounted during archive and refreshing and prevents duplicate confirmation", async () => {
    let resolve: (result: ActionResult<{ spaceId: string }>) => void = () => {};
    const deferred = new Promise<ActionResult<{ spaceId: string }>>((done) => {
      resolve = done;
    });
    vi.mocked(archiveSpace).mockReturnValue(deferred);
    display();
    await choose("회의실 A", "보관");
    const submit = screen.getByRole("button", { name: "보관하기" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(archiveSpace).toHaveBeenCalledTimes(1));
    expect(submit).toBeDisabled();
    expect(screen.getByRole("table", { hidden: true })).toBeInTheDocument();
    expect(document.querySelector('[data-slot="skeleton-region"]')).toBeNull();
    await act(async () => {
      resolve({ ok: true, data: { spaceId: adminIds.space } });
      await deferred;
    });
    await waitFor(() => expect(navigation.refresh).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("table")).toBeVisible();
    expect(document.querySelector('[data-slot="skeleton-region"]')).toBeNull();
  });

  it("keeps the table mounted while saving and refreshing space information", async () => {
    let resolve: (result: ActionResult<{ spaceId: string }>) => void = () => {};
    const deferred = new Promise<ActionResult<{ spaceId: string }>>((done) => {
      resolve = done;
    });
    vi.mocked(updateSpace).mockReturnValue(deferred);
    display();
    await choose("회의실 A", "고치기");
    fireEvent.click(screen.getByRole("button", { name: "공간 정보 저장" }));
    await waitFor(() => expect(updateSpace).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("table", { hidden: true })).toBeInTheDocument();
    expect(document.querySelector('[data-slot="skeleton-region"]')).toBeNull();
    await act(async () => {
      resolve({ ok: true, data: { spaceId: adminIds.space } });
      await deferred;
    });
    await waitFor(() => expect(navigation.refresh).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("table")).toBeVisible();
    expect(document.querySelector('[data-slot="skeleton-region"]')).toBeNull();
  });

  it.each([false, true])(
    "returns focus to the persistent heading when an archived row is removed with delayed refresh=%s",
    async (delayed) => {
      const data = adminFloorFixture();
      const { rerenderData } = display(data);
      const removeArchivedRow = () =>
        rerenderData({
          ...data,
          spaces: data.spaces.map((space) => ({
            ...space,
            archivedAt: "2026-10-07T00:00:00Z",
          })),
        });
      if (!delayed)
        navigation.refresh.mockImplementationOnce(removeArchivedRow);
      await choose("회의실 A", "보관");
      await userEvent.click(screen.getByRole("button", { name: "보관하기" }));
      if (delayed) {
        await waitFor(() =>
          expect(
            screen.getByRole("button", { name: "회의실 A 동작" }),
          ).toHaveFocus(),
        );
        removeArchivedRow();
      }
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: "공간" })).toHaveFocus(),
      );
      expect(
        screen.queryByRole("button", { name: "회의실 A 동작" }),
      ).not.toBeInTheDocument();
      expect(archiveSpace).toHaveBeenCalledTimes(1);
    },
  );
});

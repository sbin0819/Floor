import { Activity, Suspense, use, type ReactNode } from "react";
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
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import {
  AdminMaintenance,
  AdminMaintenanceSkeleton,
} from "@/features/admin/components/admin-maintenance";
import {
  MaintenanceDialog,
  staleMaintenanceMessage,
} from "@/features/admin/components/maintenance-dialog";
import {
  MaintenancePreview,
  type MaintenancePreviewResult,
} from "@/features/admin/components/maintenance-preview";
import { MaintenanceEndButton } from "@/features/admin/components/maintenance-end-button";
import { MaintenanceFields } from "@/features/admin/components/maintenance-fields";
import {
  createMaintenance,
  updateMaintenance,
  endMaintenance,
  deleteMaintenance,
} from "@/features/admin/maintenance-actions";
import {
  maintenanceHref,
  maintenancePath,
  maintenancePreviewHref,
  maintenancePreviewRequest,
  type MaintenanceRequest,
} from "@/features/admin/maintenance-navigation";
import {
  maintenanceBlockId,
  maintenanceBranchId,
  maintenanceFixture,
  maintenancePreviewFixture,
  maintenanceRequest,
} from "@/tests/helpers/maintenance";

const navigation = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/features/admin/maintenance-actions", () => ({
  createMaintenance: vi.fn(),
  updateMaintenance: vi.fn(),
  endMaintenance: vi.fn(),
  deleteMaintenance: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
beforeEach(() => {
  vi.clearAllMocks();
  navigation.replace.mockImplementation((href: string) =>
    window.history.replaceState({}, "", href),
  );
  vi.mocked(createMaintenance).mockResolvedValue({
    ok: true,
    data: { blockId: maintenanceBlockId, cancelledCount: 1 },
  });
  vi.mocked(updateMaintenance).mockResolvedValue({
    ok: true,
    data: { blockId: maintenanceBlockId, cancelledCount: 0 },
  });
  vi.mocked(endMaintenance).mockResolvedValue({
    ok: true,
    data: { blockId: maintenanceBlockId },
  });
  vi.mocked(deleteMaintenance).mockResolvedValue({
    ok: true,
    data: { blockId: maintenanceBlockId },
  });
  window.history.replaceState(
    {},
    "",
    maintenancePreviewHref(
      maintenanceBranchId,
      new URLSearchParams({ dialog: "create" }),
      maintenanceRequest(),
    ),
  );
});
function queryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}
function provide(children: ReactNode, client = queryClient()) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function result(count = 1): MaintenancePreviewResult {
  return { ok: true, data: maintenancePreviewFixture(count) };
}
function preview(request = maintenanceRequest(), value = result()) {
  return (
    <MaintenancePreview
      requestKey={`${request.inputKey}:${request.nonce}`}
      result={value}
      timezone="Asia/Seoul"
    />
  );
}
function editor(children = preview(), request = maintenanceRequest()) {
  return (
    <MaintenanceDialog
      data={maintenanceFixture()}
      kind="create"
      initialRequest={request}
    >
      {children}
    </MaintenanceDialog>
  );
}
function latestRequest() {
  const value = maintenancePreviewRequest(
    Object.fromEntries(new URLSearchParams(window.location.search)),
  );
  if (!value) throw new Error("Missing requested preview");
  return value;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function submitForm() {
  fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
}

describe("maintenance lists and dialogs", () => {
  it("first paints known title, tabs and table columns without false zero or emptiness", () => {
    render(<AdminMaintenanceSkeleton />);
    expect(
      screen.getByRole("heading", { name: "점검" }).closest("header"),
    ).toHaveClass("sticky", "top-[var(--admin-mobile-header-height,0px)]");
    expect(screen.getAllByRole("columnheader")).toHaveLength(6);
    expect(screen.getByRole("status")).toHaveTextContent(
      "점검을 불러오고 있어요",
    );
    expect(screen.queryByText(/0건|점검이 없어요/)).toBeNull();
  });
  it("uses shared real data in table/mobile cards and only state-appropriate actions", () => {
    render(<AdminMaintenance data={maintenanceFixture()} />);
    expect(screen.getByRole("table").parentElement).toHaveClass(
      "hidden",
      "lg:block",
    );
    expect(screen.getByRole("list", { name: "점검 목록" })).toHaveClass(
      "lg:hidden",
    );
    const table = within(screen.getByRole("table"));
    expect(
      table.getByRole("link", { name: "해제 · 회의실 C" }),
    ).toHaveAttribute("href", expect.stringContaining("dialog=end"));
    expect(
      table.getByRole("link", { name: "고치기 · 오픈 데스크 A-12" }),
    ).toHaveAttribute("href", expect.stringContaining("dialog=edit"));
    expect(table.queryByRole("link", { name: "고치기 · 회의실 C" })).toBeNull();
    expect(screen.getByRole("link", { name: "점검 등록" })).toHaveAttribute(
      "href",
      expect.stringContaining("dialog=create"),
    );
  });
  it("keeps a single dialog and the same reason input while the preview streams", async () => {
    const pending = deferred<MaintenancePreviewResult>();
    function PendingPreview() {
      return preview(maintenanceRequest(), use(pending.promise));
    }
    render(
      provide(
        editor(
          <Suspense fallback={null}>
            <PendingPreview />
          </Suspense>,
        ),
      ),
    );
    const dialog = screen.getByRole("dialog");
    const field = screen.getByLabelText("이유 (멤버에게 보여요)");
    fireEvent.change(field, { target: { value: "모니터 교체" } });
    field.focus();
    expect(screen.getByRole("button", { name: "점검 등록" })).toBeDisabled();
    expect(screen.queryByText("겹치는 예약이 없어요")).toBeNull();
    await act(async () => {
      pending.resolve(result(3));
    });
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByLabelText("이유 (멤버에게 보여요)")).toBe(field);
    expect(field).toHaveFocus();
    expect(field).toHaveValue("모니터 교체");
    expect(
      screen.getByRole("button", { name: "점검 등록 · 예약 3건 취소" }),
    ).toBeEnabled();
    expect(navigation.replace).not.toHaveBeenCalled();
  });
  it("uses only accepted ids, never preview names, and calls its action with one argument", async () => {
    render(provide(editor()));
    fireEvent.change(screen.getByLabelText("이유 (멤버에게 보여요)"), {
      target: { value: "모니터 교체" },
    });
    submitForm();
    submitForm();
    await waitFor(() => expect(createMaintenance).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createMaintenance).mock.calls[0]).toEqual([
      {
        ...maintenanceRequest().input,
        reason: "모니터 교체",
        expectedBookingIds: maintenancePreviewFixture().bookings.map(
          (booking) => booking.id,
        ),
      },
    ]);
    await waitFor(() => expect(navigation.refresh).toHaveBeenCalledTimes(1));
  });
  it("debounces window changes for 300ms, rejects old results, and never puts the reason in the URL", async () => {
    vi.useFakeTimers();
    try {
      const client = queryClient();
      const initial = maintenanceRequest();
      const mounted = render(
        provide(editor(preview(initial), initial), client),
      );
      fireEvent.change(screen.getByLabelText("이유 (멤버에게 보여요)"), {
        target: { value: "로그에 남기지 않을 이유" },
      });
      await act(async () => {
        vi.advanceTimersByTime(400);
      });
      expect(navigation.replace).not.toHaveBeenCalled();
      fireEvent.change(screen.getByLabelText("끝"), {
        target: { value: "2026-10-14T15:00" },
      });
      expect(screen.getByRole("button", { name: "점검 등록" })).toBeDisabled();
      await act(async () => {
        vi.advanceTimersByTime(299);
      });
      expect(navigation.replace).not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      const requested = latestRequest();
      expect(requested.input.end).toBe("2026-10-14T06:00:00.000Z");
      expect(window.location.search).not.toMatch(/reason|로그/);
      mounted.rerender(
        provide(editor(preview(initial, result(2)), requested), client),
      );
      expect(screen.queryByText("겹치는 예약이 없어요")).toBeNull();
      expect(screen.getByRole("button", { name: "점검 등록" })).toBeDisabled();
      mounted.rerender(
        provide(editor(preview(requested, result(0)), requested), client),
      );
      expect(screen.getByRole("button", { name: "점검 등록" })).toBeEnabled();
      expect(screen.getByLabelText("이유 (멤버에게 보여요)")).toHaveValue(
        "로그에 남기지 않을 이유",
      );
    } finally {
      vi.useRealTimers();
    }
  });
  it("does not read incomplete time and does not turn missing preview into zero bookings", async () => {
    vi.useFakeTimers();
    try {
      render(provide(editor()));
      fireEvent.change(screen.getByLabelText("끝"), { target: { value: "" } });
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(navigation.replace).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "점검 등록" })).toBeDisabled();
      expect(screen.queryByText("겹치는 예약이 없어요")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
  it("does not revive the first A preview after A → B → A, even if replies arrive out of order", async () => {
    vi.useFakeTimers();
    try {
      const client = queryClient();
      const initial = maintenanceRequest();
      const mounted = render(provide(editor(), client));
      fireEvent.change(screen.getByLabelText("끝"), {
        target: { value: "2026-10-14T15:00" },
      });
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      const second = latestRequest();
      fireEvent.change(screen.getByLabelText("끝"), {
        target: { value: "2026-10-14T14:00" },
      });
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      const third = latestRequest();
      expect(third.inputKey).toBe(initial.inputKey);
      expect(third.nonce).not.toBe(initial.nonce);
      for (const old of [second, initial]) {
        mounted.rerender(
          provide(editor(preview(old, result(0)), third), client),
        );
        expect(
          screen.getByRole("button", { name: "점검 등록" }),
        ).toBeDisabled();
      }
      mounted.rerender(
        provide(editor(preview(third, result(3)), third), client),
      );
      expect(
        screen.getByRole("button", { name: "점검 등록 · 예약 3건 취소" }),
      ).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });
  it("keeps field failures associated with the actual inputs for screen readers", () => {
    render(
      <MaintenanceFields
        draft={{
          spaceId: "",
          startKind: "at",
          startAt: "",
          end: "",
          reason: "",
        }}
        spaces={maintenanceFixture().spaces}
        editing={false}
        pending={false}
        errors={{
          spaceId: "공간 오류",
          start: "시작 오류",
          end: "끝 오류",
          reason: "이유 오류",
        }}
        onChange={() => {}}
      />,
    );
    for (const [name, text] of [
      ["공간", "공간 오류"],
      ["시작", "시작 오류"],
      ["끝", "끝 오류"],
      ["이유 (멤버에게 보여요)", "이유 오류"],
    ]) {
      const field = screen.getByLabelText(name!);
      expect(field).toHaveAccessibleDescription(text!);
      expect(field).toHaveAttribute("aria-invalid", "true");
    }
  });
  it("supports keyboard space search and selection without making a query immediately", async () => {
    render(provide(editor()));
    const space = screen.getByRole("combobox", { name: "공간" });
    space.focus();
    await userEvent.keyboard("{Enter}");
    const search = screen.getByRole("combobox", {
      name: "층 · 공간 이름으로 찾기",
    });
    await userEvent.type(search, "A-12");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(space).toHaveTextContent("오픈 데스크 A-12");
    expect(space).toHaveFocus();
    expect(navigation.replace).not.toHaveBeenCalled();
  });
  it("closes before a delayed preview and restores the visible persistent trigger only", async () => {
    const pending = deferred<MaintenancePreviewResult>();
    function PendingPreview() {
      return preview(maintenanceRequest(), use(pending.promise));
    }
    render(
      provide(
        <>
          <button data-maintenance-create style={{ display: "none" }}>
            숨긴 등록
          </button>
          <button data-maintenance-create>보이는 등록</button>
          {editor(
            <Suspense fallback={null}>
              <PendingPreview />
            </Suspense>,
          )}
        </>,
      ),
    );
    const trigger = screen.getByRole("button", {
      name: "보이는 등록",
      hidden: true,
    });
    const rectangle = DOMRect.fromRect({ x: 0, y: 0, width: 100, height: 44 });
    vi.spyOn(trigger, "getClientRects").mockReturnValue({
      0: rectangle,
      length: 1,
      item: () => rectangle,
      [Symbol.iterator]: () => [rectangle][Symbol.iterator](),
    });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    await act(async () => {
      pending.resolve(result(3));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(navigation.replace).toHaveBeenCalledTimes(1);
  });
  it("keeps its draft and focus on STALE but requires a new nonce preview before another submit", async () => {
    vi.mocked(createMaintenance).mockResolvedValueOnce({
      ok: false,
      code: "STALE",
    });
    const client = queryClient();
    const initial = maintenanceRequest();
    const mounted = render(provide(editor(), client));
    const dialog = screen.getByRole("dialog"),
      field = screen.getByLabelText("이유 (멤버에게 보여요)");
    fireEvent.change(field, { target: { value: "모니터 교체" } });
    field.focus();
    submitForm();
    await screen.findByText(staleMaintenanceMessage);
    const requested = latestRequest();
    expect(requested.nonce).not.toBe(initial.nonce);
    expect(requested.inputKey).toBe(initial.inputKey);
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(field).toHaveValue("모니터 교체");
    expect(field).toHaveFocus();
    expect(screen.getByRole("button", { name: "점검 등록" })).toBeDisabled();
    submitForm();
    expect(createMaintenance).toHaveBeenCalledTimes(1);
    mounted.rerender(
      provide(editor(preview(initial, result(0)), requested), client),
    );
    expect(screen.getByRole("button", { name: "점검 등록" })).toBeDisabled();
    mounted.rerender(
      provide(editor(preview(requested, result(2)), requested), client),
    );
    expect(
      screen.getByRole("button", { name: "점검 등록 · 예약 2건 취소" }),
    ).toBeEnabled();
  });
  it("does not reopen or navigate when closed during a pending write", async () => {
    const pending = deferred<Awaited<ReturnType<typeof createMaintenance>>>();
    vi.mocked(createMaintenance).mockReturnValue(pending.promise);
    render(provide(editor()));
    fireEvent.change(screen.getByLabelText("이유 (멤버에게 보여요)"), {
      target: { value: "점검" },
    });
    submitForm();
    await waitFor(() => expect(createMaintenance).toHaveBeenCalled());
    await userEvent.click(
      within(screen.getByRole("dialog").querySelector("form")!).getByRole(
        "button",
        { name: "닫기" },
      ),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    navigation.replace.mockClear();
    await act(async () => {
      pending.resolve({
        ok: true,
        data: { blockId: maintenanceBlockId, cancelledCount: 1 },
      });
    });
    expect(navigation.refresh).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
  it("ignores a late response after another dialog or route owns the URL", async () => {
    const pending = deferred<Awaited<ReturnType<typeof createMaintenance>>>();
    vi.mocked(createMaintenance).mockReturnValue(pending.promise);
    render(provide(editor()));
    fireEvent.change(screen.getByLabelText("이유 (멤버에게 보여요)"), {
      target: { value: "점검" },
    });
    submitForm();
    await waitFor(() => expect(createMaintenance).toHaveBeenCalled());
    window.history.replaceState(
      {},
      "",
      maintenanceHref(maintenanceBranchId, {
        dialog: "end",
        block: maintenanceBlockId,
      }),
    );
    await act(async () => {
      pending.resolve({
        ok: true,
        data: { blockId: maintenanceBlockId, cancelledCount: 1 },
      });
    });
    expect(navigation.refresh).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
  it("cleans the debounce while Activity is hidden and resumes the current draft only on return", async () => {
    vi.useFakeTimers();
    try {
      const client = queryClient();
      const tree = (mode: "visible" | "hidden") =>
        provide(<Activity mode={mode}>{editor()}</Activity>, client);
      const mounted = render(tree("visible"));
      fireEvent.change(screen.getByLabelText("끝"), {
        target: { value: "2026-10-14T15:00" },
      });
      mounted.rerender(tree("hidden"));
      window.history.replaceState({}, "", "/");
      await act(async () => {
        vi.advanceTimersByTime(400);
      });
      expect(navigation.replace).not.toHaveBeenCalled();
      window.history.replaceState(
        {},
        "",
        `${maintenancePath(maintenanceBranchId)}?dialog=create`,
      );
      mounted.rerender(tree("visible"));
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      expect(navigation.replace).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("끝")).toHaveValue("2026-10-14T15:00");
    } finally {
      vi.useRealTimers();
    }
  });
  it("edits the fixed space and passes block id without create's space id", async () => {
    const data = maintenanceFixture();
    const row = data.rows[1]!;
    window.history.replaceState(
      {},
      "",
      maintenanceHref(data.branch.id, { dialog: "edit", block: row.id }),
    );
    const input = {
      spaceId: row.space.id,
      start: { kind: "at" as const, at: row.start },
      end: row.end,
    };
    const request: MaintenanceRequest = {
      input,
      inputKey: JSON.stringify([row.space.id, row.start, row.end]),
      nonce: "edit",
    };
    render(
      provide(
        <MaintenanceDialog
          data={data}
          kind="edit"
          row={row}
          initialRequest={request}
        >
          {preview(request, result(0))}
        </MaintenanceDialog>,
      ),
    );
    expect(screen.getByRole("combobox", { name: "공간" })).toBeDisabled();
    submitForm();
    await waitFor(() =>
      expect(updateMaintenance).toHaveBeenCalledExactlyOnceWith({
        blockId: row.id,
        start: input.start,
        end: input.end,
        reason: row.reason,
        expectedBookingIds: [],
      }),
    );
  });
  it("restores the persistent menu button rather than the edit link after closing deletion", async () => {
    const data = maintenanceFixture();
    const row = data.rows[1]!;
    window.history.replaceState(
      {},
      "",
      maintenanceHref(data.branch.id, { dialog: "delete", block: row.id }),
    );
    render(
      provide(
        <>
          <div data-maintenance-trigger={row.id}>
            <a href="#edit">고치기</a>
            <button>점검 메뉴</button>
          </div>
          <MaintenanceDialog data={data} kind="delete" row={row} />
        </>,
      ),
    );
    const trigger = screen.getByRole("button", {
      name: "점검 메뉴",
      hidden: true,
    });
    const rectangle = DOMRect.fromRect({ x: 0, y: 0, width: 44, height: 44 });
    vi.spyOn(trigger, "getClientRects").mockReturnValue({
      0: rectangle,
      length: 1,
      item: () => rectangle,
      [Symbol.iterator]: () => [rectangle][Symbol.iterator](),
    });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(deleteMaintenance).not.toHaveBeenCalled();
  });
});

describe("dashboard maintenance end confirmation", () => {
  it("confirms once, prevents double submission and returns focus to the trigger on Escape", async () => {
    const pending = deferred<Awaited<ReturnType<typeof endMaintenance>>>();
    vi.mocked(endMaintenance).mockReturnValue(pending.promise);
    render(
      provide(
        <MaintenanceEndButton
          blockId={maintenanceBlockId}
          spaceName="회의실 C"
        />,
      ),
    );
    const trigger = screen.getByRole("button", { name: "해제 · 회의실 C" });
    await userEvent.click(trigger);
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "다음 30분 칸부터 예약할 수 있어요",
    );
    const submit = within(screen.getByRole("dialog")).getByRole("button", {
      name: "해제",
    });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() =>
      expect(endMaintenance).toHaveBeenCalledExactlyOnceWith({
        blockId: maintenanceBlockId,
      }),
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    await act(async () => {
      pending.resolve({ ok: true, data: { blockId: maintenanceBlockId } });
    });
    expect(navigation.refresh).not.toHaveBeenCalled();
  });
  it("ignores late success after navigation", async () => {
    const pending = deferred<Awaited<ReturnType<typeof endMaintenance>>>();
    vi.mocked(endMaintenance).mockReturnValue(pending.promise);
    render(
      provide(
        <MaintenanceEndButton
          blockId={maintenanceBlockId}
          spaceName="회의실 C"
        />,
      ),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "해제 · 회의실 C" }),
    );
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "해제",
      }),
    );
    window.history.replaceState({}, "", "/");
    await act(async () => {
      pending.resolve({ ok: true, data: { blockId: maintenanceBlockId } });
    });
    expect(navigation.refresh).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
  it("keeps the same confirmation after a state error, and does not close a newly reopened dialog", async () => {
    vi.mocked(endMaintenance).mockResolvedValueOnce({
      ok: false,
      code: "INVALID_INPUT",
      message: "maintenance_state",
    });
    render(
      provide(
        <MaintenanceEndButton
          blockId={maintenanceBlockId}
          spaceName="회의실 C"
        />,
      ),
    );
    const trigger = screen.getByRole("button", { name: "해제 · 회의실 C" });
    await userEvent.click(trigger);
    const first = screen.getByRole("dialog");
    await userEvent.click(within(first).getByRole("button", { name: "해제" }));
    await screen.findByText(
      "점검 상태가 바뀌었어요. 새로고침한 뒤 다시 확인해 주세요",
    );
    expect(screen.getByRole("dialog")).toBe(first);
    const pending = deferred<Awaited<ReturnType<typeof endMaintenance>>>();
    vi.mocked(endMaintenance).mockReturnValueOnce(pending.promise);
    await userEvent.click(within(first).getByRole("button", { name: "해제" }));
    await userEvent.keyboard("{Escape}");
    await userEvent.click(trigger);
    const reopened = screen.getByRole("dialog");
    await act(async () => {
      pending.resolve({ ok: true, data: { blockId: maintenanceBlockId } });
    });
    expect(screen.getByRole("dialog")).toBe(reopened);
    expect(navigation.refresh).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});

import { Activity } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EditorPublishing,
  type EditorPublishReads,
} from "@/features/floor-plan/editor/editor-publishing";
import { PlanEditorContext } from "@/features/floor-plan/editor/editor-context";
import { createPlanEditorStore } from "@/features/floor-plan/editor/store";
import type {
  PlanAutosave,
  PlanFlushResult,
  SavedPlanSnapshot,
} from "@/features/floor-plan/editor/autosave";
import { moveShapesCommand } from "@/features/floor-plan/editor/transforms";
import type { ActionResult } from "@/lib/actions/result";
import type {
  PlanPublishPreview,
  PlanVersion,
  PublishFloorPlanResult,
  RestorePlanVersionResult,
} from "@/features/floor-plan/publish-types";
import { planEditorFixture, planEditorIds } from "../helpers/plan-editor";
const mocks = vi.hoisted(() => ({ replace: vi.fn(), toast: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({ toast: { success: mocks.toast } }));
vi.mock("@/features/floor-plan/actions", () => ({
  publishFloorPlan: vi.fn(),
  restorePlanVersion: vi.fn(),
}));
const draft = {
  planId: "b8000000-0000-4000-8000-000000000001",
  version: 2,
  revision: 3,
};
const preview: PlanPublishPreview = {
  draft,
  changedShapes: 1,
  seats: { created: ["A-25"], renamed: [], archived: [] },
  issues: [],
  blockingBookings: [],
};
const published: ActionResult<PublishFloorPlanResult> = {
  ok: true,
  data: {
    planId: draft.planId,
    version: 2,
    publishedAt: "2026-10-09T04:00:00.000Z",
    seats: { created: 1, renamed: 0, archived: 0 },
  },
};
const version: PlanVersion = {
  planId: planEditorIds.plan,
  version: 1,
  status: "published",
  publishedAt: "2026-10-09T00:00:00.000Z",
  publishedByName: "김서준",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function mount() {
  const data = planEditorFixture();
  const store = createPlanEditorStore({
    floorId: data.floor.id,
    basePlanId: data.published!.planId,
    document: data.published!.document,
    draft,
    savedAt: "2026-10-09T03:00:00.000Z",
  });
  const snapshot = (): SavedPlanSnapshot => {
    const s = store.getState();
    return {
      document: s.document,
      draft: s.draft,
      epoch: s.epoch,
      changeId: s.changeId,
    };
  };
  const autosave: PlanAutosave = {
    start: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
    retry: vi.fn(),
    flush: vi.fn(async () => ({ ok: true as const, snapshot: snapshot() })),
  };
  const publish = vi
    .fn<(input: unknown) => Promise<ActionResult<PublishFloorPlanResult>>>()
    .mockResolvedValue(published);
  const restore = vi
    .fn<(input: unknown) => Promise<ActionResult<RestorePlanVersionResult>>>()
    .mockResolvedValue({
      ok: true,
      data: {
        floorId: data.floor.id,
        basePlanId: planEditorIds.plan,
        document: data.published!.document,
        draft: { ...draft, revision: 4 },
        savedAt: "2026-10-09T04:00:00.000Z",
      },
    });
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  let reads: EditorPublishReads = {},
    active = true,
    visible = true;
  const view = () => (
    <QueryClientProvider client={client}>
      <Activity mode={visible ? "visible" : "hidden"}>
        <PlanEditorContext value={store}>
          <EditorPublishing
            data={data}
            autosave={autosave}
            reads={reads}
            active={active}
            publish={publish}
            restore={restore}
          />
        </PlanEditorContext>
      </Activity>
    </QueryClientProvider>
  );
  const app = render(view());
  const rerender = () => app.rerender(view());
  const key = (name: string) =>
    new URL(
      mocks.replace.mock.lastCall![0] as string,
      "https://example.test",
    ).searchParams.get(name)!;
  return {
    ...app,
    store,
    data,
    publish,
    restore,
    autosave,
    key,
    readPreview(
      result: Promise<ActionResult<PlanPublishPreview>>,
      nonce = key("preview"),
    ) {
      reads = { preview: { key: nonce, result } };
      rerender();
    },
    readVersions(
      result: Promise<ActionResult<PlanVersion[]>>,
      nonce = key("versions"),
    ) {
      reads = { versions: { key: nonce, result } };
      rerender();
    },
    active(value: boolean) {
      active = value;
      rerender();
    },
    visible(value: boolean) {
      visible = value;
      rerender();
    },
  };
}
async function open(name = "게시") {
  fireEvent.click(screen.getByRole("button", { name }));
  await waitFor(() => expect(mocks.replace).toHaveBeenCalled());
}
async function ready(h: ReturnType<typeof mount>, data = preview) {
  await act(async () => h.readPreview(Promise.resolve({ ok: true, data })));
  await screen.findByText("새 좌석: A-25");
}
async function chooseRestore(h: ReturnType<typeof mount>) {
  await open("평면도 버전 목록");
  await act(async () =>
    h.readVersions(Promise.resolve({ ok: true, data: [version] })),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "버전 1으로 초안 만들기" }),
  );
}
beforeEach(() => vi.clearAllMocks());
describe("editor publishing", () => {
  it("shows the newly reloaded published version instead of the original chip", () => {
    const h = mount();
    const planId = "c8000000-0000-4000-8000-000000000001";
    h.data.published = { ...h.data.published!, planId, version: 9 };
    act(() =>
      h.store
        .getState()
        .replaceSource({
          floorId: h.data.floor.id,
          basePlanId: planId,
          document: h.data.published!.document,
          draft: null,
          savedAt: null,
        }),
    );
    expect(
      screen.getByRole("button", { name: "평면도 버전 목록" }),
    ).toHaveTextContent("게시됨 · 버전 9");
  });
  it("flushes before a URL-backed read and keeps one dialog while loading", async () => {
    const h = mount();
    const pending = deferred<ActionResult<PlanPublishPreview>>();
    await open();
    expect(h.autosave.flush).toHaveBeenCalledOnce();
    const dialog = screen.getByRole("dialog");
    expect(
      screen.getByRole("button", { name: "확인하고 게시" }),
    ).toBeDisabled();
    await act(async () => h.readPreview(pending.promise));
    expect(screen.getByRole("dialog")).toBe(dialog);
    await act(async () => pending.resolve({ ok: true, data: preview }));
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(screen.getByRole("button", { name: "확인하고 게시" })).toBeEnabled();
    expect(h.publish).not.toHaveBeenCalled();
  });
  it("does not publish without a saved or changed draft", () => {
    const h = mount();
    act(() => h.store.setState({ draft: null }));
    expect(screen.getByRole("button", { name: "게시" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "평면도 버전 목록" }),
    ).toBeEnabled();
  });
  it("drops closed preview responses and returns focus to the invoking button", async () => {
    const h = mount();
    const button = screen.getByRole("button", { name: "게시" });
    button.focus();
    await open();
    const pending = deferred<ActionResult<PlanPublishPreview>>();
    await act(async () => h.readPreview(pending.promise));
    fireEvent.click(screen.getAllByRole("button", { name: "닫기" })[0]!);
    await act(async () => pending.resolve({ ok: true, data: preview }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(button).toHaveFocus());
    expect(h.publish).not.toHaveBeenCalled();
  });
  it("ignores older request nonces and refuses a preview from a different draft", async () => {
    const h = mount();
    await open();
    const old = h.key("preview");
    fireEvent.click(screen.getByRole("button", { name: "다시 확인" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledTimes(2));
    await act(async () =>
      h.readPreview(Promise.resolve({ ok: true, data: preview }), old),
    );
    expect(
      screen.getByRole("button", { name: "확인하고 게시" }),
    ).toBeDisabled();
    await act(async () =>
      h.readPreview(
        Promise.resolve({
          ok: true,
          data: { ...preview, draft: { ...draft, revision: 2 } },
        }),
      ),
    );
    expect(
      screen.getByRole("button", { name: "확인하고 게시" }),
    ).toBeDisabled();
    await ready(h);
    expect(screen.getByRole("button", { name: "확인하고 게시" })).toBeEnabled();
  });
  it("invalidates the preview after an edit even if the previous response arrives last", async () => {
    const h = mount();
    await open();
    const pending = deferred<ActionResult<PlanPublishPreview>>();
    await act(async () => h.readPreview(pending.promise));
    act(() =>
      h.store
        .getState()
        .execute(
          moveShapesCommand(
            h.store.getState().document,
            ["space-a"],
            [100, 0],
            { snap: false },
          ),
        ),
    );
    await act(async () => pending.resolve({ ok: true, data: preview }));
    expect(screen.getByText(/문서가 바뀌었어요/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "확인하고 게시" }),
    ).toBeDisabled();
  });
  it("blocks publications for remaining bookings but allows advisory issues", async () => {
    const h = mount();
    await open();
    await ready(h, {
      ...preview,
      issues: [
        {
          code: "SEAT_REMOVED_WITH_BOOKINGS",
          message: "A-24 예약이 남아 있어요",
        },
      ],
      blockingBookings: [
        {
          seatName: "A-24",
          date: "2026-10-16",
          part: "pm",
          timeRange: null,
          bookerName: null,
        },
      ],
    });
    expect(
      screen.getByRole("button", { name: "확인하고 게시" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/A-24 · 2026-10-16 · 오후 · 예약 1건/),
    ).toBeVisible();
    await ready(h, {
      ...preview,
      issues: [{ code: "SPACE_NO_SEATS", message: "구역에 좌석이 없어요" }],
    });
    expect(screen.getByRole("button", { name: "확인하고 게시" })).toBeEnabled();
  });
  it("locks editing, deduplicates submission and adopts the new published base", async () => {
    const h = mount();
    const pending = deferred<ActionResult<PublishFloorPlanResult>>();
    h.publish.mockReturnValue(pending.promise);
    await open();
    await ready(h);
    const button = screen.getByRole("button", { name: "확인하고 게시" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(h.publish).toHaveBeenCalledOnce());
    expect(h.publish).toHaveBeenCalledWith({
      floorId: planEditorIds.floor,
      expectedDraftId: draft.planId,
      revision: 3,
    });
    expect(h.store.getState().writeLocked).toBe(true);
    act(() =>
      h.store
        .getState()
        .execute(
          moveShapesCommand(
            h.store.getState().document,
            ["space-a"],
            [100, 0],
            { snap: false },
          ),
        ),
    );
    expect(h.store.getState().changeId).toBe(0);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => pending.resolve(published));
    expect(h.store.getState().basePlanId).toBe(draft.planId);
    expect(h.store.getState().draft).toBeNull();
    expect(h.store.getState().writeLocked).toBe(false);
    expect(
      screen.getByRole("button", { name: "평면도 버전 목록" }),
    ).toHaveTextContent("게시됨 · 버전 2");
  });
  it("replaces optimistic preview issues with transactional publication failures", async () => {
    const h = mount();
    h.publish.mockResolvedValue({
      ok: false,
      code: "PLAN_INVALID",
      issues: [
        { code: "AREA_HAS_BOOKINGS", message: "구역에 예약이 생겼어요" },
      ],
    });
    await open();
    await ready(h);
    fireEvent.click(screen.getByRole("button", { name: "확인하고 게시" }));
    expect(await screen.findByText("구역에 예약이 생겼어요")).toBeVisible();
    expect(h.store.getState().draft).toEqual(draft);
    expect(h.store.getState().writeLocked).toBe(false);
    expect(
      screen.getByRole("button", { name: "확인하고 게시" }),
    ).toBeDisabled();
  });
  it("marks STALE without discarding unsaved input", async () => {
    const h = mount();
    h.publish.mockResolvedValue({ ok: false, code: "STALE" });
    const doc = h.store.getState().document;
    await open();
    await ready(h);
    fireEvent.click(screen.getByRole("button", { name: "확인하고 게시" }));
    await waitFor(() => expect(h.store.getState().saveState).toBe("stale"));
    expect(h.store.getState().document).toBe(doc);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it.each(["active", "visible"] as const)(
    "does not reopen delayed preview after %s hiding",
    async (kind) => {
      const h = mount();
      await open();
      const pending = deferred<ActionResult<PlanPublishPreview>>();
      await act(async () => h.readPreview(pending.promise));
      h[kind](false);
      await act(async () => pending.resolve({ ok: true, data: preview }));
      h[kind](true);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(h.publish).not.toHaveBeenCalled();
      expect(mocks.replace).toHaveBeenCalledOnce();
    },
  );
  it("lists metadata before explicit restore confirmation, then supplies fresh CAS guards", async () => {
    const h = mount();
    await open("평면도 버전 목록");
    await act(async () =>
      h.readVersions(Promise.resolve({ ok: true, data: [version] })),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "버전 1으로 초안 만들기" }),
    );
    expect(h.restore).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "확인하고 초안 만들기" }),
    );
    await waitFor(() =>
      expect(h.restore).toHaveBeenCalledWith({
        floorId: planEditorIds.floor,
        version: 1,
        expectedDraftId: draft.planId,
        revision: 3,
        basePlanId: planEditorIds.plan,
      }),
    );
    expect(h.autosave.flush).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(h.store.getState().draft?.revision).toBe(4));
    expect(h.store.getState().undoStack).toHaveLength(0);
  });
  it("does not let a late publication replace an explicitly reloaded document", async () => {
    const h = mount();
    const pending = deferred<ActionResult<PublishFloorPlanResult>>();
    h.publish.mockReturnValue(pending.promise);
    await open();
    await ready(h);
    fireEvent.click(screen.getByRole("button", { name: "확인하고 게시" }));
    await waitFor(() => expect(h.publish).toHaveBeenCalledOnce());
    act(() =>
      h.store.getState().replaceSource({
        floorId: planEditorIds.floor,
        basePlanId: planEditorIds.plan,
        document: { ...h.store.getState().document, fixtures: [] },
        draft: { ...draft, revision: 9 },
        savedAt: null,
      }),
    );
    const doc = h.store.getState().document;
    await act(async () => pending.resolve(published));
    expect(h.store.getState().document).toBe(doc);
    expect(h.store.getState().draft?.revision).toBe(9);
    expect(mocks.toast).not.toHaveBeenCalled();
  });
  it.each(["close", "visible", "active"] as const)(
    "does not navigate when opening flush finishes after %s cancellation",
    async (kind) => {
      const h = mount();
      const pending = deferred<PlanFlushResult>();
      vi.mocked(h.autosave.flush).mockReturnValue(pending.promise);
      const initial = h.store.getState();
      const snapshot: SavedPlanSnapshot = {
        document: initial.document,
        draft: initial.draft,
        epoch: initial.epoch,
        changeId: initial.changeId,
      };
      fireEvent.click(screen.getByRole("button", { name: "게시" }));
      expect(h.autosave.flush).toHaveBeenCalledOnce();
      expect(screen.getByRole("dialog")).toBeVisible();
      expect(mocks.replace).not.toHaveBeenCalled();
      if (kind === "close")
        fireEvent.click(screen.getAllByRole("button", { name: "닫기" })[0]!);
      else h[kind](false);
      await act(async () => pending.resolve({ ok: true, snapshot }));
      if (kind !== "close") h[kind](true);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(mocks.replace).not.toHaveBeenCalled();
      expect(h.publish).not.toHaveBeenCalled();
      expect(h.restore).not.toHaveBeenCalled();
      expect(h.store.getState().document).toBe(initial.document);
      expect(h.store.getState().writeLocked).toBe(false);
    },
  );
  it.each(["STALE", "INTERNAL", "rejected"] as const)(
    "preserves the edited document and undo history and unlocks after restore %s",
    async (failure) => {
      const h = mount();
      act(() =>
        h.store
          .getState()
          .execute(
            moveShapesCommand(
              h.store.getState().document,
              ["space-a"],
              [100, 0],
              { snap: false },
            ),
          ),
      );
      const before = h.store.getState();
      const pending = deferred<ActionResult<RestorePlanVersionResult>>();
      h.restore.mockReturnValue(pending.promise);
      await chooseRestore(h);
      fireEvent.click(
        screen.getByRole("button", { name: "확인하고 초안 만들기" }),
      );
      await waitFor(() => expect(h.restore).toHaveBeenCalledOnce());
      expect(h.store.getState().writeLocked).toBe(true);
      const raw = "private SQL connection details must stay hidden";
      await act(async () => {
        if (failure === "rejected") pending.reject(new Error(raw));
        else pending.resolve({ ok: false, code: failure, message: raw });
      });
      await waitFor(() => expect(h.store.getState().writeLocked).toBe(false));
      expect(h.store.getState().document).toBe(before.document);
      expect(h.store.getState().draft).toEqual(before.draft);
      expect(h.store.getState().basePlanId).toBe(before.basePlanId);
      expect(h.store.getState().undoStack).toBe(before.undoStack);
      expect(h.store.getState().changeId).toBe(before.changeId);
      expect(h.store.getState().epoch).toBe(before.epoch);
      expect(mocks.replace).toHaveBeenCalledOnce();
      expect(mocks.toast).not.toHaveBeenCalled();
      expect(document.body).not.toHaveTextContent(raw);
      if (failure === "STALE") {
        expect(h.store.getState().saveState).toBe("stale");
        expect(h.store.getState().saveError).toBe("STALE");
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      } else {
        expect(screen.getByRole("alert")).toHaveTextContent(
          failure === "rejected"
            ? "초안으로 가져오지 못했어요. 다시 시도해 주세요"
            : "정보를 확인하지 못했어요. 다시 시도해 주세요",
        );
        expect(h.store.getState().saveState).not.toBe("stale");
        expect(
          screen.getByRole("button", { name: "확인하고 초안 만들기" }),
        ).toBeEnabled();
      }
    },
  );
  it("does not overwrite a replacement source when an older restore succeeds later", async () => {
    const h = mount();
    const pending = deferred<ActionResult<RestorePlanVersionResult>>();
    h.restore.mockReturnValue(pending.promise);
    await chooseRestore(h);
    fireEvent.click(
      screen.getByRole("button", { name: "확인하고 초안 만들기" }),
    );
    await waitFor(() => expect(h.restore).toHaveBeenCalledOnce());
    act(() =>
      h.store.getState().replaceSource({
        floorId: planEditorIds.floor,
        basePlanId: draft.planId,
        document: { ...h.store.getState().document, fixtures: [] },
        draft: {
          ...draft,
          planId: "b8000000-0000-4000-8000-000000000099",
          revision: 8,
        },
        savedAt: "2026-10-09T05:00:00.000Z",
      }),
    );
    const replacement = h.store.getState();
    await act(async () =>
      pending.resolve({
        ok: true,
        data: {
          floorId: planEditorIds.floor,
          basePlanId: planEditorIds.plan,
          document: h.data.published!.document,
          draft: { ...draft, revision: 4 },
          savedAt: "2026-10-09T04:00:00.000Z",
        },
      }),
    );
    expect(h.store.getState().document).toBe(replacement.document);
    expect(h.store.getState().draft).toBe(replacement.draft);
    expect(h.store.getState().basePlanId).toBe(replacement.basePlanId);
    expect(h.store.getState().savedAt).toBe(replacement.savedAt);
    expect(h.store.getState().epoch).toBe(replacement.epoch);
    expect(h.store.getState().writeLocked).toBe(false);
    expect(mocks.replace).toHaveBeenCalledOnce();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
  it("shows a safe preview error without rendering server details or enabling publication", async () => {
    const h = mount();
    const before = h.store.getState();
    await open();
    const raw = "private server path and credentials";
    await act(async () =>
      h.readPreview(
        Promise.resolve({
          ok: false,
          code: "INTERNAL",
          message: raw,
          fieldErrors: { _root: [raw] },
          issues: [{ code: "SPACE_UNKNOWN", message: raw }],
        }),
      ),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "정보를 확인하지 못했어요. 다시 시도해 주세요",
    );
    expect(document.body).not.toHaveTextContent(raw);
    expect(
      screen.getByRole("button", { name: "확인하고 게시" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "다시 확인" })).toBeEnabled();
    expect(h.store.getState().document).toBe(before.document);
    expect(h.store.getState().draft).toBe(before.draft);
    expect(h.store.getState().writeLocked).toBe(false);
    expect(h.publish).not.toHaveBeenCalled();
  });
});

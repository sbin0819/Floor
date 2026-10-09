import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/lib/actions/result";
import type { SaveFloorPlanDraftResult } from "@/features/floor-plan/editor-types";
import { createPlanAutosave } from "@/features/floor-plan/editor/autosave";
import { moveShapesCommand } from "@/features/floor-plan/editor/transforms";
import type { PlanEditorStore } from "@/features/floor-plan/editor/store";
import { deferred, editorStore } from "../helpers/plan-editor-store";

type Result = ActionResult<SaveFloorPlanDraftResult>;
const success = (revision = 1): Result => ({
  ok: true,
  data: {
    planId: "30000000-0000-4000-8000-000000000001",
    version: 2,
    revision,
    savedAt: "2026-10-09T03:00:00.000Z",
  },
});
function edit(store: PlanEditorStore, x = 100) {
  store.getState().execute(
    moveShapesCommand(store.getState().document, ["a"], [x, 0], {
      snap: false,
    }),
  );
}

describe("plan autosave", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("debounces 1500ms after the last committed edit, not selection or preview", async () => {
    const store = editorStore(),
      save = vi.fn().mockResolvedValue(success());
    const controller = createPlanAutosave(store, { save });
    controller.start();
    store.getState().select(["a"]);
    moveShapesCommand(store.getState().document, ["a"], [500, 0], {
      snap: false,
    })!.apply(store.getState().document);
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).not.toHaveBeenCalled();
    edit(store);
    await vi.advanceTimersByTimeAsync(1000);
    edit(store);
    await vi.advanceTimersByTimeAsync(1499);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0]).toMatchObject({
      revision: null,
      document: store.getState().document,
    });
    expect(store.getState()).toMatchObject({
      changeId: 2,
      ackChangeId: 2,
      saveState: "saved",
      draft: { revision: 1 },
    });
    controller.dispose();
  });
  it("serializes requests and sends the latest edit once using the acknowledged revision", async () => {
    const first = deferred<Result>(),
      second = deferred<Result>();
    const save = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const store = editorStore(),
      controller = createPlanAutosave(store, { save });
    controller.start();
    edit(store);
    await vi.advanceTimersByTimeAsync(1500);
    const firstDoc = save.mock.calls[0]![0].document;
    edit(store);
    edit(store);
    edit(store);
    await vi.advanceTimersByTimeAsync(3000);
    expect(save).toHaveBeenCalledTimes(1);
    const latest = store.getState().document;
    first.resolve(success());
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![0]).toMatchObject({
      document: latest,
      revision: 1,
    });
    expect(store.getState().document).toBe(latest);
    expect(firstDoc).not.toBe(latest);
    expect(store.getState().ackChangeId).toBe(1);
    expect(store.getState().undoStack).toHaveLength(4);
    second.resolve(success(2));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().ackChangeId).toBe(4);
    expect(vi.getTimerCount()).toBe(0);
    controller.dispose();
  });
  it("accepts a first-save ACK while hidden and postpones the next request until resume", async () => {
    const first = deferred<Result>();
    const save = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(success(2));
    const store = editorStore(),
      controller = createPlanAutosave(store, { save });
    controller.start();
    edit(store);
    await vi.advanceTimersByTimeAsync(1500);
    edit(store);
    const document = store.getState().document;
    controller.stop();
    first.resolve(success());
    await vi.advanceTimersByTimeAsync(10000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({
      draft: { revision: 1 },
      ackChangeId: 1,
      changeId: 2,
    });
    expect(store.getState().document).toBe(document);
    controller.start();
    await vi.advanceTimersByTimeAsync(1500);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![0].revision).toBe(1);
    controller.dispose();
  });
  it("shares flush, drains edits made in flight, and returns an exact saved immutable snapshot", async () => {
    const first = deferred<Result>(),
      second = deferred<Result>();
    const store = editorStore(),
      save = vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
    const controller = createPlanAutosave(store, { save });
    controller.start();
    edit(store);
    const flush = controller.flush();
    expect(controller.flush()).toBe(flush);
    await vi.advanceTimersByTimeAsync(0);
    edit(store);
    first.resolve(success());
    await vi.advanceTimersByTimeAsync(0);
    let resolved = false;
    void flush.then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(false);
    second.resolve(success(2));
    const result = await flush;
    expect(result).toEqual({
      ok: true,
      snapshot: {
        document: store.getState().document,
        draft: store.getState().draft,
        epoch: 0,
        changeId: 2,
      },
    });
    if (result.ok) {
      edit(store);
      expect(result.snapshot.changeId).not.toBe(store.getState().changeId);
      expect(result.snapshot.document).not.toBe(store.getState().document);
    }
    controller.dispose();
  });
  it("returns a clean published source without creating a draft", async () => {
    const store = editorStore(),
      save = vi.fn();
    store.setState({ basePlanId: "published-id" });
    const controller = createPlanAutosave(store, { save });
    controller.start();
    expect(await controller.flush()).toMatchObject({
      ok: true,
      snapshot: { draft: null, changeId: 0 },
    });
    expect(save).not.toHaveBeenCalled();
    controller.dispose();
  });
  it("creates one clean draft through the existing queue without a fake edit or undo entry", async () => {
    const store = editorStore();
    store.setState({ basePlanId: "published-id" });
    store.getState().select(["a"]);
    const before = store.getState();
    const first = deferred<Result>();
    const save = vi.fn().mockReturnValueOnce(first.promise);
    const controller = createPlanAutosave(store, { save });
    controller.start();
    const flush = controller.flush({ createDraft: true });
    expect(controller.flush({ createDraft: true })).toBe(flush);
    expect(controller.flush()).toBe(flush);
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledExactlyOnceWith({
      floorId: before.floorId,
      basePlanId: "published-id",
      revision: null,
      document: before.document,
    });
    expect(store.getState()).toMatchObject({
      changeId: 0,
      ackChangeId: 0,
      undoStack: [],
      redoStack: [],
      selectedIds: ["a"],
    });
    first.resolve(success());
    expect(await flush).toEqual({
      ok: true,
      snapshot: {
        document: before.document,
        draft: {
          planId: "30000000-0000-4000-8000-000000000001",
          version: 2,
          revision: 1,
        },
        epoch: 0,
        changeId: 0,
      },
    });
    expect(store.getState().document).toBe(before.document);
    await controller.flush({ createDraft: true });
    await vi.advanceTimersByTimeAsync(10000);
    expect(save).toHaveBeenCalledTimes(1);
    controller.dispose();
  });
  it("does not write an existing clean draft for createDraft or change its revision", async () => {
    const store = editorStore();
    store.setState({ draft: { planId: "existing", version: 3, revision: 8 } });
    const save = vi.fn();
    const controller = createPlanAutosave(store, { save });
    controller.start();
    expect(await controller.flush({ createDraft: true })).toMatchObject({
      ok: true,
      snapshot: { draft: { planId: "existing", revision: 8 } },
    });
    expect(save).not.toHaveBeenCalled();
    controller.dispose();
  });
  it("shares a running dirty first save and drains later edits using its revision", async () => {
    const store = editorStore();
    const first = deferred<Result>(),
      second = deferred<Result>();
    const save = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const controller = createPlanAutosave(store, { save });
    controller.start();
    edit(store);
    await vi.advanceTimersByTimeAsync(1500);
    const flush = controller.flush({ createDraft: true });
    edit(store);
    first.resolve(success());
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![0].revision).toBe(1);
    second.resolve(success(2));
    expect(await flush).toMatchObject({
      ok: true,
      snapshot: { draft: { revision: 2 }, changeId: 2 },
    });
    expect(store.getState().undoStack).toHaveLength(2);
    controller.dispose();
  });
  it("drains edits made during clean creation instead of resolving a stale document snapshot", async () => {
    const store = editorStore();
    const first = deferred<Result>(),
      second = deferred<Result>();
    const save = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const controller = createPlanAutosave(store, { save });
    controller.start();
    const flush = controller.flush({ createDraft: true });
    await vi.advanceTimersByTimeAsync(0);
    edit(store);
    const changed = store.getState().document;
    first.resolve(success());
    await vi.advanceTimersByTimeAsync(0);
    expect(save.mock.calls[1]![0]).toMatchObject({
      revision: 1,
      document: changed,
    });
    second.resolve(success(2));
    expect(await flush).toMatchObject({
      ok: true,
      snapshot: { document: changed, changeId: 1, draft: { revision: 2 } },
    });
    controller.dispose();
  });
  it.each([false, true])(
    "permits explicit createDraft while writeLocked with dirty=%s without unlocking edits",
    async (dirty) => {
      const store = editorStore();
      if (dirty) edit(store);
      store.getState().setWriteLocked(true);
      const save = vi.fn().mockResolvedValue(success());
      const controller = createPlanAutosave(store, { save });
      controller.start();
      expect(await controller.flush({ createDraft: true })).toMatchObject({
        ok: true,
        snapshot: { draft: { revision: 1 }, changeId: dirty ? 1 : 0 },
      });
      expect(save).toHaveBeenCalledTimes(1);
      expect(store.getState().writeLocked).toBe(true);
      edit(store);
      expect(store.getState().changeId).toBe(dirty ? 1 : 0);
      controller.dispose();
    },
  );
  it("retries a failed clean creation only explicitly and never invents a changeId", async () => {
    const store = editorStore();
    const save = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, code: "INTERNAL" })
      .mockResolvedValueOnce(success());
    const controller = createPlanAutosave(store, { save });
    controller.start();
    expect(await controller.flush({ createDraft: true })).toEqual({
      ok: false,
      reason: "error",
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(await controller.flush({ createDraft: true })).toEqual({
      ok: false,
      reason: "error",
    });
    controller.retry();
    expect(await controller.flush({ createDraft: true })).toMatchObject({
      ok: true,
      snapshot: { draft: { revision: 1 }, changeId: 0 },
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(store.getState().undoStack).toEqual([]);
    controller.dispose();
  });
  it("never retries stale clean creation until the source is replaced", async () => {
    const store = editorStore();
    const save = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, code: "STALE" })
      .mockResolvedValueOnce(success());
    const controller = createPlanAutosave(store, { save });
    controller.start();
    expect(await controller.flush({ createDraft: true })).toEqual({
      ok: false,
      reason: "stale",
    });
    controller.retry();
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(1);
    store.getState().replaceSource(editorStore().getState());
    expect(await controller.flush()).toMatchObject({
      ok: true,
      snapshot: { draft: null },
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(await controller.flush({ createDraft: true })).toMatchObject({
      ok: true,
      snapshot: { draft: { revision: 1 } },
    });
    controller.dispose();
  });
  it("cancels clean creation waiters while hidden but accepts its ACK before resuming", async () => {
    const store = editorStore();
    const first = deferred<Result>();
    const save = vi.fn().mockReturnValueOnce(first.promise);
    const controller = createPlanAutosave(store, { save });
    controller.start();
    const flush = controller.flush({ createDraft: true });
    await vi.advanceTimersByTimeAsync(0);
    controller.stop();
    expect(await flush).toEqual({ ok: false, reason: "cancelled" });
    expect(await controller.flush({ createDraft: true })).toEqual({
      ok: false,
      reason: "cancelled",
    });
    first.resolve(success());
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState()).toMatchObject({
      draft: { revision: 1 },
      changeId: 0,
      ackChangeId: 0,
    });
    controller.start();
    await controller.flush({ createDraft: true });
    expect(save).toHaveBeenCalledTimes(1);
    controller.dispose();
  });
  it("ignores the old clean-creation ACK and queues only one request for a new epoch", async () => {
    const store = editorStore();
    const first = deferred<Result>();
    const save = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(success(5));
    const controller = createPlanAutosave(store, { save });
    controller.start();
    const oldFlush = controller.flush({ createDraft: true });
    await vi.advanceTimersByTimeAsync(0);
    store.getState().replaceSource(editorStore().getState());
    expect(await oldFlush).toEqual({ ok: false, reason: "cancelled" });
    const newFlush = controller.flush({ createDraft: true });
    expect(controller.flush({ createDraft: true })).toBe(newFlush);
    first.resolve(success(99));
    expect(await newFlush).toMatchObject({
      ok: true,
      snapshot: { epoch: 1, changeId: 0, draft: { revision: 5 } },
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![0].revision).toBeNull();
    controller.dispose();
  });
  it("shares a still-running creation after Activity resumes before its ACK", async () => {
    const store = editorStore();
    const first = deferred<Result>();
    const save = vi.fn().mockReturnValueOnce(first.promise);
    const controller = createPlanAutosave(store, { save });
    controller.start();
    const oldFlush = controller.flush({ createDraft: true });
    await vi.advanceTimersByTimeAsync(0);
    controller.stop();
    expect(await oldFlush).toEqual({ ok: false, reason: "cancelled" });
    controller.start();
    const resumed = controller.flush({ createDraft: true });
    expect(controller.flush()).toBe(resumed);
    first.resolve(success());
    expect(await resumed).toMatchObject({
      ok: true,
      snapshot: { draft: { revision: 1 }, changeId: 0 },
    });
    expect(save).toHaveBeenCalledTimes(1);
    controller.dispose();
  });
  it("disposal cancels clean creation and discards its late ACK", async () => {
    const store = editorStore();
    const first = deferred<Result>();
    const controller = createPlanAutosave(store, { save: () => first.promise });
    controller.start();
    const flush = controller.flush({ createDraft: true });
    await vi.advanceTimersByTimeAsync(0);
    controller.dispose();
    expect(await flush).toEqual({ ok: false, reason: "cancelled" });
    first.resolve(success());
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState()).toMatchObject({
      draft: null,
      changeId: 0,
      ackChangeId: 0,
    });
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["FORBIDDEN", "INTERNAL", "INVALID_INPUT"] as const)(
    "pauses on %s without looping and allows explicit retry",
    async (code) => {
      const save = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, code })
        .mockResolvedValueOnce(success());
      const store = editorStore(),
        controller = createPlanAutosave(store, { save });
      controller.start();
      edit(store);
      expect(await controller.flush()).toEqual({ ok: false, reason: "error" });
      expect(store.getState()).toMatchObject({
        saveError: code,
        ackChangeId: 0,
      });
      await vi.advanceTimersByTimeAsync(60000);
      expect(save).toHaveBeenCalledTimes(1);
      controller.retry();
      await vi.advanceTimersByTimeAsync(0);
      expect(save).toHaveBeenCalledTimes(2);
      expect(store.getState().saveState).toBe("saved");
      controller.dispose();
    },
  );
  it("converts thrown saves to a recoverable error and a later edit may debounce retry", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(success());
    const store = editorStore(),
      controller = createPlanAutosave(store, { save });
    controller.start();
    edit(store);
    await controller.flush();
    expect(store.getState().saveError).toBe("INTERNAL");
    edit(store);
    await vi.advanceTimersByTimeAsync(1500);
    expect(save).toHaveBeenCalledTimes(2);
    controller.dispose();
  });
  it("never retries STALE, even after edits, until explicit source replacement", async () => {
    const save = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, code: "STALE" })
      .mockResolvedValue(success());
    const store = editorStore(),
      controller = createPlanAutosave(store, { save });
    controller.start();
    edit(store);
    expect(await controller.flush()).toEqual({ ok: false, reason: "stale" });
    edit(store);
    controller.retry();
    controller.stop();
    controller.start();
    await vi.advanceTimersByTimeAsync(60000);
    expect(save).toHaveBeenCalledTimes(1);
    store.getState().replaceSource(editorStore().getState());
    edit(store);
    await vi.advanceTimersByTimeAsync(1500);
    expect(save).toHaveBeenCalledTimes(2);
    controller.dispose();
  });
  it("cancels old flush on source replacement and ignores the old ACK", async () => {
    const first = deferred<Result>();
    const save = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(success(5));
    const store = editorStore(),
      controller = createPlanAutosave(store, { save });
    controller.start();
    edit(store);
    const flush = controller.flush();
    await vi.advanceTimersByTimeAsync(0);
    store.getState().replaceSource(editorStore().getState());
    expect(await flush).toEqual({ ok: false, reason: "cancelled" });
    edit(store);
    const newerFlush = controller.flush();
    first.resolve(success(99));
    const result = await newerFlush;
    expect(result).toMatchObject({
      ok: true,
      snapshot: { epoch: 1, draft: { revision: 5 } },
    });
    expect(save.mock.calls[1]![0].revision).toBeNull();
    controller.dispose();
  });
  it("stopping cancels waiters and timers, but resuming retains draft and history", async () => {
    const first = deferred<Result>();
    const save = vi.fn().mockReturnValue(first.promise);
    const store = editorStore(),
      controller = createPlanAutosave(store, { save });
    controller.start();
    edit(store);
    const flush = controller.flush();
    await vi.advanceTimersByTimeAsync(0);
    controller.stop();
    expect(await flush).toEqual({ ok: false, reason: "cancelled" });
    expect(vi.getTimerCount()).toBe(0);
    first.resolve(success());
    await vi.advanceTimersByTimeAsync(0);
    controller.start();
    expect(store.getState().undoStack).toHaveLength(1);
    expect(store.getState().draft?.revision).toBe(1);
    expect(await controller.flush()).toMatchObject({ ok: true });
    controller.dispose();
  });
  it("dispose ignores a late ACK and never leaves flush pending", async () => {
    const first = deferred<Result>();
    const store = editorStore(),
      controller = createPlanAutosave(store, { save: () => first.promise });
    controller.start();
    edit(store);
    const flush = controller.flush();
    await vi.advanceTimersByTimeAsync(0);
    controller.dispose();
    expect(await flush).toEqual({ ok: false, reason: "cancelled" });
    first.resolve(success());
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().draft).toBeNull();
    controller.start();
    expect(await controller.flush()).toEqual({
      ok: false,
      reason: "cancelled",
    });
  });
  it("saves undo after a successful save and leaves validation issues independent", async () => {
    const save = vi
      .fn()
      .mockResolvedValueOnce(success())
      .mockResolvedValueOnce(success(2));
    const store = editorStore(),
      controller = createPlanAutosave(store, { save });
    const initial = store.getState().document;
    controller.start();
    edit(store);
    store.setState({ issues: [{ code: "SPACE_OVERLAP", message: "겹침" }] });
    await controller.flush();
    store.getState().undo();
    await controller.flush();
    expect(save.mock.calls[1]![0].document).toEqual(initial);
    expect(store.getState().issues).toHaveLength(1);
    expect(store.getState().redoStack).toHaveLength(1);
    controller.dispose();
  });
});

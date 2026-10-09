import type { ActionResult } from "@/lib/actions/result";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";
import type { SaveFloorPlanDraftInput } from "../editor-schema";
import type { SaveFloorPlanDraftResult } from "../editor-types";
import type { PlanDraft, PlanEditorStore } from "./store";

export type EditorTimers = {
  setTimeout(
    callback: () => void,
    delay: number,
  ): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
};
export const editorTimers: EditorTimers = {
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (timer) => clearTimeout(timer),
};
export type SavedPlanSnapshot = {
  document: FloorPlanDocument;
  draft: PlanDraft | null;
  epoch: number;
  changeId: number;
};
export type PlanFlushResult =
  | { ok: true; snapshot: SavedPlanSnapshot }
  | { ok: false; reason: "error" | "stale" | "cancelled" };
export type PlanAutosave = ReturnType<typeof createPlanAutosave>;

export function createPlanAutosave(
  store: PlanEditorStore,
  options: {
    save(
      input: SaveFloorPlanDraftInput,
    ): Promise<ActionResult<SaveFloorPlanDraftResult>>;
    timers?: EditorTimers;
  },
) {
  const timers = options.timers ?? editorTimers;
  let active = false;
  let disposed = false;
  let unsubscribe: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let pendingFlush: {
    epoch: number;
    promise: Promise<PlanFlushResult>;
    resolve(result: PlanFlushResult): void;
  } | null = null;

  function clearTimer() {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  }
  function finishFlush(result: PlanFlushResult) {
    const pending = pendingFlush;
    pendingFlush = null;
    pending?.resolve(result);
  }
  function cleanResult(): PlanFlushResult {
    const { document, draft, epoch, changeId } = store.getState();
    return { ok: true, snapshot: { document, draft, epoch, changeId } };
  }
  function schedule() {
    clearTimer();
    if (!active || disposed) return;
    const state = store.getState();
    if (
      state.changeId === state.ackChangeId ||
      state.saveState === "stale" ||
      state.saveState === "error"
    )
      return;
    timer = timers.setTimeout(() => {
      timer = null;
      run();
    }, 1500);
  }
  function run() {
    if (!active || disposed || inFlight) return;
    const sent = store.getState();
    if (sent.saveState === "stale" || sent.saveState === "error") {
      finishFlush({ ok: false, reason: sent.saveState });
      return;
    }
    if (sent.changeId === sent.ackChangeId) {
      finishFlush(cleanResult());
      return;
    }
    clearTimer();
    inFlight = true;
    store.setState({ saveState: "saving", saveError: null });
    // ACK는 보낸 변경 번호만 승인해요. 대기 중 편집한 문서·선택·이력은 건드리지 않아요.
    void Promise.resolve()
      .then(() =>
        options.save({
          floorId: sent.floorId,
          basePlanId: sent.basePlanId,
          revision: sent.draft?.revision ?? null,
          document: sent.document,
        }),
      )
      .catch((): ActionResult<SaveFloorPlanDraftResult> => ({
        ok: false,
        code: "INTERNAL",
      }))
      .then((result) => {
        inFlight = false;
        if (disposed) return;
        const current = store.getState();
        if (current.epoch !== sent.epoch) {
          if (pendingFlush && pendingFlush.epoch !== current.epoch)
            finishFlush({ ok: false, reason: "cancelled" });
          run();
          return;
        }
        if (!result.ok) {
          const saveState = result.code === "STALE" ? "stale" : "error";
          store.setState({ saveState, saveError: result.code });
          finishFlush({ ok: false, reason: saveState });
          return;
        }
        const { planId, version, revision, savedAt } = result.data;
        // Activity가 숨겨져도 첫 초안의 revision은 받아야 복귀 뒤 null로 다시 보내지 않아요.
        store.setState({
          draft: { planId, version, revision },
          savedAt,
          ackChangeId: sent.changeId,
          saveState: "saved",
          saveError: null,
        });
        const latest = store.getState();
        if (latest.changeId === latest.ackChangeId) finishFlush(cleanResult());
        else if (active) run();
      });
  }
  function start() {
    if (active || disposed) return;
    active = true;
    unsubscribe = store.subscribe((state, previous) => {
      if (state.epoch !== previous.epoch) {
        finishFlush({ ok: false, reason: "cancelled" });
        schedule();
      } else if (state.changeId !== previous.changeId) {
        if (state.saveState === "error")
          store.setState({ saveState: "idle", saveError: null });
        if (pendingFlush) run();
        else schedule();
      }
    });
    schedule();
  }
  function stop() {
    active = false;
    clearTimer();
    unsubscribe?.();
    unsubscribe = null;
    finishFlush({ ok: false, reason: "cancelled" });
  }
  function flush(): Promise<PlanFlushResult> {
    if (disposed || !active)
      return Promise.resolve({ ok: false, reason: "cancelled" });
    if (pendingFlush) return pendingFlush.promise;
    const state = store.getState();
    if (state.saveState === "stale" || state.saveState === "error")
      return Promise.resolve({ ok: false, reason: state.saveState });
    if (state.changeId === state.ackChangeId)
      return Promise.resolve(cleanResult());
    let resolve!: (result: PlanFlushResult) => void;
    const promise = new Promise<PlanFlushResult>((done) => {
      resolve = done;
    });
    pendingFlush = { epoch: state.epoch, promise, resolve };
    run();
    return promise;
  }
  function retry() {
    if (disposed || store.getState().saveState === "stale") return;
    store.setState({ saveState: "idle", saveError: null });
    clearTimer();
    run();
  }
  return {
    start,
    stop,
    flush,
    retry,
    dispose() {
      stop();
      disposed = true;
    },
  };
}

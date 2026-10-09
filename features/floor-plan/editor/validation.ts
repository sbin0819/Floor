import type { PlanIssue } from "@/lib/floor-plan/issues";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";
import { validatePlan, type PlanContext } from "@/lib/floor-plan/validate";
import { editorTimers, type EditorTimers } from "./autosave";
import type { PlanEditorStore } from "./store";

export function createPlanValidation(
  store: PlanEditorStore,
  initialContext: PlanContext,
  options: {
    validate?(
      document: FloorPlanDocument,
      context: PlanContext,
    ): readonly PlanIssue[] | Promise<readonly PlanIssue[]>;
    timers?: EditorTimers;
  } = {},
) {
  const timers = options.timers ?? editorTimers;
  const validate = options.validate ?? validatePlan;
  let context = initialContext;
  let generation = 0;
  let active = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe: (() => void) | null = null;
  function clear() {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  }
  function schedule() {
    clear();
    const request = ++generation;
    if (!active || disposed) return;
    const { epoch, changeId, document } = store.getState();
    const capturedContext = context;
    store.setState({ validationPending: true });
    timer = timers.setTimeout(() => {
      timer = null;
      void Promise.resolve()
        .then(() => validate(document, capturedContext))
        .then((issues) => {
          const current = store.getState();
          if (
            !active ||
            disposed ||
            request !== generation ||
            epoch !== current.epoch ||
            changeId !== current.changeId
          )
            return;
          store.setState({ issues, validationPending: false });
        })
        .catch(() => {
          if (active && !disposed && request === generation)
            store.setState({ validationPending: false });
        });
    }, 200);
  }
  function start() {
    if (active || disposed) return;
    active = true;
    unsubscribe = store.subscribe((state, previous) => {
      if (
        state.epoch !== previous.epoch ||
        state.changeId !== previous.changeId
      )
        schedule();
    });
    schedule();
  }
  function stop() {
    active = false;
    generation++;
    clear();
    unsubscribe?.();
    unsubscribe = null;
  }
  return {
    start,
    stop,
    setContext(next: PlanContext) {
      if (context !== next) {
        context = next;
        schedule();
      }
    },
    dispose() {
      stop();
      disposed = true;
    },
  };
}

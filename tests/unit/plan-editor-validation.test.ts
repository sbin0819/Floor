import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlanValidation } from "@/features/floor-plan/editor/validation";
import { moveShapesCommand } from "@/features/floor-plan/editor/transforms";
import type { PlanIssue } from "@/lib/floor-plan/issues";
import type { PlanContext } from "@/lib/floor-plan/validate";
import {
  deferred,
  editorFloorId,
  editorSpaceId,
  editorStore,
} from "../helpers/plan-editor-store";

const context: PlanContext = {
  floorId: editorFloorId,
  floorAccess: "everyone",
  floorAllowedTeamIds: [],
  spaces: [
    {
      id: editorSpaceId,
      floorId: editorFloorId,
      parentId: null,
      type: "meeting_room",
      name: "회의실",
      bookable: true,
      archived: false,
      access: null,
      allowedTeamIds: [],
    },
  ],
};
const issue: PlanIssue = {
  code: "LABEL_OUTSIDE",
  shapeId: "a",
  message: "라벨을 옮겨 주세요.",
};

describe("editor validation scheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("validates the initial document and debounces committed changes for 200ms", async () => {
    const store = editorStore(),
      validate = vi.fn().mockReturnValue([issue]);
    const controller = createPlanValidation(store, context, { validate });
    controller.start();
    await vi.advanceTimersByTimeAsync(199);
    expect(validate).not.toHaveBeenCalled();
    store.getState().execute(
      moveShapesCommand(store.getState().document, ["a"], [100, 0], {
        snap: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(199);
    expect(validate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(validate).toHaveBeenCalledExactlyOnceWith(
      store.getState().document,
      context,
    );
    expect(store.getState()).toMatchObject({
      validationPending: false,
      issues: [issue],
    });
    store.getState().select(["a"]);
    store.getState().setCamera({ x: 0, y: 0, scale: 2 });
    await vi.advanceTimersByTimeAsync(500);
    expect(validate).toHaveBeenCalledTimes(1);
    controller.dispose();
  });
  it("does not let older document or context results overwrite newer issues", async () => {
    const first = deferred<PlanIssue[]>(),
      second = deferred<PlanIssue[]>(),
      third = deferred<PlanIssue[]>();
    const validate = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);
    const store = editorStore(),
      controller = createPlanValidation(store, context, { validate });
    controller.start();
    await vi.advanceTimersByTimeAsync(200);
    store.getState().execute(
      moveShapesCommand(store.getState().document, ["a"], [100, 0], {
        snap: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(200);
    controller.setContext({ ...context, spaces: [] });
    await vi.advanceTimersByTimeAsync(200);
    third.resolve([issue]);
    await vi.advanceTimersByTimeAsync(0);
    second.resolve([]);
    first.resolve([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().issues).toEqual([issue]);
    expect(store.getState().document.spaces).toHaveLength(1);
    expect(store.getState().undoStack).toHaveLength(1);
    controller.dispose();
  });
  it("ignores a prior epoch and Activity-hidden work and revalidates on resume", async () => {
    const first = deferred<PlanIssue[]>(),
      second = deferred<PlanIssue[]>();
    const validate = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValue([]);
    const store = editorStore(),
      controller = createPlanValidation(store, context, { validate });
    controller.start();
    await vi.advanceTimersByTimeAsync(200);
    store.getState().replaceSource(editorStore().getState());
    first.resolve([issue]);
    await vi.advanceTimersByTimeAsync(200);
    controller.stop();
    second.resolve([issue]);
    await vi.advanceTimersByTimeAsync(10000);
    expect(store.getState().issues).toEqual([]);
    expect(validate).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    controller.start();
    await vi.advanceTimersByTimeAsync(200);
    expect(store.getState().validationPending).toBe(false);
    expect(validate).toHaveBeenCalledTimes(3);
    controller.dispose();
  });
  it("uses the real validator without changing document/history", async () => {
    const store = editorStore(),
      controller = createPlanValidation(store, { ...context, spaces: [] });
    const document = store.getState().document;
    controller.start();
    await vi.advanceTimersByTimeAsync(200);
    expect(store.getState().issues).toContainEqual(
      expect.objectContaining({ code: "SPACE_UNKNOWN" }),
    );
    expect(store.getState().document).toBe(document);
    expect(store.getState().changeId).toBe(0);
    expect(store.getState().undoStack).toEqual([]);
    controller.dispose();
  });
  it("cleans timers on disposal and ignores later context changes", async () => {
    const store = editorStore(),
      validate = vi.fn();
    const controller = createPlanValidation(store, context, { validate });
    controller.start();
    controller.dispose();
    controller.setContext({ ...context });
    controller.start();
    await vi.advanceTimersByTimeAsync(10000);
    expect(validate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

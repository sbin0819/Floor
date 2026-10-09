import { describe, expect, it } from "vitest";
import {
  moveBackgroundCommand,
  rotateBackgroundCommand,
  scaleBackgroundCommand,
  setBackgroundCommand,
  setBackgroundOpacityCommand,
  type PlanBackground,
} from "@/features/floor-plan/editor/background-commands";
import type { Point } from "@/lib/floor-plan/render/types";
import { editorDocument, editorStore } from "../helpers/plan-editor-store";

const background = (): PlanBackground => ({
  transform: [10, 0, 0, 10, 1000, 2000],
  opacity: 0.35,
});
function document() {
  return { ...editorDocument(), background: background() };
}
function mapped(value: PlanBackground, point: Point): Point {
  const [a, b, c, d, e, f] = value.transform;
  return [a * point[0] + c * point[1] + e, b * point[0] + d * point[1] + f];
}

describe("background commands", () => {
  it("sets upload defaults without retaining the caller's mutable transform", () => {
    const before = editorDocument();
    const uploaded: PlanBackground = {
      transform: [10, 0, 0, 10, 0, 0],
      opacity: 0.35,
    };
    const command = setBackgroundCommand(before, uploaded)!;
    uploaded.transform[0] = 20;
    const next = command.apply(before);
    expect(next.background).toEqual({
      transform: [10, 0, 0, 10, 0, 0],
      opacity: 0.35,
    });
    expect(next.spaces).toBe(before.spaces);
    expect(next.seats).toBe(before.seats);
    expect(command.apply(next)).toBe(next);
    const restored = command.revert(next);
    expect(restored).toEqual(before);
    expect(Object.hasOwn(restored, "background")).toBe(false);
  });

  it("removes only the background property and restores its original reference", () => {
    const before = document();
    const command = setBackgroundCommand(before, null)!;
    const next = command.apply(before);
    expect(Object.hasOwn(next, "background")).toBe(false);
    expect(Object.keys(next)).toEqual(Object.keys(editorDocument()));
    expect(next.walls).toBe(before.walls);
    expect(command.revert(next).background).toBe(before.background);
    expect(setBackgroundCommand(next, null)).toBeNull();
    expect(setBackgroundCommand(before, background())).toBeNull();
  });

  it("moves in world coordinates, including negative offsets, with one reversible command", () => {
    const before = document();
    const command = moveBackgroundCommand(before, [-1250, 123.5])!;
    const next = command.apply(before);
    expect(next.background).toEqual({
      transform: [10, 0, 0, 10, -250, 2123.5],
      opacity: 0.35,
    });
    expect(command.revert(next).background).toBe(before.background);
    expect(moveBackgroundCommand(before, [0, 0])).toBeNull();
  });

  it("rotates about the supplied world pivot and returns exactly after four quarter turns", () => {
    const before = document();
    const pivot: Point = [2000, 3000];
    const first = rotateBackgroundCommand(before, pivot)!.apply(before);
    expect(first.background?.transform).toEqual([0, 10, -10, 0, 3000, 2000]);
    expect(mapped(first.background!, [100, 100])).toEqual(pivot);
    expect(mapped(first.background!, [200, 100])).toEqual([2000, 4000]);
    let next = first;
    for (let i = 0; i < 3; i++)
      next = rotateBackgroundCommand(next, pivot)!.apply(next);
    expect(next.background).toEqual(before.background);
    expect(rotateBackgroundCommand(before, pivot, 360)).toBeNull();
    expect(
      rotateBackgroundCommand(first, pivot, -90)!.apply(first).background,
    ).toEqual(before.background);
  });

  it("keeps the first measured point and existing rotation while calibrating distance", () => {
    const before = document();
    before.background.transform = [0, 10, -10, 0, 1000, 2000];
    const firstPixel: Point = [10, 20];
    const secondPixel: Point = [13, 24];
    const first = mapped(before.background, firstPixel);
    const second = mapped(before.background, secondPixel);
    const command = scaleBackgroundCommand(before, first, second, 125)!;
    const next = command.apply(before);
    expect(next.background?.transform.slice(0, 4)).toEqual([0, 25, -25, 0]);
    expect(next.background?.opacity).toBe(before.background.opacity);
    expect(mapped(next.background!, firstPixel)).toEqual(first);
    const scaledSecond = mapped(next.background!, secondPixel);
    expect(
      Math.hypot(scaledSecond[0] - first[0], scaledSecond[1] - first[1]),
    ).toBe(125);
    expect(command.revert(next).background).toBe(before.background);
    expect(scaleBackgroundCommand(before, first, second, 50)).toBeNull();
  });

  it("validates opacity and supports fully transparent and opaque values", () => {
    const before = document();
    for (const opacity of [0, 1]) {
      const command = setBackgroundOpacityCommand(before, opacity)!;
      const next = command.apply(before);
      expect(next.background?.opacity).toBe(opacity);
      expect(next.background?.transform).toBe(before.background.transform);
      expect(command.revert(next).background).toBe(before.background);
    }
    for (const opacity of [-0.01, 1.01, NaN, Infinity])
      expect(setBackgroundOpacityCommand(before, opacity)).toBeNull();
    expect(setBackgroundOpacityCommand(before, 0.35)).toBeNull();
  });

  it("rejects missing backgrounds, invalid measurements and nonfinite transforms", () => {
    const empty = editorDocument();
    expect(moveBackgroundCommand(empty, [1, 1])).toBeNull();
    expect(rotateBackgroundCommand(empty, [1, 1])).toBeNull();
    expect(scaleBackgroundCommand(empty, [0, 0], [1, 1], 10)).toBeNull();
    expect(setBackgroundOpacityCommand(empty, 0.5)).toBeNull();
    const before = document();
    expect(moveBackgroundCommand(before, [NaN, 0])).toBeNull();
    expect(rotateBackgroundCommand(before, [Infinity, 0])).toBeNull();
    for (const angle of [NaN, Infinity, 45, 90.5])
      expect(rotateBackgroundCommand(before, [0, 0], angle)).toBeNull();
    for (const distance of [0, -1, NaN, Infinity])
      expect(
        scaleBackgroundCommand(before, [0, 0], [1, 1], distance),
      ).toBeNull();
    expect(scaleBackgroundCommand(before, [1, 1], [1, 1], 100)).toBeNull();
    expect(scaleBackgroundCommand(before, [NaN, 1], [2, 1], 100)).toBeNull();
    expect(
      scaleBackgroundCommand(before, [0, 0], [Number.MIN_VALUE, 0], 100),
    ).toBeNull();
    expect(
      setBackgroundCommand(before, {
        ...background(),
        transform: [NaN, 0, 0, 10, 0, 0],
      }),
    ).toBeNull();
  });

  it("uses the same undo/redo and write locks as shape commands", () => {
    const before = document();
    const store = editorStore(before);
    expect(store.getState().execute(setBackgroundCommand(before, null))).toBe(
      true,
    );
    expect(store.getState().undoStack).toHaveLength(1);
    expect(store.getState().undo()).toBe(true);
    expect(store.getState().document.background).toBe(before.background);
    expect(store.getState().redo()).toBe(true);
    expect(store.getState().document.background).toBeUndefined();
    store.getState().setWriteLocked(true);
    expect(store.getState().undo()).toBe(false);
    expect(
      store
        .getState()
        .execute(setBackgroundCommand(store.getState().document, background())),
    ).toBe(false);
    store.getState().setWriteLocked(false);
    store.setState({ saveState: "stale" });
    expect(store.getState().undo()).toBe(false);
  });
});

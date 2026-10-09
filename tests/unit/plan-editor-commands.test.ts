import { describe, expect, it } from "vitest";
import {
  addShapeCommand,
  deleteShapesCommand,
  groupCommands,
  replaceShapesCommand,
} from "@/features/floor-plan/editor/commands";
import {
  alignShapesCommand,
  connectSpaceCommand,
  createFixtureCommand,
  createSpaceCommand,
  duplicateFixturesCommand,
  moveShapesCommand,
  resizeShapeCommand,
  setBoundsCommand,
  setRectangleCommand,
  setSpaceLabelCommand,
  snapPoint,
} from "@/features/floor-plan/editor/transforms";
import { pointInPolygonStrict } from "@/lib/floor-plan/geometry";
import {
  editorDocument,
  editorRectangle,
  editorSpaceId,
  editorStore,
} from "../helpers/plan-editor-store";

describe("editor commands and transforms", () => {
  it("round trips mixed multi-delete in original order without cloning unrelated shapes", () => {
    const doc = editorDocument();
    const command = deleteShapesCommand(doc, ["a", "b", "d"])!;
    const next = command.apply(doc);
    expect(next.spaces).toEqual([]);
    expect(next.fixtures).toEqual([doc.fixtures[1]]);
    expect(next.fixtures[0]).toBe(doc.fixtures[1]);
    const restored = command.revert(next);
    expect(restored).toEqual(doc);
    expect(restored.spaces[0]).toBe(doc.spaces[0]);
    expect(restored.walls).toBe(doc.walls);
    expect(command.apply(restored)).toEqual(next);
  });
  it("does not delete walls and treats empty edits as no-ops", () => {
    const doc = editorDocument();
    expect(deleteShapesCommand(doc, ["wall", "missing"])).toBeNull();
    expect(
      replaceShapesCommand(
        doc,
        [{ collection: "spaces", shape: { ...doc.spaces[0]! } }],
        "same",
      ),
    ).toBeNull();
    expect(moveShapesCommand(doc, ["a"], [0, 0], { snap: false })).toBeNull();
    expect(groupCommands("none", [])).toBeNull();
  });
  it("rejects duplicate global ids, duplicate space bindings and invalid shapes", () => {
    const doc = editorDocument();
    expect(
      addShapeCommand(doc, {
        collection: "fixtures",
        shape: { id: "wall", kind: "core", polygon: editorRectangle() },
      }),
    ).toBeNull();
    expect(
      createSpaceCommand(doc, {
        id: "new",
        spaceId: editorSpaceId.toUpperCase(),
        polygon: editorRectangle(),
      }),
    ).toBeNull();
    expect(
      createFixtureCommand(doc, {
        id: "new",
        kind: "core",
        polygon: [
          [-1, 0],
          [1, 0],
          [0, 1],
        ],
      }),
    ).toBeNull();
    expect(
      createSpaceCommand(doc, {
        id: "new",
        spaceId: editorSpaceId,
        polygon: [],
      }),
    ).toBeNull();
  });
  it("allows tiny, overlapping and self-intersecting geometry for later validation", () => {
    const doc = editorDocument();
    expect(
      createFixtureCommand(doc, {
        id: "tiny",
        kind: "core",
        polygon: [
          [1, 1],
          [2, 1],
          [1, 2],
        ],
      }),
    ).not.toBeNull();
    expect(
      createFixtureCommand(doc, {
        id: "cross",
        kind: "core",
        polygon: [
          [1000, 1000],
          [3000, 3000],
          [1000, 3000],
          [3000, 1000],
        ],
      }),
    ).not.toBeNull();
    expect(
      createFixtureCommand(doc, {
        id: "overlap",
        kind: "core",
        polygon: editorRectangle(),
      }),
    ).not.toBeNull();
  });
  it("snaps one group anchor and preserves every relative vertex and label offset", () => {
    const doc = editorDocument();
    doc.spaces[0]!.polygon = editorRectangle(1025, 1050);
    const command = moveShapesCommand(doc, ["a", "b"], [130, 80], {
      snap: true,
    })!;
    const next = command.apply(doc);
    expect(next.spaces[0]!.polygon[0]).toEqual([1200, 1100]);
    expect(next.spaces[0]!.label.at).toEqual([1675, 1550]);
    expect(next.fixtures[0]!.polygon[0]).toEqual([5175, 5050]);
    expect(next.fixtures[1]).toBe(doc.fixtures[1]);
    expect(command.revert(next)).toEqual(doc);
    expect(snapPoint([155.1, 249.1], false)).toEqual([155, 249]);
  });
  it("uses exact keyboard deltas and rejects moves outside the floor", () => {
    const doc = editorDocument();
    expect(
      moveShapesCommand(doc, ["a"], [100, 1000], { snap: false })!.apply(doc)
        .spaces[0]!.polygon[0],
    ).toEqual([1100, 2000]);
    expect(
      moveShapesCommand(doc, ["a"], [-1001, 0], { snap: false }),
    ).toBeNull();
  });
  it("resizes with integer points and recenters a concave label inside", () => {
    const doc = editorDocument();
    doc.spaces[0]!.polygon = [
      [1000, 1000],
      [4000, 1000],
      [4000, 2000],
      [2000, 2000],
      [2000, 4000],
      [1000, 4000],
    ];
    const next = resizeShapeCommand(
      doc,
      "a",
      { x: 3000, y: 3000, width: 3333, height: 5555 },
      { snap: false },
    )!.apply(doc);
    expect(next.spaces[0]!.polygon.flat().every(Number.isInteger)).toBe(true);
    expect(
      pointInPolygonStrict(next.spaces[0]!.label.at, next.spaces[0]!.polygon),
    ).toBe(true);
    expect(
      setRectangleCommand(doc, "a", { x: 0, y: 0, width: 100, height: 100 }),
    ).toBeNull();
  });
  it("moves numeric rectangles without changing label placement and centers labels when resized", () => {
    const doc = editorDocument();
    const moved = setRectangleCommand(doc, "a", {
      x: 2000,
      y: 2500,
      width: 2000,
      height: 2000,
    })!.apply(doc);
    expect(moved.spaces[0]!.label.at).toEqual([2500, 3000]);
    const resized = setRectangleCommand(doc, "a", {
      x: 1000,
      y: 1000,
      width: 4000,
      height: 4000,
    })!.apply(doc);
    expect(resized.spaces[0]!.label.at).toEqual([3000, 3000]);
    expect(
      setRectangleCommand(doc, "a", { x: 1.1, y: 1, width: 1, height: 1 }),
    ).toBeNull();
  });
  it("uses 100mm top-left inset with strict-inside fallback", () => {
    const doc = editorDocument();
    expect(
      setSpaceLabelCommand(doc, "a", "top-left")!.apply(doc).spaces[0]!.label
        .at,
    ).toEqual([1100, 1100]);
    doc.spaces[0]!.polygon = [
      [1000, 2000],
      [2000, 1000],
      [3000, 2000],
      [2000, 3000],
    ];
    const next = setSpaceLabelCommand(doc, "a", "top-left")!.apply(doc);
    expect(
      pointInPolygonStrict(next.spaces[0]!.label.at, next.spaces[0]!.polygon),
    ).toBe(true);
  });
  it("duplicates only fixtures using supplied ids and one undoable command", () => {
    const doc = editorDocument();
    const ids = new Map([
      ["b", "b2"],
      ["d", "d2"],
    ]);
    const command = duplicateFixturesCommand(doc, ["b", "d"], ids)!;
    const next = command.apply(doc);
    expect(next.fixtures.map(({ id }) => id)).toEqual([
      "b",
      "c",
      "d",
      "b2",
      "d2",
    ]);
    expect(next.fixtures[3]!.polygon[0]).toEqual([5100, 5100]);
    expect(command.revert(next)).toEqual(doc);
    expect(duplicateFixturesCommand(doc, ["a", "b"], ids)).toBeNull();
    expect(duplicateFixturesCommand(doc, ["b"], new Map())).toBeNull();
    expect(
      duplicateFixturesCommand(doc, ["b", "d"], ids, [50000, 0]),
    ).toBeNull();
  });
  it.each(["left", "center-x", "right", "top", "center-y", "bottom"] as const)(
    "round trips %s alignment with one history item",
    (alignment) => {
      const doc = editorDocument();
      const command = alignShapesCommand(doc, ["a", "b"], alignment)!;
      expect(command.revert(command.apply(doc))).toEqual(doc);
      expect(command.apply(doc).fixtures[1]).toBe(doc.fixtures[1]);
    },
  );
  it("connects a replacement space without mutating geometry", () => {
    const doc = editorDocument();
    const next = connectSpaceCommand(
      doc,
      "a",
      "20000000-0000-4000-8000-000000000002",
    )!.apply(doc);
    expect(next.spaces[0]!.polygon).toBe(doc.spaces[0]!.polygon);
    expect(connectSpaceCommand(doc, "b", editorSpaceId)).toBeNull();
  });
  it("rejects shrinking past walls, labels or seats, and preserves unsupported collections", () => {
    const doc = editorDocument();
    expect(setBoundsCommand(doc, { w: 20000, h: 20000 })).toBeNull();
    expect(setBoundsCommand(doc, { w: 100001, h: 20000 })).toBeNull();
    const command = setBoundsCommand(doc, { w: 40000, h: 30000 })!;
    const next = command.apply(doc);
    expect(next.walls).toBe(doc.walls);
    expect(command.revert(next)).toEqual(doc);
    doc.walls = [];
    doc.spaces[0]!.label.at = [29000, 1000];
    expect(setBoundsCommand(doc, { w: 28000, h: 20000 })).toBeNull();
    doc.spaces = [];
    doc.seats = [
      {
        id: "seat",
        spaceId: editorSpaceId,
        at: [29000, 1000],
        size: [100, 100],
        rotation: 0,
      },
    ];
    expect(setBoundsCommand(doc, { w: 28000, h: 20000 })).toBeNull();
  });
});

describe("per-screen editor store", () => {
  it("limits undo to 100, clears redo on new edit, and preserves saved undo history", () => {
    const store = editorStore();
    for (let index = 0; index < 101; index++) {
      const state = store.getState();
      state.execute(
        moveShapesCommand(state.document, ["a"], [1, 0], { snap: false }),
      );
    }
    expect(store.getState().undoStack).toHaveLength(100);
    store.setState({ ackChangeId: 101, saveState: "saved" });
    expect(store.getState().undo()).toBe(true);
    expect(store.getState().changeId).toBe(102);
    expect(store.getState().ackChangeId).toBe(101);
    expect(store.getState().redo()).toBe(true);
    store.getState().undo();
    const state = store.getState();
    state.execute(
      moveShapesCommand(state.document, ["a"], [0, 100], { snap: false }),
    );
    expect(store.getState().redo()).toBe(false);
  });
  it("notifies only meaningful selection/camera/tool changes and isolates each screen", () => {
    const store = editorStore(),
      other = editorStore();
    let notifications = 0;
    store.subscribe(() => notifications++);
    store.getState().select(["a", "a", "wall"]);
    store.getState().select(["a"]);
    store.getState().setTool("select");
    store.getState().setSnap(true);
    store.getState().setCamera({ x: 1, y: 2, scale: 1 });
    store.getState().setCamera({ x: 1, y: 2, scale: 1 });
    expect(notifications).toBe(2);
    expect(other.getState().selectedIds).toEqual([]);
    expect(store.getState().execute(null)).toBe(false);
    expect(store.getState().changeId).toBe(0);
    store
      .getState()
      .execute(deleteShapesCommand(store.getState().document, ["a"]));
    expect(store.getState().selectedIds).toEqual([]);
  });
  it("replaces only explicitly and invalidates epoch/history on replacement", () => {
    const store = editorStore();
    store
      .getState()
      .execute(deleteShapesCommand(store.getState().document, ["a"]));
    const source = editorStore().getState();
    store.getState().replaceSource(source);
    expect(store.getState()).toMatchObject({
      epoch: 1,
      changeId: 0,
      ackChangeId: 0,
      selectedIds: [],
      undoStack: [],
      redoStack: [],
    });
    expect(store.getState().document).toBe(source.document);
  });
});

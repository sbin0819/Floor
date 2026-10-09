import { describe, expect, it } from "vitest";
import {
  deleteVertexCommand,
  insertVertexCommand,
  setVertexCommand,
} from "@/features/floor-plan/editor/vertex-commands";
import { pointInPolygonStrict } from "@/lib/floor-plan/geometry";
import { editorDocument, editorStore } from "../helpers/plan-editor-store";

describe("vertex editing commands", () => {
  it("moves a polygon vertex with an interior label and one reversible command", () => {
    const document = editorDocument();
    document.spaces[0]!.label.at = [1100, 1100];
    expect(setVertexCommand(document, "a", 0, [1000, 1000])).toBeNull();
    const command = setVertexCommand(document, "a", 1, [4000, 1000])!;
    const next = command.apply(document);
    const shape = next.spaces[0]!;
    expect(shape.polygon[1]).toEqual([4000, 1000]);
    expect(pointInPolygonStrict(shape.label.at, shape.polygon)).toBe(true);
    expect(shape.label.at).not.toEqual(document.spaces[0]!.label.at);
    expect(next.fixtures).toBe(document.fixtures);
    expect(command.revert(next)).toEqual(document);
  });
  it("adds two vertices to make a concave room and keeps the recentered label inside", () => {
    const document = editorDocument();
    const first = insertVertexCommand(document, "a", 1, [2000, 2000])!.apply(
      document,
    );
    const second = insertVertexCommand(first, "a", 2, [2000, 3000])!.apply(
      first,
    );
    expect(second.spaces[0]!.polygon).toHaveLength(6);
    expect(
      pointInPolygonStrict(
        second.spaces[0]!.label.at,
        second.spaces[0]!.polygon,
      ),
    ).toBe(true);
  });
  it("supports fixtures and rejects missing/seat/outside/noninteger indices and points", () => {
    const document = editorDocument();
    const command = setVertexCommand(document, "b", 0, [4900, 5100])!;
    expect(command.apply(document).fixtures[0]!.polygon[0]).toEqual([
      4900, 5100,
    ]);
    expect(command.revert(command.apply(document))).toEqual(document);
    expect(setVertexCommand(document, "missing", 0, [1, 1])).toBeNull();
    expect(setVertexCommand(document, "a", 1.5, [1, 1])).toBeNull();
    expect(setVertexCommand(document, "a", 0, [1.5, 1])).toBeNull();
    expect(setVertexCommand(document, "a", 0, [-1, 1])).toBeNull();
    expect(insertVertexCommand(document, "a", -1, [1, 1])).toBeNull();
    expect(deleteVertexCommand(document, "a", 9)).toBeNull();
  });
  it("enforces polygon three / wall two minima and the 64-point maximum", () => {
    const document = editorDocument();
    const triangle = deleteVertexCommand(document, "a", 0)!.apply(document);
    expect(deleteVertexCommand(triangle, "a", 0)).toBeNull();
    expect(deleteVertexCommand(document, "wall", 0)).toBeNull();
    document.walls[0]!.points = Array.from({ length: 64 }, (_, i) => [
      i * 100,
      100,
    ]);
    expect(insertVertexCommand(document, "wall", 1, [101, 101])).toBeNull();
    const short = deleteVertexCommand(document, "wall", 10)!.apply(document);
    expect(short.walls[0]!.points).toHaveLength(63);
    expect(insertVertexCommand(short, "wall", 63, [101, 101])).toBeNull();
  });
  it("preserves whole-wall at on moves and inserts even when another edge changes length", () => {
    const document = editorDocument();
    document.walls[0]!.points = [
      [1000, 1000],
      [5000, 1000],
      [5000, 5000],
    ];
    document.openings = [
      { id: "door", wallId: "wall", at: 0.75, width: 900, kind: "door" },
    ];
    const moved = setVertexCommand(document, "wall", 0, [0, 1000])!.apply(
      document,
    );
    expect(moved.openings).toBe(document.openings);
    expect(moved.openings[0]!.at).toBe(0.75);
    const inserted = insertVertexCommand(
      document,
      "wall",
      0,
      [3000, 1000],
    )!.apply(document);
    expect(inserted.openings).toBe(document.openings);
    expect(inserted.walls[0]!.points).toHaveLength(4);
  });
  it("deletes doors on both vanished edges but restores every row in original order", () => {
    const document = editorDocument();
    document.walls[0]!.points = [
      [1000, 1000],
      [5000, 1000],
      [5000, 5000],
      [9000, 5000],
    ];
    document.openings = [0.2, 0.5, 0.875].map((at, index) => ({
      id: `door-${index}`,
      wallId: "wall",
      at,
      width: 900,
      kind: "door",
    }));
    const store = editorStore(document);
    const command = deleteVertexCommand(document, "wall", 1)!;
    store.getState().execute(command);
    expect(store.getState().document.openings).toEqual([document.openings[2]]);
    expect(store.getState().document.openings[0]).toBe(document.openings[2]);
    expect(store.getState().undoStack).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().document).toEqual(document);
    store.getState().redo();
    expect(store.getState().document.openings).toEqual([document.openings[2]]);
  });
  it("handles the closing edge when deleting the first vertex", () => {
    const document = editorDocument();
    document.walls[0] = {
      ...document.walls[0]!,
      points: [
        [1000, 1000],
        [5000, 1000],
        [5000, 5000],
        [1000, 5000],
      ],
      closed: true,
    };
    document.openings = [0.125, 0.375, 0.625, 0.875].map((at, index) => ({
      id: `door-${index}`,
      wallId: "wall",
      at,
      width: 900,
      kind: "door",
    }));
    const command = deleteVertexCommand(document, "wall", 0)!;
    expect(command.apply(document).openings.map(({ id }) => id)).toEqual([
      "door-1",
      "door-2",
    ]);
    expect(command.revert(command.apply(document))).toEqual(document);
  });
});

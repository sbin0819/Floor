import { describe, expect, it } from "vitest";
import {
  createWallCommand,
  setWallCommand,
  createOpeningCommand,
  setOpeningCommand,
  moveOpeningCommand,
} from "@/features/floor-plan/editor/wall-commands";
import {
  deleteShapesCommand,
  patchShapesCommand,
} from "@/features/floor-plan/editor/commands";
import { moveShapesCommand } from "@/features/floor-plan/editor/transforms";
import { resolveOpening } from "@/lib/floor-plan/openings";
import { editorDocument, editorStore } from "../helpers/plan-editor-store";

function document() {
  const value = editorDocument();
  value.walls = [
    {
      id: "wall",
      points: [
        [1000, 1000],
        [11000, 1000],
        [11000, 6000],
      ],
      thickness: 100,
      closed: false,
    },
  ];
  value.openings = [
    { id: "door", wallId: "wall", at: 0.8, width: 900, kind: "door" },
  ];
  return value;
}
describe("wall and opening commands", () => {
  it.each([false, true])(
    "creates an open/closed wall reversibly (%s) without cloning seats",
    (closed) => {
      const before = document();
      const command = createWallCommand(before, {
        id: "new-wall",
        points: [
          [1000, 8000],
          [5000, 8000],
          [5000, 9000],
        ],
        closed,
      })!;
      const next = command.apply(before);
      expect(next.walls.at(-1)).toMatchObject({ closed, thickness: 100 });
      expect(next.seats).toBe(before.seats);
      expect(command.revert(next)).toEqual(before);
    },
  );
  it("enforces creation/property limits while allowing later opening validation", () => {
    const before = document();
    for (const thickness of [49, 501, 100.5])
      expect(setWallCommand(before, "wall", { thickness })).toBeNull();
    for (const thickness of [50, 500])
      expect(
        setWallCommand(before, "wall", { thickness })?.apply(before).walls[0]
          ?.thickness,
      ).toBe(thickness);
    expect(
      createWallCommand(before, { id: "new", points: [[0, 0]], closed: false }),
    ).toBeNull();
    expect(
      setWallCommand(before, "wall", { thickness: 100, closed: false }),
    ).toBeNull();
    for (const width of [299, 3001, 400.5])
      expect(setOpeningCommand(before, "door", { width })).toBeNull();
    expect(
      setOpeningCommand(before, "door", {
        width: 3000,
        kind: "opening",
      })!.apply(before).openings[0],
    ).toMatchObject({ width: 3000, kind: "opening" });
    const created = createOpeningCommand(before, {
      id: "second",
      wallId: "wall",
      point: [3000, 1050],
    })!;
    const next = created.apply(before);
    expect(next.openings.at(-1)).toMatchObject({
      id: "second",
      width: 900,
      kind: "door",
    });
    expect(
      resolveOpening(before.walls[0]!, next.openings.at(-1)!)?.contained,
    ).toBe(true);
    expect(created.revert(next)).toEqual(before);
  });
  it("moves a wall with an unchanged at and does not move a selected child twice", () => {
    const before = document();
    const command = moveShapesCommand(before, ["wall", "door"], [100, 200], {
      snap: false,
    })!;
    const next = command.apply(before);
    expect(next.openings).toBe(before.openings);
    expect(next.openings[0]!.at).toBe(0.8);
    expect(resolveOpening(next.walls[0]!, next.openings[0]!)!.center).toEqual([
      11100, 3200,
    ]);
    expect(command.revert(next)).toEqual(before);
    const movedDoor = moveOpeningCommand(
      before,
      "door",
      [1000, 1000],
      1,
    )!.apply(before);
    expect(
      resolveOpening(before.walls[0]!, movedDoor.openings[0]!)!.segmentIndex,
    ).toBe(1);
    const keyboard = moveShapesCommand(before, ["door"], [0, 100], {
      snap: false,
    })!.apply(before);
    expect(
      resolveOpening(before.walls[0]!, keyboard.openings[0]!)!.center[1],
    ).toBeCloseTo(3100.5);
  });
  it("deletes a wall and all its doors atomically and restores original indices/references", () => {
    const before = document();
    before.walls.push({ ...before.walls[0]!, id: "other" });
    before.openings.push({
      ...before.openings[0]!,
      id: "other-door",
      wallId: "other",
    });
    const store = editorStore(before);
    store.getState().select(["wall", "door"]);
    expect(store.getState().selectedIds).toEqual(["wall", "door"]);
    const command = deleteShapesCommand(before, ["wall"])!;
    store.getState().execute(command);
    expect(store.getState().document.walls).toEqual([before.walls[1]]);
    expect(store.getState().document.openings).toEqual([before.openings[1]]);
    expect(store.getState().selectedIds).toEqual([]);
    store.getState().undo();
    expect(store.getState().document).toEqual(before);
    expect(store.getState().document.openings[0]).toBe(before.openings[0]);
    store.getState().redo();
    expect(store.getState().undoStack).toHaveLength(1);
  });
  it("patches removed and replaced shapes in one index-correct command", () => {
    const before = document();
    const command = patchShapesCommand(
      before,
      {
        removeIds: ["b"],
        replace: [
          {
            collection: "fixtures",
            shape: { ...before.fixtures[2]!, label: "새 이름" },
          },
        ],
        add: [
          {
            collection: "fixtures",
            shape: { ...before.fixtures[1]!, id: "added" },
          },
        ],
      },
      "patch",
    )!;
    const next = command.apply(before);
    expect(next.fixtures.map(({ id }) => id)).toEqual(["c", "d", "added"]);
    expect(command.revert(next)).toEqual(before);
    expect(next.fixtures[0]).toBe(before.fixtures[1]);
  });
});

import type { FloorPlanDocument, PlanPoint } from "@/lib/floor-plan/types";
import { createPlanEditorStore } from "@/features/floor-plan/editor/store";

export const editorFloorId = "10000000-0000-4000-8000-000000000001";
export const editorSpaceId = "20000000-0000-4000-8000-000000000001";
export function editorRectangle(
  x = 1000,
  y = 1000,
  w = 2000,
  h = 2000,
): PlanPoint[] {
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}
export function editorDocument(): FloorPlanDocument {
  return {
    schema: 1,
    unit: "mm",
    bounds: { w: 30000, h: 20000 },
    walls: [
      {
        id: "wall",
        points: [
          [0, 0],
          [30000, 0],
        ],
        thickness: 100,
        closed: false,
      },
    ],
    openings: [],
    seats: [],
    spaces: [
      {
        id: "a",
        spaceId: editorSpaceId,
        polygon: editorRectangle(),
        label: { at: [1500, 1500] },
      },
    ],
    fixtures: [
      { id: "b", kind: "core", polygon: editorRectangle(5000, 5000) },
      { id: "c", kind: "stairs", polygon: editorRectangle(9000, 9000) },
      { id: "d", kind: "storage", polygon: editorRectangle(15000, 15000) },
    ],
  };
}
export function editorStore(document = editorDocument()) {
  return createPlanEditorStore({
    floorId: editorFloorId,
    basePlanId: null,
    document,
    draft: null,
    savedAt: null,
  });
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

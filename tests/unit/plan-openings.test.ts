import { describe, expect, it } from "vitest";
import {
  projectOpening,
  resolveOpening,
  wallSegments,
  type PlanWall,
} from "@/lib/floor-plan/openings";
import { createScene } from "@/lib/floor-plan/render/scene";
import { createSpatialIndex } from "@/lib/floor-plan/render/spatial-index";
import { hitEditorShape, hitTest } from "@/lib/floor-plan/render/hit-test";
import { validatePlan } from "@/lib/floor-plan/validate";
import { editorDocument } from "../helpers/plan-editor-store";

const wall = (closed = false): PlanWall => ({
  id: "wall",
  points: [
    [1000, 1000],
    [11000, 1000],
    [11000, 6000],
  ],
  closed,
  thickness: 100,
});
describe("whole-polyline openings", () => {
  it("resolves unequal segments and the closed last edge with source indices", () => {
    expect(resolveOpening(wall(), { at: 0.8, width: 900 })).toMatchObject({
      segmentIndex: 1,
      center: [11000, 3000],
      contained: true,
      totalLength: 15000,
    });
    const closed: PlanWall = {
      ...wall(true),
      points: [
        [0, 0],
        [1000, 0],
        [1000, 1000],
        [0, 1000],
      ],
    };
    expect(resolveOpening(closed, { at: 0.875, width: 300 })).toMatchObject({
      segmentIndex: 3,
      center: [0, 500],
      hinge: [0, 650],
      end: [0, 350],
      radius: 300,
      contained: true,
    });
    expect(
      wallSegments({
        ...wall(),
        points: [
          [0, 0],
          [0, 0],
          [1000, 0],
        ],
      }).map(({ index, offset }) => [index, offset]),
    ).toEqual([[1, 0]]);
  });
  it("projects onto the fixed segment and clamps both ends to four decimals", () => {
    const value = projectOpening(wall(), [1000, 1000], 900, 1)!;
    expect(value.segmentIndex).toBe(1);
    expect(value.at * 10000).toBeCloseTo(Math.round(value.at * 10000));
    expect(value.center[0]).toBe(11000);
    expect(value.center[1]).toBeGreaterThanOrEqual(1450);
    expect(
      resolveOpening(wall(), { at: value.at, width: 900 })?.contained,
    ).toBe(true);
    const end = projectOpening(wall(), [11000, 9000], 900, 1)!;
    expect(end.center[1]).toBeLessThanOrEqual(5550);
    expect(projectOpening(wall(), [2000, 1000], 900)?.segmentIndex).toBe(0);
    expect(projectOpening(wall(), [2000, 1000], 6000, 1)).toBeNull();
  });
  it("rejects a short edge with no valid four-decimal at without rounding across its end", () => {
    const value: PlanWall = {
      ...wall(),
      points: [
        [0, 0],
        [99999, 0],
        [99999, 300],
      ],
    };
    expect(projectOpening(value, [99999, 150], 300, 1)).toBeNull();
    expect(projectOpening(value, [99999, 150], 300, 0)).not.toBeNull();
  });
  it("distinguishes invalid corner/seam/oversized openings while preserving safe rendering", () => {
    const document = editorDocument();
    document.spaces = [];
    document.fixtures = [];
    document.walls = [
      {
        ...wall(true),
        points: [
          [1000, 1000],
          [5000, 1000],
          [5000, 5000],
          [1000, 5000],
        ],
      },
    ];
    document.openings = [
      { id: "valid", wallId: "wall", at: 0.125, width: 900, kind: "door" },
      { id: "corner", wallId: "wall", at: 0.25, width: 900, kind: "door" },
      { id: "seam", wallId: "wall", at: 0, width: 900, kind: "opening" },
      { id: "too-wide", wallId: "wall", at: 0.625, width: 5000, kind: "door" },
    ];
    const issues = validatePlan(document, {
      floorId: "floor",
      floorAccess: "everyone",
      floorAllowedTeamIds: [],
      spaces: [],
    });
    expect(issues.map(({ code, shapeId }) => [code, shapeId])).toEqual([
      ["OPENING_OFF_WALL", "corner"],
      ["OPENING_OFF_WALL", "seam"],
      ["OPENING_OFF_WALL", "too-wide"],
    ]);
    expect(
      createScene(document).shapes.every(({ bounds }) =>
        Object.values(bounds).every(Number.isFinite),
      ),
    ).toBe(true);
    expect(
      resolveOpening(
        {
          ...wall(),
          points: [
            [0, 0],
            [0, 0],
          ],
        },
        { at: 0, width: 900 },
      ),
    ).toBeNull();
    expect(projectOpening(wall(), [NaN, 0], 900)).toBeNull();
    expect(resolveOpening(wall(), { at: NaN, width: 900 })).toBeNull();
  });
  it("opts in editor wall/door hits without changing member hit testing", () => {
    const document = editorDocument();
    document.spaces = [];
    document.fixtures = [];
    document.walls = [wall()];
    document.openings = [
      { id: "door", wallId: "wall", at: 0.2, width: 900, kind: "door" },
    ];
    const index = createSpatialIndex(createScene(document).shapes);
    const camera = { x: 0, y: 0, scale: 1 };
    expect(hitEditorShape(index, camera, [2000, 1054])?.id).toBe("wall");
    expect(hitEditorShape(index, camera, [2000, 1055])).toBeNull();
    expect(hitEditorShape(index, camera, [4000, 1000])?.id).toBe("door");
    expect(hitTest(index, camera, [4000, 1000])).toBeNull();
    expect(
      hitEditorShape(index, { ...camera, scale: 0.1 }, [200, 109])?.id,
    ).toBe("wall");
    expect(
      hitEditorShape(index, { ...camera, scale: 0.1 }, [200, 110]),
    ).toBeNull();
  });
});

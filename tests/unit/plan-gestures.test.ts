import { describe, expect, it } from "vitest";
import { toWorld } from "@/lib/floor-plan/render/camera";
import { isPlanTap, pinchCamera } from "@/lib/floor-plan/render/gestures";

describe("floor plan pointer geometry", () => {
  const camera = { x: 20, y: -30, scale: 0.1 };
  it("keeps the world point under the moving pinch midpoint", () => {
    const before = [
      [10, 40],
      [110, 40],
    ] as const;
    const after = [
      [30, 80],
      [230, 80],
    ] as const;
    const result = pinchCamera(camera, before, after, 0.1);
    expect(result.scale).toBeCloseTo(0.2);
    expect(toWorld([130, 80], result)).toEqual(toWorld([60, 40], camera));
  });
  it("pans two equally spaced touches without zooming", () => {
    expect(
      pinchCamera(
        camera,
        [
          [0, 0],
          [20, 0],
        ],
        [
          [10, 20],
          [30, 20],
        ],
        0.1,
      ),
    ).toEqual({ ...camera, x: 30, y: -10 });
  });
  it("keeps scale finite for coinciding touches and clamps extreme zoom", () => {
    expect(
      pinchCamera(
        camera,
        [
          [0, 0],
          [0, 0],
        ],
        [
          [1, 1],
          [1, 1],
        ],
        0.1,
      ),
    ).toEqual({ ...camera, x: 21, y: -29 });
    expect(
      pinchCamera(
        camera,
        [
          [0, 0],
          [1, 0],
        ],
        [
          [0, 0],
          [1000, 0],
        ],
        0.1,
      ).scale,
    ).toBe(0.8);
  });
  it("allows a tap through eight pixels but never treats a drag as one", () => {
    expect(isPlanTap([10, 10], [18, 10])).toBe(true);
    expect(isPlanTap([10, 10], [18.01, 10])).toBe(false);
    expect(isPlanTap([0, 0], [6, 6])).toBe(false);
  });
});

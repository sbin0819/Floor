import { describe, expect, it } from "vitest";
import { floorPlanSchema, MAX_FLOOR_PLAN_BYTES } from "@/lib/floor-plan/schema";
import type { FloorPlanDocument, PlanPoint } from "@/lib/floor-plan/types";

const uuid = (index: number) =>
  `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
const polygon: PlanPoint[] = [
  [0, 0],
  [1000, 0],
  [0, 1000],
];
function document(): FloorPlanDocument {
  return {
    schema: 1,
    unit: "mm",
    bounds: { w: 100_000, h: 100_000 },
    walls: [],
    openings: [],
    spaces: [],
    seats: [],
    fixtures: [],
  };
}

describe("floor plan schema size limits", () => {
  it.each(["w", "h"] as const)("limits bounds.%s inclusively", (dimension) => {
    const doc = document();
    expect(floorPlanSchema.safeParse(doc).success).toBe(true);
    doc.bounds[dimension]++;
    expect(floorPlanSchema.safeParse(doc).success).toBe(false);
  });
  it.each(["spaces", "walls", "fixtures"] as const)(
    "limits %s polygons to 64 vertices",
    (kind) => {
      const doc = document();
      const points: PlanPoint[] = Array.from({ length: 64 }, (_, i) => [i, i]);
      if (kind === "walls")
        doc.walls.push({ id: "shape", points, thickness: 10, closed: false });
      if (kind === "spaces")
        doc.spaces.push({
          id: "shape",
          polygon: points,
          spaceId: uuid(1),
          label: { at: [1, 1] },
        });
      if (kind === "fixtures")
        doc.fixtures.push({ id: "shape", polygon: points, kind: "core" });
      expect(floorPlanSchema.safeParse(doc).success).toBe(true);
      points.push([65, 65]);
      expect(floorPlanSchema.safeParse(doc).success).toBe(false);
    },
  );
  it.each([
    ["walls", 300],
    ["openings", 300],
    ["spaces", 300],
    ["seats", 2000],
    ["fixtures", 100],
  ] as const)("limits %s to %s shapes", (kind, limit) => {
    const doc = document();
    doc.walls.push({
      id: "reference-wall",
      points: [
        [0, 0],
        [100, 0],
      ],
      thickness: 10,
      closed: false,
    });
    const populate = (length: number) => {
      if (kind === "walls")
        doc.walls = Array.from({ length }, (_, i) => ({
          id: `w${i}`,
          points: polygon,
          thickness: 10,
          closed: false,
        }));
      if (kind === "openings")
        doc.openings = Array.from({ length }, (_, i) => ({
          id: `o${i}`,
          wallId: "reference-wall",
          at: 0.5,
          width: 10,
          kind: "door",
        }));
      if (kind === "spaces")
        doc.spaces = Array.from({ length }, (_, i) => ({
          id: `s${i}`,
          spaceId: uuid(i),
          polygon,
          label: { at: [1, 1] },
        }));
      if (kind === "seats")
        doc.seats = Array.from({ length }, (_, i) => ({
          id: `k${i}`,
          spaceId: uuid(i),
          at: [1, 1],
          size: [1, 1],
          rotation: 0,
        }));
      if (kind === "fixtures")
        doc.fixtures = Array.from({ length }, (_, i) => ({
          id: `f${i}`,
          kind: "core",
          polygon,
        }));
    };
    populate(limit);
    expect(floorPlanSchema.safeParse(doc).success).toBe(true);
    populate(limit + 1);
    const parsed = floorPlanSchema.safeParse(doc);
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(parsed.error.issues).toContainEqual(
        expect.objectContaining({ path: [kind], code: "too_big" }),
      );
  });
  it("enforces UTF-8 bytes rather than string length, with an inclusive 900KB boundary", () => {
    const doc = document();
    doc.fixtures.push({ id: "f", kind: "core", polygon, label: "" });
    const base = new TextEncoder().encode(JSON.stringify(doc)).byteLength;
    const remaining = MAX_FLOOR_PLAN_BYTES - base;
    doc.fixtures[0]!.label =
      "한".repeat(Math.floor(remaining / 3)) + "a".repeat(remaining % 3);
    expect(JSON.stringify(doc).length).toBeLessThan(MAX_FLOOR_PLAN_BYTES);
    expect(new TextEncoder().encode(JSON.stringify(doc)).byteLength).toBe(
      MAX_FLOOR_PLAN_BYTES,
    );
    expect(floorPlanSchema.safeParse(doc).success).toBe(true);
    doc.fixtures[0]!.label += "a";
    const parsed = floorPlanSchema.safeParse(doc);
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(parsed.error.issues).toContainEqual(
        expect.objectContaining({
          path: [],
          message: "평면도 문서는 900KB 이하여야 해요.",
        }),
      );
  });
  it("counts escaped JSON bytes, not just label characters", () => {
    const doc = document();
    doc.fixtures.push({
      id: "f",
      kind: "core",
      polygon,
      label: "\n".repeat(MAX_FLOOR_PLAN_BYTES / 2),
    });
    expect(floorPlanSchema.safeParse(doc).success).toBe(false);
  });
});

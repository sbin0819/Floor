import { describe, expect, it } from "vitest";
import {
  isSimplePolygon,
  pointInPolygonStrict,
  polygonArea,
  polygonLabelPoint,
  polygonsOverlap,
  rotatedRectanglesOverlap,
} from "@/lib/floor-plan/geometry";
import { pointInPolygon } from "@/lib/floor-plan/render/hit-test";
import type { PlanPoint } from "@/lib/floor-plan/types";

const rect = (x: number, y: number, w: number, h: number): PlanPoint[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];
const square = rect(0, 0, 10, 10);
const concave: PlanPoint[] = [
  [0, 0],
  [10, 0],
  [10, 4],
  [4, 4],
  [4, 10],
  [0, 10],
];

describe("polygon area and simplicity", () => {
  it("uses the absolute shoelace area for either winding and concave shapes", () => {
    expect(polygonArea(square)).toBe(100);
    expect(polygonArea([...square].reverse())).toBe(100);
    expect(polygonArea(concave)).toBe(64);
    expect(
      polygonArea([
        [0, 0],
        [1, 0],
        [0, 1],
      ]),
    ).toBe(0.5);
    expect(polygonArea([])).toBe(0);
  });
  it.each(
    (
      [
        square,
        concave,
        [...concave].reverse(),
        [
          [0, 0],
          [5, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
      ] satisfies PlanPoint[][]
    ).map((points) => ({ points })),
  )(
    "accepts simple polygon %# including forward collinear edges",
    ({ points }) => {
      expect(isSimplePolygon(points)).toBe(true);
    },
  );
  it.each<{ name: string; points: PlanPoint[] }>([
    {
      name: "proper edge crossing",
      points: [
        [0, 0],
        [10, 10],
        [0, 10],
        [10, 0],
      ],
    },
    {
      name: "nonadjacent vertex touching an edge",
      points: [
        [0, 0],
        [10, 0],
        [10, 10],
        [5, 0],
        [0, 10],
      ],
    },
    {
      name: "zero length edge",
      points: [
        [0, 0],
        [10, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
    },
    { name: "zero closing edge", points: [...square, square[0]!] },
    {
      name: "adjacent backtracking",
      points: [
        [0, 0],
        [10, 0],
        [5, 0],
        [5, 10],
        [0, 10],
      ],
    },
    {
      name: "closing backtracking",
      points: [
        [0, 0],
        [10, 0],
        [10, 10],
        [5, 0],
      ],
    },
    {
      name: "repeated nonadjacent vertex",
      points: [
        [0, 0],
        [10, 0],
        [5, 5],
        [10, 10],
        [0, 10],
        [5, 5],
      ],
    },
    {
      name: "all collinear",
      points: [
        [0, 0],
        [5, 0],
        [10, 0],
      ],
    },
    {
      name: "not enough vertices",
      points: [
        [0, 0],
        [10, 0],
      ],
    },
  ])("rejects $name", ({ points }) => {
    expect(isSimplePolygon(points)).toBe(false);
    expect(isSimplePolygon([...points].reverse())).toBe(false);
  });
  it("keeps maximum-coordinate products within exact integer arithmetic", () => {
    const large = rect(0, 0, 100_000, 100_000);
    expect(polygonArea(large)).toBe(10_000_000_000);
    expect(isSimplePolygon(large)).toBe(true);
  });
});

describe("strict polygon containment and labels", () => {
  it.each<{ point: PlanPoint; inside: boolean }>([
    { point: [2, 2], inside: true },
    { point: [2, 9], inside: true },
    { point: [9, 2], inside: true },
    { point: [8, 8], inside: false },
    { point: [4, 4], inside: false },
    { point: [0, 5], inside: false },
    { point: [10, 0], inside: false },
    { point: [-1, 0], inside: false },
  ])("tests concave point $point strictly", ({ point, inside }) => {
    expect(pointInPolygonStrict(point, concave)).toBe(inside);
    expect(pointInPolygonStrict(point, [...concave].reverse())).toBe(inside);
  });
  it("leaves the renderer's inclusive boundary contract unchanged", () => {
    expect(pointInPolygon([0, 5], square)).toBe(true);
    expect(pointInPolygonStrict([0, 5], square)).toBe(false);
  });
  it("uses the bbox center for a rectangle and longest horizontal interval for an L shape", () => {
    expect(polygonLabelPoint(square)).toEqual([5, 5]);
    expect(polygonLabelPoint(concave)).toEqual([2, 5]);
    expect(polygonLabelPoint([...concave].reverse())).toEqual([2, 5]);
  });
  it("chooses the longest interval instead of the first on a center scanline", () => {
    const shape: PlanPoint[] = [
      [0, 0],
      [12, 0],
      [12, 10],
      [8, 10],
      [8, 3],
      [2, 3],
      [2, 10],
      [0, 10],
    ];
    expect(polygonLabelPoint(shape)).toEqual([10, 5]);
  });
  it("rounds half integers and rechecks boundary results before returning a label", () => {
    expect(polygonLabelPoint(rect(0, 0, 3, 3))).toEqual([2, 2]);
    const triangle: PlanPoint[] = [
      [0, 0],
      [3, 0],
      [0, 3],
    ];
    expect(polygonLabelPoint(triangle)).toEqual([1, 1]);
    expect(pointInPolygonStrict(polygonLabelPoint(triangle)!, triangle)).toBe(
      true,
    );
  });
  it("finds a safe nearby integer away from a thin central arm", () => {
    const shape: PlanPoint[] = [
      [0, 0],
      [10, 0],
      [10, 1],
      [2, 1],
      [2, 10],
      [0, 10],
    ];
    const point = polygonLabelPoint(shape);
    expect(point).not.toBeNull();
    expect(point!.every(Number.isInteger)).toBe(true);
    expect(pointInPolygonStrict(point!, shape)).toBe(true);
  });
  it.each(
    (
      [
        rect(0, 0, 1, 10),
        [
          [0, 0],
          [1, 0],
          [0, 1],
        ],
        [],
        [
          [0, 0],
          [2, 0],
          [3, 0],
        ],
      ] satisfies PlanPoint[][]
    ).map((points) => ({ points })),
  )(
    "returns null rather than a boundary label for polygon %#",
    ({ points }) => {
      expect(polygonLabelPoint(points)).toBeNull();
    },
  );
});

describe("polygon overlap without boundary-only contact", () => {
  const cases: {
    name: string;
    a: PlanPoint[];
    b: PlanPoint[];
    overlap: boolean;
  }[] = [
    {
      name: "partial containment sharing three boundaries",
      a: square,
      b: rect(0, 0, 10, 5),
      overlap: true,
    },
    {
      name: "T-junction on right edge",
      a: square,
      b: rect(10, 2, 10, 6),
      overlap: false,
    },
    {
      name: "diamond vertices on edge midpoints",
      a: square,
      b: [
        [5, 0],
        [10, 5],
        [5, 10],
        [0, 5],
      ],
      overlap: true,
    },
    { name: "same polygon", a: square, b: square, overlap: true },
    {
      name: "same boundary split differently",
      a: square,
      b: [
        [0, 0],
        [5, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      overlap: true,
    },
    {
      name: "proper crossing",
      a: square,
      b: rect(5, -5, 10, 10),
      overlap: true,
    },
    { name: "full interior", a: square, b: rect(1, 1, 2, 2), overlap: true },
    {
      name: "shared full edge",
      a: square,
      b: rect(10, 0, 10, 10),
      overlap: false,
    },
    {
      name: "shared vertex",
      a: square,
      b: rect(10, 10, 10, 10),
      overlap: false,
    },
    { name: "disjoint", a: square, b: rect(11, 0, 10, 10), overlap: false },
    {
      name: "concave missing quadrant",
      a: concave,
      b: rect(4, 4, 6, 6),
      overlap: false,
    },
    {
      name: "concave partial boundary",
      a: concave,
      b: rect(3, 4, 6, 6),
      overlap: true,
    },
    {
      name: "matching triangles without integer interior point",
      a: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
      b: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
      overlap: true,
    },
    {
      name: "opposite triangles sharing only diagonal",
      a: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
      b: [
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      overlap: false,
    },
  ];
  it.each(cases)("handles $name", ({ a, b, overlap }) => {
    expect(polygonsOverlap(a, b)).toBe(overlap);
    expect(polygonsOverlap(b, a)).toBe(overlap);
    expect(polygonsOverlap([...a].reverse(), b)).toBe(overlap);
  });
  it("does not mutate vertices", () => {
    const before = structuredClone(concave);
    polygonsOverlap(concave, square);
    polygonLabelPoint(concave);
    expect(concave).toEqual(before);
  });
});

describe("rotated rectangle overlap", () => {
  const seat = (
    x: number,
    rotation = 0,
    size: [number, number] = [1000, 600],
  ) => ({ at: [x, 0] as PlanPoint, rotation, size });
  it.each([0, 90, 180, 270, -90, 450])(
    "treats touching cardinal rotation %s exactly",
    (rotation) => {
      const width = rotation % 180 === 0 ? 1000 : 600;
      expect(
        rotatedRectanglesOverlap(seat(0, rotation), seat(width, rotation)),
      ).toBe(false);
      expect(
        rotatedRectanglesOverlap(seat(0, rotation), seat(width - 1, rotation)),
      ).toBe(true);
      expect(
        rotatedRectanglesOverlap(seat(0, rotation), seat(width + 1, rotation)),
      ).toBe(false);
    },
  );
  it("uses doubled integer corners for odd dimensions and mixed cardinal rotations", () => {
    expect(
      rotatedRectanglesOverlap(seat(0, 0, [3, 1]), seat(2, 90, [3, 1])),
    ).toBe(false);
    expect(
      rotatedRectanglesOverlap(seat(0, 0, [3, 1]), seat(1, 90, [3, 1])),
    ).toBe(true);
  });
  it("allows 0.5mm tolerance for noncardinal rotations on normalized SAT axes", () => {
    const at = (distance: number): PlanPoint => [
      distance / Math.sqrt(2),
      distance / Math.sqrt(2),
    ];
    const a = {
      at: [0, 0] as PlanPoint,
      size: [1000, 600] as [number, number],
      rotation: 45,
    };
    expect(rotatedRectanglesOverlap(a, { ...a, at: at(1000) })).toBe(false);
    expect(rotatedRectanglesOverlap(a, { ...a, at: at(999.6) })).toBe(false);
    expect(rotatedRectanglesOverlap(a, { ...a, at: at(999.4) })).toBe(true);
    expect(rotatedRectanglesOverlap(a, { ...a, at: at(1001) })).toBe(false);
  });
  it("tests separating axes of both rectangles", () => {
    const a = seat(0, 45);
    const b = { ...seat(800, -30), at: [800, 800] as PlanPoint };
    expect(rotatedRectanglesOverlap(a, b)).toBe(false);
    expect(rotatedRectanglesOverlap(b, a)).toBe(false);
    expect(rotatedRectanglesOverlap(a, { ...b, at: [10, 20] })).toBe(true);
  });
});

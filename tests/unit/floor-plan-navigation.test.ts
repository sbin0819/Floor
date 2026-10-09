import { describe, expect, it } from "vitest";
import {
  nearestInDirection,
  readingOrder,
  type PlanDirection,
} from "@/lib/floor-plan/render/navigation";

const shape = (id: string, x: number, y: number, order = 0) => ({
  id,
  labelAt: [x, y] as const,
  order,
});

describe("floor plan reading order", () => {
  it("orders rows by their top edge and spaces in each row from left to right", () => {
    const shapes = [
      shape("bottom", 0, 3000),
      shape("right", 5000, 0),
      shape("left", 0, 1900),
      shape("middle", 2000, 1000),
    ];
    expect(readingOrder(shapes).map(({ id }) => id)).toEqual([
      "left",
      "middle",
      "right",
      "bottom",
    ]);
  });
  it("includes the 2000mm boundary but does not chain adjacent rows", () => {
    const shapes = [
      shape("third", -1000, 4000),
      shape("boundary", 1000, 2000),
      shape("first", 2000, 0),
      shape("outside", 0, 2001),
    ];
    expect(readingOrder(shapes).map(({ id }) => id)).toEqual([
      "boundary",
      "first",
      "third",
      "outside",
    ]);
  });
  it("breaks equal coordinate ties by original drawing order then id", () => {
    expect(
      readingOrder([
        shape("z", 0, 0, 2),
        shape("b", 0, 0, 1),
        shape("a", 0, 0, 1),
      ]).map(({ id }) => id),
    ).toEqual(["a", "b", "z"]);
  });
  it("does not mutate or clone the supplied shapes", () => {
    const first = shape("first", 0, 0);
    const second = shape("second", 1000, 0);
    const input = Object.freeze([second, first]);
    expect(readingOrder(input)).toEqual([first, second]);
    expect(readingOrder(input)[0]).toBe(first);
    expect(input).toEqual([second, first]);
    expect(readingOrder([])).toEqual([]);
  });
});

describe("floor plan direction navigation", () => {
  const origin = shape("origin", 5000, 5000);
  const candidates = [
    origin,
    shape("left", 4000, 5000),
    shape("right", 6000, 5000),
    shape("up", 5000, 4000),
    shape("down", 5000, 6000),
  ];
  it.each(["left", "right", "up", "down"] as const)(
    "moves %s without wrapping",
    (direction) => {
      expect(nearestInDirection(origin, candidates, direction)?.id).toBe(
        direction,
      );
      expect(
        nearestInDirection(
          candidates.find(({ id }) => id === direction)!,
          candidates,
          direction,
        ),
      ).toBeNull();
    },
  );
  it("weights perpendicular displacement twice instead of choosing Euclidean distance", () => {
    const diagonal = shape("diagonal", 6000, 6500);
    const aligned = shape("aligned", 8000, 5000);
    expect(
      nearestInDirection(origin, [origin, diagonal, aligned], "right"),
    ).toBe(aligned);
  });
  it("breaks equal scores in reading order regardless of candidate input order", () => {
    const above = shape("above", 7000, 4000);
    const below = shape("below", 7000, 6000);
    expect(nearestInDirection(origin, [below, above], "right")).toBe(above);
    expect(nearestInDirection(origin, [above, below], "right")).toBe(above);
  });
  it("does not choose the same id, a coincident target, or an opposite direction", () => {
    const values = [
      shape("origin", 8000, 5000),
      shape("coincident", 5000, 5000),
      shape("behind", 2000, 5000),
    ];
    expect(nearestInDirection(origin, values, "right")).toBeNull();
    expect(nearestInDirection(origin, [], "down")).toBeNull();
  });
  it("applies the same distance rule to every direction", () => {
    const values: [
      PlanDirection,
      ReturnType<typeof shape>,
      ReturnType<typeof shape>,
    ][] = [
      ["left", shape("near", 4000, 5000), shape("far", 2000, 5000)],
      ["right", shape("near", 6000, 5000), shape("far", 8000, 5000)],
      ["up", shape("near", 5000, 4000), shape("far", 5000, 2000)],
      ["down", shape("near", 5000, 6000), shape("far", 5000, 8000)],
    ];
    for (const [direction, near, far] of values)
      expect(nearestInDirection(origin, [far, near], direction)).toBe(near);
  });
});

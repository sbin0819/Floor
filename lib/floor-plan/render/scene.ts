import type { FloorPlanDocument } from "../types";
import {
  wallSegments,
  pointAlongSegment as along,
  resolveOpening,
  type WallSegment,
} from "../openings";
import type { Box, OpeningShape, PlanScene, PlanShape, Point } from "./types";

export function boundsOf(points: readonly Point[], padding = 0): Box {
  const bounds = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  for (const [x, y] of points) {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxY = Math.max(bounds.maxY, y);
  }
  return {
    minX: bounds.minX - padding,
    minY: bounds.minY - padding,
    maxX: bounds.maxX + padding,
    maxY: bounds.maxY + padding,
  };
}
function center(box: Box): Point {
  return [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2];
}
export function seatPolygon(seat: FloorPlanDocument["seats"][number]): Point[] {
  const radians = ((seat.rotation % 360) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const [w, h] = seat.size;
  return (
    [
      [-w / 2, -h / 2],
      [w / 2, -h / 2],
      [w / 2, h / 2],
      [-w / 2, h / 2],
    ] as Point[]
  ).map(([x, y]) => [
    seat.at[0] + x * cos - y * sin,
    seat.at[1] + x * sin + y * cos,
  ]);
}
export function createScene(document: FloorPlanDocument): PlanScene {
  const shapes: PlanShape[] = [];
  for (const fixture of document.fixtures) {
    const points = fixture.polygon.map((point): Point => [...point]);
    const bounds = boundsOf(points);
    shapes.push({
      kind: "fixture",
      id: fixture.id,
      spaceId: null,
      points,
      bounds,
      labelAt: center(bounds),
      label: fixture.label,
      order: shapes.length,
    });
  }
  for (const space of document.spaces) {
    const points = space.polygon.map((point): Point => [...point]);
    shapes.push({
      kind: "space",
      id: space.id,
      spaceId: space.spaceId.toLowerCase(),
      points,
      bounds: boundsOf(points),
      labelAt: [...space.label.at],
      order: shapes.length,
    });
  }
  for (const seat of document.seats) {
    const points = seatPolygon(seat);
    shapes.push({
      kind: "seat",
      id: seat.id,
      spaceId: seat.spaceId.toLowerCase(),
      points,
      bounds: boundsOf(points),
      labelAt: [...seat.at],
      order: shapes.length,
    });
  }
  for (const wall of document.walls) {
    const segments = wallSegments(wall);
    if (!segments.length) continue;
    const gaps = new Map<WallSegment, { start: number; end: number }[]>();
    const openings: Omit<OpeningShape, "order">[] = [];
    for (const opening of document.openings.filter(
      (item) => item.wallId === wall.id,
    )) {
      const resolved = resolveOpening(wall, opening);
      if (!resolved) continue;
      const segment = segments.find(
        ({ index }) => index === resolved.segmentIndex,
      )!;
      const {
        startDistance: start,
        endDistance: end,
        hinge,
        radius,
        angle,
      } = resolved;
      const values = gaps.get(segment) ?? [];
      values.push({ start, end });
      gaps.set(segment, values);
      openings.push({
        id: opening.id,
        kind: "opening",
        spaceId: null,
        points: [hinge, along(segment, end)],
        hinge,
        angle,
        radius,
        door: opening.kind === "door",
        labelAt: resolved.center,
        bounds: boundsOf([hinge], radius),
      });
    }
    const visible: [Point, Point][] = [];
    for (const segment of segments) {
      let position = 0;
      for (const gap of (gaps.get(segment) ?? []).sort(
        (a, b) => a.start - b.start,
      )) {
        if (gap.start > position)
          visible.push([along(segment, position), along(segment, gap.start)]);
        position = Math.max(position, gap.end);
      }
      if (position < segment.length)
        visible.push([along(segment, position), segment.end]);
    }
    shapes.push({
      kind: "wall",
      id: wall.id,
      spaceId: null,
      points: wall.points.map((point): Point => [...point]),
      bounds: boundsOf(wall.points, wall.thickness / 2),
      labelAt: center(boundsOf(wall.points)),
      thickness: wall.thickness,
      segments: visible,
      order: shapes.length,
    });
    for (const opening of openings)
      shapes.push({ ...opening, order: shapes.length });
  }
  return { bounds: { ...document.bounds }, shapes };
}

import RBush from "rbush";
import { seatPolygon } from "@/lib/floor-plan/render/scene";
import type { Box, Point } from "@/lib/floor-plan/render/types";
import type { FloorPlanDocument, PlanPoint } from "@/lib/floor-plan/types";
import { snapPoint as snapGridPoint } from "./transforms";

export type SnapVertex = {
  shapeId: string;
  index: number;
  at: Point;
  order: number;
};
export type VertexIndex = { search(box: Box): readonly SnapVertex[] };
export type SnapContext = {
  scale: number;
  grid: boolean;
  shift?: boolean;
  alt?: boolean;
  origin?: Point | null;
  vertices: VertexIndex;
  excludeShapeIds?: readonly string[];
};
export type SnapResult = {
  point: PlanPoint;
  kind: "vertex" | "angle" | "grid" | null;
  guide?: { from: Point; to: Point };
};
export function createVertexIndex(document: FloorPlanDocument): VertexIndex {
  const rows: (SnapVertex & Box)[] = [];
  const add = (shapeId: string, points: readonly Point[]) =>
    points.forEach((at, index) =>
      rows.push({
        shapeId,
        index,
        at: [...at],
        order: rows.length,
        minX: at[0],
        maxX: at[0],
        minY: at[1],
        maxY: at[1],
      }),
    );
  for (const shape of document.spaces) add(shape.id, shape.polygon);
  for (const shape of document.fixtures) add(shape.id, shape.polygon);
  for (const shape of document.walls) add(shape.id, shape.points);
  for (const shape of document.seats) add(shape.id, seatPolygon(shape));
  const tree = new RBush<(typeof rows)[number]>().load(rows);
  return { search: (box) => tree.search(box) };
}
export function snapPoint(point: Point, context: SnapContext): SnapResult {
  const plain = (): SnapResult => ({
    point: snapGridPoint([...point], false),
    kind: null,
  });
  if (
    context.alt ||
    !Number.isFinite(context.scale) ||
    context.scale <= 0 ||
    !point.every(Number.isFinite)
  )
    return plain();
  const tolerance = 8 / context.scale;
  const excluded = new Set(context.excludeShapeIds ?? []);
  const vertices = context.vertices.search({
    minX: point[0] - tolerance,
    maxX: point[0] + tolerance,
    minY: point[1] - tolerance,
    maxY: point[1] + tolerance,
  });
  const nearest = vertices
    .filter((value) => !excluded.has(value.shapeId))
    .map((value) => ({
      value,
      distance: Math.hypot(value.at[0] - point[0], value.at[1] - point[1]),
    }))
    .filter(({ distance }) => distance <= tolerance)
    .sort(
      (a, b) => a.distance - b.distance || a.value.order - b.value.order,
    )[0];
  if (nearest) {
    const at = snapGridPoint([...nearest.value.at], false);
    return { point: at, kind: "vertex", guide: { from: point, to: at } };
  }
  if (context.shift && context.origin) {
    const [x, y] = context.origin;
    const dx = point[0] - x,
      dy = point[1] - y;
    const angle =
      Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const distance = dx * Math.cos(angle) + dy * Math.sin(angle);
    const at = snapGridPoint(
      [x + Math.cos(angle) * distance, y + Math.sin(angle) * distance],
      false,
    );
    return {
      point: at,
      kind: "angle",
      guide: { from: context.origin, to: at },
    };
  }
  if (context.grid)
    return { point: snapGridPoint([...point], true), kind: "grid" };
  return plain();
}

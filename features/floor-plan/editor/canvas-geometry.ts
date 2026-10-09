import { boundsOf, seatPolygon } from "@/lib/floor-plan/render/scene";
import type {
  Box,
  Camera,
  Point,
  PlanShape,
} from "@/lib/floor-plan/render/types";
import { toScreen } from "@/lib/floor-plan/render/camera";
import type { FloorPlanDocument, PlanPoint } from "@/lib/floor-plan/types";
import { resolveOpening } from "@/lib/floor-plan/openings";

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export function rectanglePoints(a: Point, b: Point): PlanPoint[] {
  const left = Math.min(a[0], b[0]),
    right = Math.max(a[0], b[0]);
  const top = Math.min(a[1], b[1]),
    bottom = Math.max(a[1], b[1]);
  return [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ];
}
export function handles(box: Box): { name: Handle; at: Point }[] {
  const x = (box.minX + box.maxX) / 2,
    y = (box.minY + box.maxY) / 2;
  return [
    { name: "nw", at: [box.minX, box.minY] },
    { name: "n", at: [x, box.minY] },
    { name: "ne", at: [box.maxX, box.minY] },
    { name: "e", at: [box.maxX, y] },
    { name: "se", at: [box.maxX, box.maxY] },
    { name: "s", at: [x, box.maxY] },
    { name: "sw", at: [box.minX, box.maxY] },
    { name: "w", at: [box.minX, y] },
  ];
}
export function hitHandle(
  box: Box,
  point: Point,
  camera: Camera,
): Handle | null {
  return (
    handles(box).find(({ at }) => {
      const screen = toScreen(at, camera);
      return (
        Math.abs(screen[0] - point[0]) <= 8 &&
        Math.abs(screen[1] - point[1]) <= 8
      );
    })?.name ?? null
  );
}
export function resizedBox(box: Box, handle: Handle, point: Point) {
  const left = handle.includes("w")
    ? Math.min(point[0], box.maxX - 1)
    : box.minX;
  const right = handle.includes("e")
    ? Math.max(point[0], box.minX + 1)
    : box.maxX;
  const top = handle.includes("n")
    ? Math.min(point[1], box.maxY - 1)
    : box.minY;
  const bottom = handle.includes("s")
    ? Math.max(point[1], box.minY + 1)
    : box.maxY;
  return { x: left, y: top, width: right - left, height: bottom - top };
}
export function editableShapes(document: FloorPlanDocument) {
  return [
    ...document.spaces,
    ...document.fixtures,
    ...document.seats,
    ...document.walls,
    ...document.openings,
  ];
}
export function selectionBox(
  document: FloorPlanDocument,
  ids: readonly string[],
): Box | null {
  const shapes = editableShapes(document).filter(({ id }) => ids.includes(id));
  const points = shapes.flatMap((shape) =>
    "polygon" in shape
      ? shape.polygon
      : "points" in shape
        ? shape.points
        : "spaceId" in shape
          ? seatPolygon(shape)
          : openingPoints(document, shape),
  );
  return points.length ? boundsOf(points) : null;
}
export function insideSelection(box: Box, shape: PlanShape) {
  return (
    shape.bounds.minX >= box.minX &&
    shape.bounds.maxX <= box.maxX &&
    shape.bounds.minY >= box.minY &&
    shape.bounds.maxY <= box.maxY
  );
}
function openingPoints(
  document: FloorPlanDocument,
  opening: FloorPlanDocument["openings"][number],
): Point[] {
  const wall = document.walls.find(({ id }) => id === opening.wallId);
  const resolved = wall && resolveOpening(wall, opening);
  return resolved ? [resolved.hinge, resolved.end] : [];
}
export function vertexShape(document: FloorPlanDocument, id: string | null) {
  return [...document.spaces, ...document.fixtures, ...document.walls].find(
    (shape) => shape.id === id,
  );
}
export function vertexPoints(
  document: FloorPlanDocument,
  id: string | null,
): readonly Point[] {
  const shape = vertexShape(document, id);
  return shape ? ("polygon" in shape ? shape.polygon : shape.points) : [];
}
export function nearestVertex(
  points: readonly Point[],
  point: Point,
  camera: Camera,
): number | null {
  let nearest: number | null = null,
    distance = 8;
  points.forEach((vertex, index) => {
    const screen = toScreen(vertex, camera);
    const next = Math.hypot(screen[0] - point[0], screen[1] - point[1]);
    if (next <= distance) {
      nearest = index;
      distance = next;
    }
  });
  return nearest;
}
export function nearestEdge(
  document: FloorPlanDocument,
  id: string,
  point: Point,
  camera: Camera,
): { index: number; point: PlanPoint } | null {
  const shape = vertexShape(document, id);
  if (!shape) return null;
  const points = "polygon" in shape ? shape.polygon : shape.points;
  const closed = "polygon" in shape || shape.closed;
  let result: { index: number; point: PlanPoint } | null = null,
    distance = 8;
  for (let index = 0; index < points.length - (closed ? 0 : 1); index++) {
    const a = toScreen(points[index]!, camera),
      b = toScreen(points[(index + 1) % points.length]!, camera);
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      length = dx * dx + dy * dy;
    if (!length) continue;
    const at = Math.max(
      0,
      Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length),
    );
    const next = Math.hypot(
      point[0] - a[0] - at * dx,
      point[1] - a[1] - at * dy,
    );
    if (next <= distance) {
      const worldA = points[index]!,
        worldB = points[(index + 1) % points.length]!;
      result = {
        index,
        point: [
          Math.round(worldA[0] + at * (worldB[0] - worldA[0])),
          Math.round(worldA[1] + at * (worldB[1] - worldA[1])),
        ],
      };
      distance = next;
    }
  }
  return result;
}
export function isRectangle(points: readonly Point[]) {
  if (points.length !== 4) return false;
  const xs = new Set(points.map(([x]) => x)),
    ys = new Set(points.map(([, y]) => y));
  return (
    xs.size === 2 &&
    ys.size === 2 &&
    points.every((point, index) => {
      const next = points[(index + 1) % points.length]!;
      return (point[0] === next[0]) !== (point[1] === next[1]);
    })
  );
}

import { boundsOf } from "@/lib/floor-plan/render/scene";
import type {
  Box,
  Camera,
  Point,
  PlanShape,
} from "@/lib/floor-plan/render/types";
import { toScreen } from "@/lib/floor-plan/render/camera";
import type { FloorPlanDocument, PlanPoint } from "@/lib/floor-plan/types";

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
  return [...document.spaces, ...document.fixtures];
}
export function selectionBox(
  document: FloorPlanDocument,
  ids: readonly string[],
): Box | null {
  const shapes = editableShapes(document).filter(({ id }) => ids.includes(id));
  return shapes.length
    ? boundsOf(shapes.flatMap(({ polygon }) => polygon))
    : null;
}
export function insideSelection(box: Box, shape: PlanShape) {
  return (
    (shape.kind === "space" || shape.kind === "fixture") &&
    shape.bounds.minX >= box.minX &&
    shape.bounds.maxX <= box.maxX &&
    shape.bounds.minY >= box.minY &&
    shape.bounds.maxY <= box.maxY
  );
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

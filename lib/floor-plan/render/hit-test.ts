import { toWorld } from "./camera";
import type {
  Camera,
  PlanShape,
  PlanSpatialIndex,
  Point,
  PolygonShape,
} from "./types";

export function pointInPolygon(
  point: Point,
  polygon: readonly Point[],
): boolean {
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index++
  ) {
    const a = polygon[previous]!;
    const b = polygon[index]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const cross = (point[0] - a[0]) * dy - (point[1] - a[1]) * dx;
    const tolerance =
      Number.EPSILON *
      16 *
      Math.max(
        1,
        Math.abs(point[0]),
        Math.abs(point[1]),
        ...a.map(Math.abs),
        ...b.map(Math.abs),
      );
    if (
      Math.abs(cross) <= tolerance * Math.max(1, Math.hypot(dx, dy)) &&
      point[0] >= Math.min(a[0], b[0]) - tolerance &&
      point[0] <= Math.max(a[0], b[0]) + tolerance &&
      point[1] >= Math.min(a[1], b[1]) - tolerance &&
      point[1] <= Math.max(a[1], b[1]) + tolerance
    )
      return true;
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
export function hitTest(
  index: PlanSpatialIndex,
  camera: Camera,
  screenPoint: Point,
  options: { kinds?: readonly ("space" | "seat" | "fixture")[] } = {},
): PolygonShape | null {
  const point = toWorld(screenPoint, camera);
  const kinds = options.kinds ?? ["space", "seat"];
  const candidates = index
    .search({ minX: point[0], maxX: point[0], minY: point[1], maxY: point[1] })
    .filter(
      (shape): shape is PolygonShape =>
        (shape.kind === "space" ||
          shape.kind === "seat" ||
          shape.kind === "fixture") &&
        kinds.includes(shape.kind),
    );
  const priority = (shape: PlanShape) => (shape.kind === "seat" ? 1 : 0);
  candidates.sort((a, b) => priority(b) - priority(a) || b.order - a.order);
  return (
    candidates.find((shape) => pointInPolygon(point, shape.points)) ?? null
  );
}

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

function distanceToSegment(point: Point, a: Point, b: Point) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const t = length
    ? Math.max(
        0,
        Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length),
      )
    : 0;
  return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy);
}

export function hitEditorShape(
  index: PlanSpatialIndex,
  camera: Camera,
  screenPoint: Point,
): PlanShape | null {
  const point = toWorld(screenPoint, camera);
  const tolerance = 4 / camera.scale;
  const priority = { opening: 4, seat: 3, wall: 2, fixture: 1, space: 0 };
  const candidates = index.search({
    minX: point[0] - tolerance,
    maxX: point[0] + tolerance,
    minY: point[1] - tolerance,
    maxY: point[1] + tolerance,
  });
  candidates.sort(
    (a, b) => priority[b.kind] - priority[a.kind] || b.order - a.order,
  );
  return (
    candidates.find((shape) => {
      if (shape.kind === "wall")
        return shape.segments.some(
          ([a, b]) =>
            distanceToSegment(point, a, b) <= shape.thickness / 2 + tolerance,
        );
      if (shape.kind !== "opening") return pointInPolygon(point, shape.points);
      if (
        distanceToSegment(point, shape.points[0]!, shape.points[1]!) <=
        tolerance
      )
        return true;
      if (!shape.door || !shape.radius) return false;
      const leaf: Point = [
        shape.hinge[0] + Math.cos(shape.angle - Math.PI / 2) * shape.radius,
        shape.hinge[1] + Math.sin(shape.angle - Math.PI / 2) * shape.radius,
      ];
      if (distanceToSegment(point, shape.hinge, leaf) <= tolerance) return true;
      const dx = point[0] - shape.hinge[0],
        dy = point[1] - shape.hinge[1];
      const localX = dx * Math.cos(shape.angle) + dy * Math.sin(shape.angle);
      const localY = -dx * Math.sin(shape.angle) + dy * Math.cos(shape.angle);
      return (
        localX >= 0 &&
        localY <= 0 &&
        Math.abs(Math.hypot(dx, dy) - shape.radius) <= tolerance
      );
    }) ?? null
  );
}

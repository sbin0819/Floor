import { pan, zoomAt } from "./camera";
import type { Camera, Point } from "./types";

type Pair = readonly [Point, Point];
const midpoint = ([a, b]: Pair): Point => [
  (a[0] + b[0]) / 2,
  (a[1] + b[1]) / 2,
];
const distance = ([a, b]: Pair) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function pinchCamera(
  camera: Camera,
  before: Pair,
  after: Pair,
  fitScale: number,
): Camera {
  const start = midpoint(before);
  const end = midpoint(after);
  const span = distance(before);
  const zoomed =
    span > 0 ? zoomAt(camera, start, distance(after) / span, fitScale) : camera;
  return pan(zoomed, end[0] - start[0], end[1] - start[1]);
}

export function isPlanTap(start: Point, end: Point) {
  return Math.hypot(end[0] - start[0], end[1] - start[1]) <= 8;
}

import type { FloorPlanDocument, PlanPoint } from "./types";

type Point = readonly [number, number];
type Polygon = readonly Point[];
type Rectangle = Pick<
  FloorPlanDocument["seats"][number],
  "at" | "size" | "rotation"
>;

const cross = (a: Point, b: Point, c: Point) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const samePoint = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];
const onSegment = (p: Point, a: Point, b: Point) =>
  cross(a, b, p) === 0 &&
  p[0] >= Math.min(a[0], b[0]) &&
  p[0] <= Math.max(a[0], b[0]) &&
  p[1] >= Math.min(a[1], b[1]) &&
  p[1] <= Math.max(a[1], b[1]);
const opposite = (a: number, b: number) => (a < 0 && b > 0) || (a > 0 && b < 0);
const properCrossing = (a: Point, b: Point, c: Point, d: Point) =>
  opposite(cross(a, b, c), cross(a, b, d)) &&
  opposite(cross(c, d, a), cross(c, d, b));

export function polygonArea(points: Polygon): number {
  let twiceArea = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    twiceArea += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(twiceArea) / 2;
}

export function isSimplePolygon(points: Polygon): boolean {
  if (points.length < 3) return false;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const c = points[(i + 2) % points.length]!;
    if (samePoint(a, b)) return false;
    if (
      cross(a, b, c) === 0 &&
      (a[0] - b[0]) * (c[0] - b[0]) + (a[1] - b[1]) * (c[1] - b[1]) > 0
    )
      return false;
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      const d = points[j]!;
      const e = points[(j + 1) % points.length]!;
      if (
        properCrossing(a, b, d, e) ||
        onSegment(d, a, b) ||
        onSegment(e, a, b) ||
        onSegment(a, d, e) ||
        onSegment(b, d, e)
      )
        return false;
    }
  }
  return polygonArea(points) > 0;
}

export function pointInPolygonStrict(point: Point, points: Polygon): boolean {
  let inside = false;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    if (onSegment(point, a, b)) return false;
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      (b[1] > a[1] ? cross(a, b, point) > 0 : cross(a, b, point) < 0)
    )
      inside = !inside;
  }
  return inside;
}

function bounds(points: Polygon) {
  return {
    minX: Math.min(...points.map(([x]) => x)),
    maxX: Math.max(...points.map(([x]) => x)),
    minY: Math.min(...points.map(([, y]) => y)),
    maxY: Math.max(...points.map(([, y]) => y)),
  };
}

function horizontalIntervals(points: Polygon, y: number): [number, number][] {
  const xs: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    if (a[1] > y !== b[1] > y)
      xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
  }
  xs.sort((a, b) => a - b);
  const result: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const left = xs[i]!;
    const right = xs[i + 1]!;
    if (left < right && pointInPolygonStrict([(left + right) / 2, y], points))
      result.push([left, right]);
  }
  return result;
}

function interiorSample(points: Polygon): PlanPoint | null {
  if (points.length < 3 || polygonArea(points) === 0) return null;
  const box = bounds(points);
  const center: PlanPoint = [
    (box.minX + box.maxX) / 2,
    (box.minY + box.maxY) / 2,
  ];
  if (pointInPolygonStrict(center, points)) return center;
  const ys = [...new Set(points.map(([, y]) => y))].sort((a, b) => a - b);
  for (const y of [
    center[1],
    ...ys.slice(1).map((value, i) => (ys[i]! + value) / 2),
  ]) {
    const intervals = horizontalIntervals(points, y).sort(
      (a, b) => b[1] - b[0] - (a[1] - a[0]),
    );
    const longest = intervals[0];
    if (longest) return [(longest[0] + longest[1]) / 2, y];
  }
  return null;
}

export function polygonLabelPoint(points: Polygon): PlanPoint | null {
  const preferred = interiorSample(points);
  if (!preferred) return null;
  const rounded: PlanPoint = [
    Math.round(preferred[0]),
    Math.round(preferred[1]),
  ];
  if (pointInPolygonStrict(rounded, points)) return rounded;
  const candidates: PlanPoint[] = [];
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++)
      candidates.push([rounded[0] + dx, rounded[1] + dy]);
  // 좁은 오목 도형에서도 꼭짓점 근처의 정수 주사선을 더 보되 전체 mm 격자는 훑지 않는다.
  const ys = new Set([
    rounded[1],
    ...points.flatMap(([, y]) => [y - 1, y, y + 1]),
  ]);
  for (const y of ys) {
    for (const [left, right] of horizontalIntervals(points, y)) {
      const min = Math.floor(left) + 1;
      const max = Math.ceil(right) - 1;
      if (min <= max)
        candidates.push([Math.min(max, Math.max(min, rounded[0])), y]);
    }
  }
  candidates.sort(
    (a, b) =>
      (a[0] - preferred[0]) ** 2 +
        (a[1] - preferred[1]) ** 2 -
        ((b[0] - preferred[0]) ** 2 + (b[1] - preferred[1]) ** 2) ||
      a[1] - b[1] ||
      a[0] - b[0],
  );
  return (
    candidates.find((point) => pointInPolygonStrict(point, points)) ?? null
  );
}

function boundaryEnters(source: Polygon, target: Polygon): boolean {
  const doubled = target.map(([x, y]): PlanPoint => [x * 2, y * 2]);
  for (let i = 0; i < source.length; i++) {
    const a = source[i]!;
    const b = source[(i + 1) % source.length]!;
    const parts = [a, b, ...target.filter((point) => onSegment(point, a, b))];
    parts.sort(
      (p, q) => (p[0] - q[0]) * (b[0] - a[0]) + (p[1] - q[1]) * (b[1] - a[1]),
    );
    for (let j = 1; j < parts.length; j++) {
      const p = parts[j - 1]!;
      const q = parts[j]!;
      if (
        !samePoint(p, q) &&
        pointInPolygonStrict([p[0] + q[0], p[1] + q[1]], doubled)
      )
        return true;
    }
  }
  return false;
}

export function polygonsOverlap(a: Polygon, b: Polygon): boolean {
  if (a.length < 3 || b.length < 3) return false;
  const ab = bounds(a);
  const bb = bounds(b);
  if (
    ab.maxX <= bb.minX ||
    bb.maxX <= ab.minX ||
    ab.maxY <= bb.minY ||
    bb.maxY <= ab.minY
  )
    return false;
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++)
      if (
        properCrossing(
          a[i]!,
          a[(i + 1) % a.length]!,
          b[j]!,
          b[(j + 1) % b.length]!,
        )
      )
        return true;
  if (boundaryEnters(a, b) || boundaryEnters(b, a)) return true;
  const sample = interiorSample(a);
  return sample !== null && pointInPolygonStrict(sample, b);
}

function rectanglePoints(rect: Rectangle, doubled: boolean): PlanPoint[] {
  const rotation = ((rect.rotation % 360) + 360) % 360;
  const angle = (rotation * Math.PI) / 180;
  const [cos, sin]: Point =
    rotation % 90 === 0
      ? (
          [
            [1, 0],
            [0, 1],
            [-1, 0],
            [0, -1],
          ] as const
        )[rotation / 90]!
      : [Math.cos(angle), Math.sin(angle)];
  const scale = doubled ? 2 : 1;
  return (
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const
  ).map(([x, y]): PlanPoint => [
    scale * rect.at[0] +
      ((x * rect.size[0] * cos - y * rect.size[1] * sin) * scale) / 2,
    scale * rect.at[1] +
      ((x * rect.size[0] * sin + y * rect.size[1] * cos) * scale) / 2,
  ]);
}

export function rotatedRectanglesOverlap(a: Rectangle, b: Rectangle): boolean {
  const exact = a.rotation % 90 === 0 && b.rotation % 90 === 0;
  const pa = rectanglePoints(a, exact);
  const pb = rectanglePoints(b, exact);
  for (const polygon of [pa, pb]) {
    for (let i = 0; i < 2; i++) {
      const p = polygon[i]!;
      const q = polygon[i + 1]!;
      const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const axis: PlanPoint = exact
        ? [-Math.sign(q[1] - p[1]), Math.sign(q[0] - p[0])]
        : [-(q[1] - p[1]) / length, (q[0] - p[0]) / length];
      const project = (points: Polygon) =>
        points.map(([x, y]) => x * axis[0] + y * axis[1]);
      const xa = project(pa);
      const xb = project(pb);
      if (
        Math.min(Math.max(...xa), Math.max(...xb)) -
          Math.max(Math.min(...xa), Math.min(...xb)) <=
        (exact ? 0 : 0.5)
      )
        return false;
    }
  }
  return true;
}

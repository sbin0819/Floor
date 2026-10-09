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

function rectangleAxes(rect: Rectangle): readonly [Point, Point] {
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
  return [
    [cos, sin],
    [-sin, cos],
  ];
}

export function rotatedRectangleBounds(rect: Rectangle) {
  const [[cos, sin]] = rectangleAxes(rect);
  const x = (Math.abs(cos) * rect.size[0] + Math.abs(sin) * rect.size[1]) / 2;
  const y = (Math.abs(sin) * rect.size[0] + Math.abs(cos) * rect.size[1]) / 2;
  return {
    minX: rect.at[0] - x,
    maxX: rect.at[0] + x,
    minY: rect.at[1] - y,
    maxY: rect.at[1] + y,
  };
}

export function rotatedRectanglesOverlap(a: Rectangle, b: Rectangle): boolean {
  const exact = a.rotation % 90 === 0 && b.rotation % 90 === 0;
  const aa = rectangleAxes(a);
  const ba = rectangleAxes(b);
  const dot = (x: Point, y: Point) => {
    const value = x[0] * y[0] + x[1] * y[1];
    // 정수 각도의 평행축은 긴 변에서도 삼각함수의 미세한 오차를 증폭하지 않는다.
    return Math.abs(value) < 1e-12
      ? 0
      : Math.abs(Math.abs(value) - 1) < 1e-12
        ? Math.sign(value)
        : value;
  };
  const distance: Point = [b.at[0] - a.at[0], b.at[1] - a.at[1]];
  for (const axis of [...aa, ...ba]) {
    // 꼭짓점끼리 빼면 매우 긴 변 옆의 짧은 변이 소실될 수 있어 중심과 축으로 투영한다.
    const ra =
      a.size[0] * Math.abs(dot(axis, aa[0])) +
      a.size[1] * Math.abs(dot(axis, aa[1]));
    const rb =
      b.size[0] * Math.abs(dot(axis, ba[0])) +
      b.size[1] * Math.abs(dot(axis, ba[1]));
    const separation = Math.abs(distance[0] * axis[0] + distance[1] * axis[1]);
    const overlap = Math.min(2 * ra, 2 * rb, ra + rb - 2 * separation);
    if (overlap <= (exact ? 0 : 1)) return false;
  }
  return true;
}

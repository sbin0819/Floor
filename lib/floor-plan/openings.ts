import type { FloorPlanDocument } from "./types";
import type { Point } from "./render/types";

export type PlanWall = FloorPlanDocument["walls"][number];
export type PlanOpening = FloorPlanDocument["openings"][number];
export type WallSegment = {
  index: number;
  start: Point;
  end: Point;
  length: number;
  offset: number;
};
export type OpeningPosition = {
  segmentIndex: number;
  segmentLength: number;
  totalLength: number;
  center: Point;
  hinge: Point;
  end: Point;
  angle: number;
  radius: number;
  position: number;
  startDistance: number;
  endDistance: number;
  contained: boolean;
};
export function wallSegments(wall: PlanWall): WallSegment[] {
  const result: WallSegment[] = [];
  let offset = 0;
  const count = wall.points.length - (wall.closed ? 0 : 1);
  for (let index = 0; index < count; index++) {
    const start = wall.points[index]!;
    const end = wall.points[(index + 1) % wall.points.length]!;
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (!length) continue;
    result.push({ index, start: [...start], end: [...end], length, offset });
    offset += length;
  }
  return result;
}
export function pointAlongSegment(
  segment: WallSegment,
  distance: number,
): Point {
  const fraction = distance / segment.length;
  return [
    segment.start[0] + (segment.end[0] - segment.start[0]) * fraction,
    segment.start[1] + (segment.end[1] - segment.start[1]) * fraction,
  ];
}
export function resolveOpening(
  wall: PlanWall,
  opening: Pick<PlanOpening, "at" | "width">,
): OpeningPosition | null {
  if (
    !Number.isFinite(opening.at) ||
    opening.at < 0 ||
    opening.at > 1 ||
    !Number.isFinite(opening.width) ||
    opening.width <= 0
  )
    return null;
  const segments = wallSegments(wall);
  const last = segments.at(-1);
  if (!last) return null;
  const totalLength = last.offset + last.length;
  const distance = opening.at * totalLength;
  const segment =
    segments.find((value) => distance < value.offset + value.length) ?? last;
  const position = Math.max(
    0,
    Math.min(segment.length, distance - segment.offset),
  );
  const rawStart = position - opening.width / 2;
  const rawEnd = position + opening.width / 2;
  // 잘못된 초안도 안전하게 그리되, 잘린 폭을 게시 가능한 문으로 취급하지 않아요.
  const startDistance = Math.max(0, rawStart);
  const endDistance = Math.min(segment.length, rawEnd);
  return {
    segmentIndex: segment.index,
    segmentLength: segment.length,
    totalLength,
    center: pointAlongSegment(segment, position),
    hinge: pointAlongSegment(segment, startDistance),
    end: pointAlongSegment(segment, endDistance),
    angle: Math.atan2(
      segment.end[1] - segment.start[1],
      segment.end[0] - segment.start[0],
    ),
    radius: endDistance - startDistance,
    position,
    startDistance,
    endDistance,
    contained: rawStart >= -1e-7 && rawEnd <= segment.length + 1e-7,
  };
}
export function projectOpening(
  wall: PlanWall,
  point: Point,
  width: number,
  segmentIndex?: number,
): { at: number; center: Point; segmentIndex: number } | null {
  if (!point.every(Number.isFinite) || !Number.isFinite(width) || width <= 0)
    return null;
  const segments = wallSegments(wall);
  const last = segments.at(-1);
  if (!last) return null;
  const total = last.offset + last.length;
  let best: {
    at: number;
    center: Point;
    segmentIndex: number;
    distance: number;
  } | null = null;
  for (const segment of segments) {
    if (
      (segmentIndex !== undefined && segment.index !== segmentIndex) ||
      width > segment.length
    )
      continue;
    const dx = segment.end[0] - segment.start[0],
      dy = segment.end[1] - segment.start[1];
    const fraction =
      ((point[0] - segment.start[0]) * dx +
        (point[1] - segment.start[1]) * dy) /
      (segment.length * segment.length);
    const wanted = (segment.offset + fraction * segment.length) / total;
    // 4자리 반올림이 모서리를 다시 넘지 않도록 표현 가능한 유효값 안에서 고릅니다.
    const min = Math.ceil(
      ((segment.offset + width / 2) / total) * 10000 - 1e-9,
    );
    const max = Math.floor(
      ((segment.offset + segment.length - width / 2) / total) * 10000 + 1e-9,
    );
    if (min > max) continue;
    const at = Math.max(min, Math.min(max, Math.round(wanted * 10000))) / 10000;
    const resolved = resolveOpening(wall, { at, width });
    if (!resolved?.contained || resolved.segmentIndex !== segment.index)
      continue;
    const distance = Math.hypot(
      point[0] - resolved.center[0],
      point[1] - resolved.center[1],
    );
    if (!best || distance < best.distance)
      best = {
        at,
        center: resolved.center,
        segmentIndex: segment.index,
        distance,
      };
  }
  return best
    ? { at: best.at, center: best.center, segmentIndex: best.segmentIndex }
    : null;
}

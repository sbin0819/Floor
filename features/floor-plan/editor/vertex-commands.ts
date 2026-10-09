import { polygonLabelPoint } from "@/lib/floor-plan/geometry";
import { resolveOpening } from "@/lib/floor-plan/openings";
import { boundsOf } from "@/lib/floor-plan/render/scene";
import type { FloorPlanDocument, PlanPoint } from "@/lib/floor-plan/types";
import {
  patchShapesCommand,
  type Command,
  type EditableShape,
} from "./commands";

type VertexShape = Extract<
  EditableShape,
  { collection: "spaces" | "fixtures" | "walls" }
>;
function findShape(
  document: FloorPlanDocument,
  id: string,
): VertexShape | null {
  const space = document.spaces.find((shape) => shape.id === id);
  if (space) return { collection: "spaces", shape: space };
  const fixture = document.fixtures.find((shape) => shape.id === id);
  if (fixture) return { collection: "fixtures", shape: fixture };
  const wall = document.walls.find((shape) => shape.id === id);
  return wall ? { collection: "walls", shape: wall } : null;
}
function pointsOf(value: VertexShape) {
  return value.collection === "walls"
    ? value.shape.points
    : value.shape.polygon;
}
function replacement(value: VertexShape, points: PlanPoint[]): VertexShape {
  if (value.collection === "walls")
    return { collection: "walls", shape: { ...value.shape, points } };
  if (value.collection === "fixtures")
    return {
      collection: "fixtures",
      shape: { ...value.shape, polygon: points },
    };
  const box = boundsOf(points);
  const at =
    polygonLabelPoint(points) ??
    ([
      Math.round((box.minX + box.maxX) / 2),
      Math.round((box.minY + box.maxY) / 2),
    ] as PlanPoint);
  return {
    collection: "spaces",
    shape: { ...value.shape, polygon: points, label: { at } },
  };
}
export function setVertexCommand(
  document: FloorPlanDocument,
  shapeId: string,
  index: number,
  point: PlanPoint,
): Command | null {
  const value = findShape(document, shapeId);
  if (!value || !Number.isInteger(index)) return null;
  const points = pointsOf(value);
  const old = points[index];
  if (
    !old ||
    !point.every(Number.isInteger) ||
    (old[0] === point[0] && old[1] === point[1])
  )
    return null;
  const next = points.map((current, i) =>
    i === index ? ([...point] as PlanPoint) : current,
  );
  return patchShapesCommand(
    document,
    { replace: [replacement(value, next)] },
    "꼭짓점 이동",
  );
}
export function insertVertexCommand(
  document: FloorPlanDocument,
  shapeId: string,
  segmentIndex: number,
  point: PlanPoint,
): Command | null {
  const value = findShape(document, shapeId);
  if (
    !value ||
    !Number.isInteger(segmentIndex) ||
    !point.every(Number.isInteger)
  )
    return null;
  const points = pointsOf(value);
  const count =
    value.collection === "walls" && !value.shape.closed
      ? points.length - 1
      : points.length;
  if (segmentIndex < 0 || segmentIndex >= count || points.length >= 64)
    return null;
  const next = [...points];
  next.splice(segmentIndex + 1, 0, [...point]);
  return patchShapesCommand(
    document,
    { replace: [replacement(value, next)] },
    "꼭짓점 추가",
  );
}
export function deleteVertexCommand(
  document: FloorPlanDocument,
  shapeId: string,
  index: number,
): Command | null {
  const value = findShape(document, shapeId);
  if (!value || !Number.isInteger(index)) return null;
  const points = pointsOf(value);
  if (
    index < 0 ||
    index >= points.length ||
    points.length <= (value.collection === "walls" ? 2 : 3)
  )
    return null;
  const removed = new Set<number>();
  const removeIds: string[] = [];
  if (value.collection === "walls") {
    if (index > 0) removed.add(index - 1);
    else if (value.shape.closed) removed.add(points.length - 1);
    if (index < points.length - 1 || value.shape.closed) removed.add(index);
    for (const opening of document.openings) {
      if (opening.wallId !== value.shape.id) continue;
      const position = resolveOpening(value.shape, opening);
      if (position && removed.has(position.segmentIndex))
        removeIds.push(opening.id);
    }
  }
  // 살아남은 문의 전체 길이 비율은 바꾸지 않고, 없어진 변의 문만 함께 지워요.
  return patchShapesCommand(
    document,
    {
      replace: [
        replacement(
          value,
          points.filter((_, i) => i !== index),
        ),
      ],
      removeIds,
    },
    "꼭짓점 삭제",
  );
}

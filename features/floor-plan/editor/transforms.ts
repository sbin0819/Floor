import {
  pointInPolygonStrict,
  polygonLabelPoint,
} from "@/lib/floor-plan/geometry";
import { floorPlanSchema } from "@/lib/floor-plan/schema";
import { seatPolygon } from "@/lib/floor-plan/render/scene";
import type { FloorPlanDocument, PlanPoint } from "@/lib/floor-plan/types";
import {
  addShapeCommand,
  groupCommands,
  replaceShapesCommand,
  type Command,
  type EditableShape,
  type FixtureShape,
} from "./commands";

type Rectangle = { x: number; y: number; width: number; height: number };
const optionsOff = { snap: false };

export function snapPoint(point: PlanPoint, enabled: boolean): PlanPoint {
  const grid = enabled ? 100 : 1;
  return [
    Math.round(point[0] / grid) * grid,
    Math.round(point[1] / grid) * grid,
  ];
}

function bounds(points: readonly PlanPoint[]) {
  const xs = points.map(([x]) => x),
    ys = points.map(([, y]) => y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}
function labelPoint(polygon: PlanPoint[]): PlanPoint {
  const box = bounds(polygon);
  // 정수 내부점이 없는 초안도 저장하고 검증 목록에서 라벨 오류를 고칠 수 있어야 해요.
  return (
    polygonLabelPoint(polygon) ?? [
      Math.round(box.x + box.width / 2),
      Math.round(box.y + box.height / 2),
    ]
  );
}
function selected(
  document: FloorPlanDocument,
  ids: readonly string[],
): EditableShape[] {
  const wanted = new Set(ids);
  return [
    ...document.spaces
      .filter(({ id }) => wanted.has(id))
      .map((shape): EditableShape => ({ collection: "spaces", shape })),
    ...document.fixtures
      .filter(({ id }) => wanted.has(id))
      .map((shape): EditableShape => ({ collection: "fixtures", shape })),
    ...document.seats
      .filter(({ id }) => wanted.has(id))
      .map((shape): EditableShape => ({ collection: "seats", shape })),
  ];
}
function shapePoints(value: EditableShape): PlanPoint[] {
  return value.collection === "seats"
    ? seatPolygon(value.shape).map(([x, y]): PlanPoint => [x, y])
    : value.shape.polygon;
}
function translate(value: EditableShape, delta: PlanPoint): EditableShape {
  const point = ([x, y]: PlanPoint): PlanPoint => [x + delta[0], y + delta[1]];
  if (value.collection === "seats")
    return {
      collection: "seats",
      shape: { ...value.shape, at: point(value.shape.at) },
    };
  const polygon = value.shape.polygon.map(point);
  return value.collection === "spaces"
    ? {
        collection: "spaces",
        shape: {
          ...value.shape,
          polygon,
          label: { at: point(value.shape.label.at) },
        },
      }
    : { collection: "fixtures", shape: { ...value.shape, polygon } };
}

export function createSpaceCommand(
  document: FloorPlanDocument,
  input: { id: string; spaceId: string; polygon: PlanPoint[] },
): Command | null {
  if (input.polygon.length < 3) return null;
  return addShapeCommand(
    document,
    {
      collection: "spaces",
      shape: { ...input, label: { at: labelPoint(input.polygon) } },
    },
    "공간 도형 추가",
  );
}
export function createFixtureCommand(
  document: FloorPlanDocument,
  input: {
    id: string;
    kind: FixtureShape["kind"];
    polygon: PlanPoint[];
    label?: string;
  },
): Command | null {
  return addShapeCommand(
    document,
    { collection: "fixtures", shape: input },
    "시설물 추가",
  );
}
export function connectSpaceCommand(
  document: FloorPlanDocument,
  shapeId: string,
  spaceId: string,
): Command | null {
  const shape = document.spaces.find(({ id }) => id === shapeId);
  return shape
    ? replaceShapesCommand(
        document,
        [{ collection: "spaces", shape: { ...shape, spaceId } }],
        "공간 연결 바꾸기",
      )
    : null;
}
export function moveShapesCommand(
  document: FloorPlanDocument,
  ids: readonly string[],
  delta: PlanPoint,
  options: { snap: boolean },
): Command | null {
  const values = selected(document, ids);
  if (!values.length) return null;
  const box = bounds(values.flatMap(shapePoints));
  const target = snapPoint([box.x + delta[0], box.y + delta[1]], options.snap);
  const offset: PlanPoint = options.snap
    ? [Math.round(target[0] - box.x), Math.round(target[1] - box.y)]
    : snapPoint(delta, false);
  return replaceShapesCommand(
    document,
    values.map((value) => translate(value, offset)),
    "도형 이동",
  );
}
export function resizeShapeCommand(
  document: FloorPlanDocument,
  id: string,
  box: Rectangle,
  options: { snap: boolean },
): Command | null {
  const value = selected(document, [id])[0];
  if (!value || value.collection === "seats") return null;
  const before = bounds(value.shape.polygon);
  if (before.width <= 0 || before.height <= 0) return null;
  const start = snapPoint([box.x, box.y], options.snap);
  const end = snapPoint([box.x + box.width, box.y + box.height], options.snap);
  if (end[0] <= start[0] || end[1] <= start[1]) return null;
  const polygon = value.shape.polygon.map(([x, y]): PlanPoint => [
    Math.round(
      start[0] + ((x - before.x) / before.width) * (end[0] - start[0]),
    ),
    Math.round(
      start[1] + ((y - before.y) / before.height) * (end[1] - start[1]),
    ),
  ]);
  const next: EditableShape =
    value.collection === "spaces"
      ? {
          collection: "spaces",
          shape: {
            ...value.shape,
            polygon,
            label: { at: labelPoint(polygon) },
          },
        }
      : { collection: "fixtures", shape: { ...value.shape, polygon } };
  return replaceShapesCommand(document, [next], "도형 크기 바꾸기");
}
export function setRectangleCommand(
  document: FloorPlanDocument,
  id: string,
  box: Rectangle,
): Command | null {
  const value = selected(document, [id])[0];
  if (!value || value.collection === "seats") return null;
  const points = value.shape.polygon;
  const xs = new Set(points.map(([x]) => x)),
    ys = new Set(points.map(([, y]) => y));
  if (
    points.length !== 4 ||
    xs.size !== 2 ||
    ys.size !== 2 ||
    !points.every((point, index) => {
      const next = points[(index + 1) % points.length]!;
      return (point[0] === next[0]) !== (point[1] === next[1]);
    })
  )
    return null;
  if (!Object.values(box).every(Number.isInteger)) return null;
  const before = bounds(points);
  return before.width === box.width && before.height === box.height
    ? moveShapesCommand(
        document,
        [id],
        [box.x - before.x, box.y - before.y],
        optionsOff,
      )
    : resizeShapeCommand(document, id, box, optionsOff);
}
export function setSpaceLabelCommand(
  document: FloorPlanDocument,
  id: string,
  position: "center" | "top-left",
): Command | null {
  const shape = document.spaces.find((space) => space.id === id);
  if (!shape) return null;
  const box = bounds(shape.polygon);
  const corner: PlanPoint = [
    Math.round(box.x + Math.min(100, box.width / 2)),
    Math.round(box.y + Math.min(100, box.height / 2)),
  ];
  const at =
    position === "top-left" && pointInPolygonStrict(corner, shape.polygon)
      ? corner
      : labelPoint(shape.polygon);
  return replaceShapesCommand(
    document,
    [{ collection: "spaces", shape: { ...shape, label: { at } } }],
    "라벨 위치 바꾸기",
  );
}
export function duplicateFixturesCommand(
  document: FloorPlanDocument,
  ids: readonly string[],
  newIds: ReadonlyMap<string, string>,
  delta: PlanPoint = [100, 100],
): Command | null {
  const values = selected(document, ids);
  if (
    !values.length ||
    values.some(({ collection }) => collection !== "fixtures")
  )
    return null;
  const commands: Command[] = [];
  let current = document;
  for (const value of values) {
    const id = newIds.get(value.shape.id);
    if (!id) return null;
    const moved = translate(value, delta);
    if (moved.collection !== "fixtures") return null;
    const command = addShapeCommand(current, {
      collection: "fixtures",
      shape: { ...moved.shape, id },
    });
    if (!command) return null;
    commands.push(command);
    current = command.apply(current);
  }
  return groupCommands("시설물 복제", commands);
}
export function alignShapesCommand(
  document: FloorPlanDocument,
  ids: readonly string[],
  alignment: "left" | "center-x" | "right" | "top" | "center-y" | "bottom",
): Command | null {
  const values = selected(document, ids);
  if (values.length < 2) return null;
  const group = bounds(values.flatMap(shapePoints));
  return replaceShapesCommand(
    document,
    values.map((value) => {
      const box = bounds(shapePoints(value));
      let dx = 0,
        dy = 0;
      if (alignment === "left") dx = group.x - box.x;
      if (alignment === "center-x")
        dx = group.x + group.width / 2 - box.x - box.width / 2;
      if (alignment === "right") dx = group.x + group.width - box.x - box.width;
      if (alignment === "top") dy = group.y - box.y;
      if (alignment === "center-y")
        dy = group.y + group.height / 2 - box.y - box.height / 2;
      if (alignment === "bottom")
        dy = group.y + group.height - box.y - box.height;
      return translate(value, [Math.round(dx), Math.round(dy)]);
    }),
    "도형 정렬",
  );
}
export function setBoundsCommand(
  document: FloorPlanDocument,
  bounds: { w: number; h: number },
): Command | null {
  if (bounds.w === document.bounds.w && bounds.h === document.bounds.h)
    return null;
  if (
    bounds.w > 100_000 ||
    bounds.h > 100_000 ||
    !floorPlanSchema.safeParse({ ...document, bounds }).success
  )
    return null;
  const before = document.bounds;
  return {
    label: "도면 크기 바꾸기",
    apply: (value) => ({ ...value, bounds }),
    revert: (value) => ({ ...value, bounds: before }),
  };
}

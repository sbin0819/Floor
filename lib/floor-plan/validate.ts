import RBush from "rbush";
import type { SpaceType } from "@/features/bookings/types";
import type { AccessScope } from "@/lib/permissions/types";
import {
  isSimplePolygon,
  pointInPolygonStrict,
  polygonArea,
  polygonsOverlap,
  rotatedRectangleBounds,
  rotatedRectanglesOverlap,
} from "./geometry";
import { createSeatAreaResolver, seatDisplayName } from "./seats";
import { resolveOpening } from "./openings";
import type { PlanIssue, PlanIssueCode } from "./issues";
import type { FloorPlanDocument, PlanPoint } from "./types";

export type PlanContext = {
  floorId: string;
  floorAccess: AccessScope;
  floorAllowedTeamIds: readonly string[];
  spaces: readonly {
    id: string;
    floorId: string;
    parentId: string | null;
    type: SpaceType;
    name: string;
    bookable: boolean;
    archived: boolean;
    access: AccessScope | null;
    allowedTeamIds: readonly string[];
  }[];
};

type IndexedPolygon = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  id: string;
  polygon: PlanPoint[];
  name: string;
  fixture: boolean;
  order: number;
};

export function validatePlan(
  document: FloorPlanDocument,
  context: PlanContext,
): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const rows = new Map(
    context.spaces.map((space) => [space.id.toLowerCase(), space]),
  );
  const shapes = new Map(
    document.spaces.map((shape) => [shape.spaceId.toLowerCase(), shape]),
  );
  const add = (code: PlanIssueCode, message: string, shapeId?: string) =>
    issues.push({
      code,
      ...(shapeId === undefined ? {} : { shapeId }),
      message,
    });

  if (
    context.floorAccess === "teams" &&
    context.floorAllowedTeamIds.length === 0
  )
    add(
      "ACCESS_TEAMS_EMPTY",
      "층의 이용 대상이 '지정한 팀'인데 허용 팀이 없어요.",
    );
  for (const space of context.spaces) {
    if (
      space.floorId !== context.floorId ||
      space.archived ||
      space.type === "desk"
    )
      continue;
    const shape = shapes.get(space.id.toLowerCase());
    if (!shape)
      add("SHAPE_MISSING", `${space.name}: 연결된 공간 도형이 없어요.`);
    if (space.access === "teams" && space.allowedTeamIds.length === 0)
      add(
        "ACCESS_TEAMS_EMPTY",
        `${space.name}: 이용 대상이 '지정한 팀'인데 허용 팀이 없어요.`,
        shape?.id,
      );
    // 층을 닫아도 공간의 기존 이용 대상은 보존한다. 실제 접근은 닫힌 층에서 차단된다.
    if (
      context.floorAccess === "teams" &&
      (space.access === "everyone" ||
        (space.access === "teams" &&
          space.allowedTeamIds.some(
            (id) => !context.floorAllowedTeamIds.includes(id),
          )))
    )
      add(
        "ACCESS_WIDER_THAN_FLOOR",
        `${space.name}: 이용 대상이 층보다 넓어요.`,
        shape?.id,
      );
  }
  for (const shape of document.spaces) {
    const space = rows.get(shape.spaceId.toLowerCase());
    if (!space)
      add("SPACE_UNKNOWN", "공간 도형이 가리키는 공간이 없어요.", shape.id);
    else {
      if (space.floorId !== context.floorId)
        add(
          "SPACE_OTHER_FLOOR",
          `${space.name}: 다른 층의 공간이에요.`,
          shape.id,
        );
      if (space.archived)
        add("SPACE_ARCHIVED", `${space.name}: 보관된 공간이에요.`, shape.id);
      if (space.type === "desk")
        add(
          "SPACE_IS_DESK",
          `${space.name}: 좌석은 공간 도형으로 연결할 수 없어요.`,
          shape.id,
        );
    }
    if (!pointInPolygonStrict(shape.label.at, shape.polygon))
      add(
        "LABEL_OUTSIDE",
        `${space?.name ?? "공간 도형"}: 라벨을 도형 안쪽으로 옮겨 주세요.`,
        shape.id,
      );
  }

  const index = new RBush<IndexedPolygon>();
  const polygons = [
    ...document.spaces.map((shape) => ({
      ...shape,
      fixture: false,
      name: rows.get(shape.spaceId.toLowerCase())?.name ?? "공간 도형",
    })),
    ...document.fixtures.map((shape) => ({
      ...shape,
      fixture: true,
      name: shape.label ?? "고정물",
    })),
  ];
  polygons.forEach((shape, order) => {
    const simple = isSimplePolygon(shape.polygon);
    if (!simple)
      add(
        "POLYGON_SELF_INTERSECT",
        `${shape.name}: 변이 교차하거나 되돌아가지 않게 고쳐 주세요.`,
        shape.id,
      );
    if (polygonArea(shape.polygon) < 500_000)
      add(
        "POLYGON_TOO_SMALL",
        `${shape.name}: 면적을 0.5㎡ 이상으로 늘려 주세요.`,
        shape.id,
      );
    // 겹침의 정의는 단순 다각형끼리다. 잘못된 다각형은 먼저 그 자체의 문제로 표시한다.
    if (!simple) return;
    const item: IndexedPolygon = {
      ...shape,
      order,
      minX: Math.min(...shape.polygon.map(([x]) => x)),
      maxX: Math.max(...shape.polygon.map(([x]) => x)),
      minY: Math.min(...shape.polygon.map(([, y]) => y)),
      maxY: Math.max(...shape.polygon.map(([, y]) => y)),
    };
    for (const other of index.search(item).sort((a, b) => a.order - b.order)) {
      if (shape.fixture && other.fixture) continue;
      if (polygonsOverlap(shape.polygon, other.polygon))
        add(
          "SPACE_OVERLAP",
          `${shape.name}: ${other.name} 도형과 겹쳐요.`,
          shape.id,
        );
    }
    index.insert(item);
  });
  issues.push(...validateSeats(document, context));
  const walls = new Map(document.walls.map((wall) => [wall.id, wall]));
  for (const opening of document.openings) {
    const wall = walls.get(opening.wallId);
    if (!wall || !resolveOpening(wall, opening)?.contained)
      add(
        "OPENING_OFF_WALL",
        "문의 양 끝을 벽의 같은 변 안에 놓아 주세요.",
        opening.id,
      );
  }
  return issues;
}

function validateSeats(
  document: FloorPlanDocument,
  context: PlanContext,
): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const rows = new Map(
    context.spaces.map((row) => [row.id.toLowerCase(), row]),
  );
  const onFloor = (row: PlanContext["spaces"][number]) =>
    row.floorId.toLowerCase() === context.floorId.toLowerCase();
  const areaOf = createSeatAreaResolver(document, context);
  const occupied = new Set<string>();
  const names = new Map<string, number>();
  const countName = (name: string) =>
    names.set(name.toLowerCase(), (names.get(name.toLowerCase()) ?? 0) + 1);
  // 이전 좌석 이름이 아니라 게시 뒤 남는 이름끼리 비교해야 이름 교환과 재사용이 가능하다.
  for (const row of context.spaces) {
    if (onFloor(row) && !row.archived && row.type !== "desk")
      countName(row.name);
  }
  const seats = document.seats.map((seat) => {
    const row = rows.get(seat.spaceId.toLowerCase());
    const name = seatDisplayName(seat, row);
    if (name !== null) countName(name);
    return { ...rotatedRectangleBounds(seat), seat, row, name };
  });
  const index = new RBush<(typeof seats)[number]>().load(seats);
  for (const item of seats) {
    const { seat, row, name } = item;
    const add = (code: PlanIssueCode, message: string) =>
      issues.push({ code, shapeId: seat.id, message });
    const area = areaOf(seat);
    if (!area)
      add(
        "SEAT_OUTSIDE_AREA",
        `${name ?? "좌석"}: 좌석의 중심을 데스크 구역 하나의 안쪽에 놓아 주세요.`,
      );
    else occupied.add(area.id.toLowerCase());
    if (row && (row.type !== "desk" || !onFloor(row)))
      add("SEAT_NOT_DESK", `${name ?? "좌석"}: 이 층의 좌석 행이 아니에요.`);
    if (row?.archived && row.type === "desk")
      add(
        "SEAT_ARCHIVED",
        `${name ?? "좌석"}: 보관된 좌석이에요. 새 좌석으로 바꿔 주세요.`,
      );
    if (!row && name === null)
      add("SEAT_LABEL_MISSING", "새 좌석의 이름을 입력해 주세요.");
    if (name !== null && (names.get(name.toLowerCase()) ?? 0) > 1)
      add(
        "SEAT_LABEL_DUPLICATE",
        `${name}: 같은 층의 다른 공간이나 좌석과 이름이 같아요.`,
      );
    // 좌석은 첫 충돌만 표시한다. 밀집된 잘못된 2,000석에서도 문제 목록이 쌍 수로 늘지 않는다.
    const other = index
      .search(item)
      .find(
        (candidate) =>
          candidate !== item && rotatedRectanglesOverlap(seat, candidate.seat),
      );
    if (other)
      add(
        "SEAT_OVERLAP",
        `${name ?? "좌석"}: ${other.name ?? "다른 좌석"}과 겹쳐요.`,
      );
  }
  const previousAreas = new Set(
    context.spaces
      .filter(
        (row) =>
          onFloor(row) && !row.archived && row.type === "desk" && row.parentId,
      )
      .map((row) => row.parentId!.toLowerCase()),
  );
  for (const row of context.spaces) {
    if (
      !onFloor(row) ||
      row.archived ||
      row.type !== "desk_area" ||
      !previousAreas.has(row.id.toLowerCase()) ||
      occupied.has(row.id.toLowerCase())
    )
      continue;
    const shape = document.spaces.find(
      (shape) => shape.spaceId.toLowerCase() === row.id.toLowerCase(),
    );
    issues.push({
      code: "SPACE_NO_SEATS",
      ...(shape ? { shapeId: shape.id } : {}),
      message: `${row.name}: 좌석이 모두 없어져요. 구역은 예약 없이 쓰는 곳으로 남아요.`,
    });
  }
  return issues;
}

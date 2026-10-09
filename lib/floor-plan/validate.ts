import RBush from "rbush";
import type { SpaceType } from "@/features/bookings/types";
import type { AccessScope } from "@/lib/permissions/types";
import {
  isSimplePolygon,
  pointInPolygonStrict,
  polygonArea,
  polygonsOverlap,
} from "./geometry";
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
  return issues;
}

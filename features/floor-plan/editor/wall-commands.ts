import { projectOpening, resolveOpening } from "@/lib/floor-plan/openings";
import type { FloorPlanDocument, PlanPoint } from "@/lib/floor-plan/types";
import type { Point } from "@/lib/floor-plan/render/types";
import {
  addShapeCommand,
  replaceShapesCommand,
  type Command,
  type OpeningShape,
  type WallShape,
} from "./commands";

export function createWallCommand(
  document: FloorPlanDocument,
  input: {
    id: string;
    points: PlanPoint[];
    closed: boolean;
    thickness?: number;
  },
): Command | null {
  const thickness = input.thickness ?? 100;
  if (!Number.isInteger(thickness) || thickness < 50 || thickness > 500)
    return null;
  return addShapeCommand(
    document,
    { collection: "walls", shape: { ...input, thickness } },
    "벽 추가",
  );
}
export function setWallCommand(
  document: FloorPlanDocument,
  id: string,
  patch: Partial<Pick<WallShape, "thickness" | "closed">>,
): Command | null {
  const wall = document.walls.find((value) => value.id === id);
  if (
    !wall ||
    (patch.thickness !== undefined &&
      (!Number.isInteger(patch.thickness) ||
        patch.thickness < 50 ||
        patch.thickness > 500))
  )
    return null;
  return replaceShapesCommand(
    document,
    [{ collection: "walls", shape: { ...wall, ...patch } }],
    "벽 바꾸기",
  );
}
export function createOpeningCommand(
  document: FloorPlanDocument,
  input: {
    id: string;
    wallId: string;
    point: Point;
    width?: number;
    kind?: OpeningShape["kind"];
  },
): Command | null {
  const wall = document.walls.find(({ id }) => id === input.wallId);
  const width = input.width ?? 900;
  if (!wall || !Number.isInteger(width) || width < 300 || width > 3000)
    return null;
  const position = projectOpening(wall, input.point, width);
  if (!position) return null;
  return addShapeCommand(
    document,
    {
      collection: "openings",
      shape: {
        id: input.id,
        wallId: input.wallId,
        at: position.at,
        width,
        kind: input.kind ?? "door",
      },
    },
    "문 추가",
  );
}
export function setOpeningCommand(
  document: FloorPlanDocument,
  id: string,
  patch: Partial<Pick<OpeningShape, "width" | "kind">>,
): Command | null {
  const opening = document.openings.find((value) => value.id === id);
  if (
    !opening ||
    (patch.width !== undefined &&
      (!Number.isInteger(patch.width) ||
        patch.width < 300 ||
        patch.width > 3000))
  )
    return null;
  return replaceShapesCommand(
    document,
    [{ collection: "openings", shape: { ...opening, ...patch } }],
    "문 바꾸기",
  );
}
export function moveOpeningCommand(
  document: FloorPlanDocument,
  id: string,
  point: Point,
  segmentIndex?: number,
): Command | null {
  const opening = document.openings.find((value) => value.id === id);
  const wall = document.walls.find((value) => value.id === opening?.wallId);
  if (!opening || !wall) return null;
  const current = resolveOpening(wall, opening);
  if (!current) return null;
  const position = projectOpening(
    wall,
    point,
    opening.width,
    segmentIndex ?? current.segmentIndex,
  );
  return position
    ? replaceShapesCommand(
        document,
        [{ collection: "openings", shape: { ...opening, at: position.at } }],
        "문 이동",
      )
    : null;
}

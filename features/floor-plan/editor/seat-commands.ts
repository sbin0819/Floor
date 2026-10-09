import type { FloorPlanDocument, PlanPoint } from "@/lib/floor-plan/types";
import {
  addShapeCommand,
  groupCommands,
  replaceShapesCommand,
  type Command,
  type EditableShape,
} from "./commands";

export function setSeatCommand(
  document: FloorPlanDocument,
  id: string,
  patch: { label?: string; rotation?: number; size?: [number, number] },
): Command | null {
  const seat = document.seats.find((value) => value.id === id);
  if (!seat) return null;
  if (
    patch.rotation !== undefined &&
    ![0, 90, 180, 270].includes(patch.rotation)
  )
    return null;
  if (
    patch.size &&
    !patch.size.every(
      (value) => Number.isInteger(value) && value >= 400 && value <= 3000,
    )
  )
    return null;
  const next = { ...seat, ...patch };
  if (patch.label !== undefined) {
    const label = patch.label.trim();
    if (!label) delete next.label;
    else next.label = label;
  }
  return replaceShapesCommand(
    document,
    [{ collection: "seats", shape: next }],
    "좌석 바꾸기",
  );
}

export function rotateSeatsCommand(
  document: FloorPlanDocument,
  ids: readonly string[],
  delta = 90,
): Command | null {
  if (!Number.isInteger(delta) || delta % 90 !== 0) return null;
  const selected = new Set(ids);
  const values: EditableShape[] = document.seats
    .filter(({ id }) => selected.has(id))
    .map((shape) => ({
      collection: "seats",
      shape: {
        ...shape,
        rotation: (((shape.rotation + delta) % 360) + 360) % 360,
      },
    }));
  return replaceShapesCommand(document, values, "좌석 돌리기");
}

export function duplicateEditableShapesCommand(
  document: FloorPlanDocument,
  ids: readonly string[],
  createId: () => string,
): Command | null {
  const selected = new Set(ids);
  const values: EditableShape[] = [
    ...document.fixtures
      .filter(({ id }) => selected.has(id))
      .map((shape): EditableShape => ({ collection: "fixtures", shape })),
    ...document.seats
      .filter(({ id }) => selected.has(id))
      .map((shape): EditableShape => ({ collection: "seats", shape })),
  ];
  const commands: Command[] = [];
  let current = document;
  for (const value of values) {
    const point = ([x, y]: PlanPoint): PlanPoint => [x + 100, y + 100];
    let next: EditableShape;
    if (value.collection === "seats") {
      const shape = {
        ...value.shape,
        id: createId(),
        spaceId: createId(),
        at: point(value.shape.at),
      };
      delete shape.label;
      next = { collection: "seats", shape };
    } else if (value.collection === "fixtures") {
      next = {
        collection: "fixtures",
        shape: {
          ...value.shape,
          id: createId(),
          polygon: value.shape.polygon.map(point),
        },
      };
    } else continue;
    const command = addShapeCommand(current, next);
    if (!command) return null;
    commands.push(command);
    current = command.apply(current);
  }
  return groupCommands("좌석과 고정물 복제", commands);
}

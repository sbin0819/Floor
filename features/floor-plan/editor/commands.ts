import { floorPlanSchema } from "@/lib/floor-plan/schema";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";

export type Command = {
  label: string;
  apply(document: FloorPlanDocument): FloorPlanDocument;
  revert(document: FloorPlanDocument): FloorPlanDocument;
};
export type SpaceShape = FloorPlanDocument["spaces"][number];
export type FixtureShape = FloorPlanDocument["fixtures"][number];
export type EditableShape =
  | { collection: "spaces"; shape: SpaceShape }
  | { collection: "fixtures"; shape: FixtureShape };

type Change = {
  collection: EditableShape["collection"];
  index: number;
  before: SpaceShape | FixtureShape | null;
  after: SpaceShape | FixtureShape | null;
};

function applyChanges(
  document: FloorPlanDocument,
  changes: readonly Change[],
  reverse: boolean,
): FloorPlanDocument {
  let result = document;
  for (const collection of ["spaces", "fixtures"] as const) {
    const patches = changes.filter(
      (change) => change.collection === collection,
    );
    if (!patches.length) continue;
    const shapes: (SpaceShape | FixtureShape)[] = [...document[collection]];
    // 삭제를 모두 마친 뒤 원래 순서대로 삽입해야 다중 삭제의 인덱스가 어긋나지 않아요.
    const removing = new Set(
      patches.map((patch) => (reverse ? patch.after : patch.before)?.id),
    );
    const next = shapes.filter((shape) => !removing.has(shape.id));
    for (const patch of [...patches].sort((a, b) => a.index - b.index)) {
      const value = reverse ? patch.before : patch.after;
      if (value) next.splice(patch.index, 0, value);
    }
    result = { ...result, [collection]: next };
  }
  return result;
}

function changedCommand(
  document: FloorPlanDocument,
  changes: readonly Change[],
  label: string,
): Command | null {
  if (!changes.length) return null;
  if (
    !floorPlanSchema.safeParse(applyChanges(document, changes, false)).success
  )
    return null;
  return {
    label,
    apply: (value) => applyChanges(value, changes, false),
    revert: (value) => applyChanges(value, changes, true),
  };
}

export function addShapeCommand(
  document: FloorPlanDocument,
  value: EditableShape,
  label = "도형 추가",
): Command | null {
  return changedCommand(
    document,
    [
      {
        collection: value.collection,
        index: document[value.collection].length,
        before: null,
        after: value.shape,
      },
    ],
    label,
  );
}

export function deleteShapesCommand(
  document: FloorPlanDocument,
  ids: readonly string[],
): Command | null {
  const selected = new Set(ids);
  const changes: Change[] = [];
  for (const collection of ["spaces", "fixtures"] as const) {
    document[collection].forEach((shape, index) => {
      if (selected.has(shape.id))
        changes.push({ collection, index, before: shape, after: null });
    });
  }
  return changedCommand(document, changes, "도형 삭제");
}

export function replaceShapesCommand(
  document: FloorPlanDocument,
  values: readonly EditableShape[],
  label: string,
): Command | null {
  const changes: Change[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.shape.id)) return null;
    seen.add(value.shape.id);
    const index = document[value.collection].findIndex(
      (shape) => shape.id === value.shape.id,
    );
    const before = document[value.collection][index];
    if (!before) return null;
    if (JSON.stringify(before) !== JSON.stringify(value.shape))
      changes.push({
        collection: value.collection,
        index,
        before,
        after: value.shape,
      });
  }
  return changedCommand(document, changes, label);
}

export function groupCommands(
  label: string,
  commands: readonly Command[],
): Command | null {
  if (!commands.length) return null;
  return {
    label,
    apply: (document) =>
      commands.reduce((value, command) => command.apply(value), document),
    revert: (document) =>
      [...commands]
        .reverse()
        .reduce((value, command) => command.revert(value), document),
  };
}

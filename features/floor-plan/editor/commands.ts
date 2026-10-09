import { floorPlanSchema } from "@/lib/floor-plan/schema";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";

export type Command = {
  label: string;
  apply(document: FloorPlanDocument): FloorPlanDocument;
  revert(document: FloorPlanDocument): FloorPlanDocument;
};
export type SpaceShape = FloorPlanDocument["spaces"][number];
export type FixtureShape = FloorPlanDocument["fixtures"][number];
export type SeatShape = FloorPlanDocument["seats"][number];
export type WallShape = FloorPlanDocument["walls"][number];
export type OpeningShape = FloorPlanDocument["openings"][number];
export type EditableShape =
  | { collection: "spaces"; shape: SpaceShape }
  | { collection: "fixtures"; shape: FixtureShape }
  | { collection: "seats"; shape: SeatShape }
  | { collection: "walls"; shape: WallShape }
  | { collection: "openings"; shape: OpeningShape };
const collections = [
  "spaces",
  "fixtures",
  "seats",
  "walls",
  "openings",
] as const;

type Change = {
  collection: EditableShape["collection"];
  index: number;
  nextIndex?: number;
  before: EditableShape["shape"] | null;
  after: EditableShape["shape"] | null;
};

function applyChanges(
  document: FloorPlanDocument,
  changes: readonly Change[],
  reverse: boolean,
): FloorPlanDocument {
  let result = document;
  for (const collection of collections) {
    const patches = changes.filter(
      (change) => change.collection === collection,
    );
    if (!patches.length) continue;
    const shapes: EditableShape["shape"][] = [...document[collection]];
    // 삭제를 모두 마친 뒤 원래 순서대로 삽입해야 다중 삭제의 인덱스가 어긋나지 않아요.
    const removing = new Set(
      patches.map((patch) => (reverse ? patch.after : patch.before)?.id),
    );
    const next = shapes.filter((shape) => !removing.has(shape.id));
    const position = (patch: Change) =>
      reverse ? patch.index : (patch.nextIndex ?? patch.index);
    for (const patch of [...patches].sort(
      (a, b) => position(a) - position(b),
    )) {
      const value = reverse ? patch.before : patch.after;
      if (value) next.splice(position(patch), 0, value);
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
  return patchShapesCommand(document, { removeIds: ids }, "도형 삭제");
}

export function patchShapesCommand(
  document: FloorPlanDocument,
  patch: {
    add?: readonly EditableShape[];
    replace?: readonly EditableShape[];
    removeIds?: readonly string[];
  },
  label: string,
): Command | null {
  const selected = new Set(patch.removeIds ?? []);
  for (const opening of document.openings)
    if (selected.has(opening.wallId)) selected.add(opening.id);
  const changes: Change[] = [];
  for (const collection of collections) {
    document[collection].forEach((shape, index) => {
      if (selected.has(shape.id))
        changes.push({ collection, index, before: shape, after: null });
    });
  }
  const seen = new Set<string>();
  for (const value of patch.replace ?? []) {
    if (seen.has(value.shape.id) || selected.has(value.shape.id)) return null;
    seen.add(value.shape.id);
    const index = document[value.collection].findIndex(
      ({ id }) => id === value.shape.id,
    );
    const before = document[value.collection][index];
    if (!before) return null;
    if (JSON.stringify(before) !== JSON.stringify(value.shape))
      changes.push({
        collection: value.collection,
        index,
        nextIndex:
          index -
          document[value.collection]
            .slice(0, index)
            .filter(({ id }) => selected.has(id)).length,
        before,
        after: value.shape,
      });
  }
  const added = new Map<EditableShape["collection"], number>();
  for (const value of patch.add ?? []) {
    if (seen.has(value.shape.id) || selected.has(value.shape.id)) return null;
    seen.add(value.shape.id);
    const count = added.get(value.collection) ?? 0;
    const index =
      document[value.collection].filter(({ id }) => !selected.has(id)).length +
      count;
    changes.push({
      collection: value.collection,
      index,
      before: null,
      after: value.shape,
    });
    added.set(value.collection, count + 1);
  }
  return changedCommand(document, changes, label);
}

export function replaceSeatsCommand(
  document: FloorPlanDocument,
  seats: readonly SeatShape[],
  label: string,
): Command | null {
  if (new Set(seats.map(({ id }) => id)).size !== seats.length) return null;
  const before = new Map(
    document.seats.map((shape, index) => [shape.id, { shape, index }]),
  );
  const after = new Map(
    seats.map((shape, index) => [shape.id, { shape, index }]),
  );
  const oldOrder = document.seats.filter(({ id }) => after.has(id));
  const nextOrder = seats.filter(({ id }) => before.has(id));
  const moved = new Set(
    oldOrder
      .filter((shape, index) => nextOrder[index]?.id !== shape.id)
      .map(({ id }) => id),
  );
  const changes: Change[] = [];
  for (const [id, old] of before) {
    const next = after.get(id);
    if (
      !next ||
      JSON.stringify(old.shape) !== JSON.stringify(next.shape) ||
      moved.has(id)
    )
      changes.push({
        collection: "seats",
        index: old.index,
        nextIndex: next?.index,
        before: old.shape,
        after: next?.shape ?? null,
      });
  }
  for (const [id, next] of after) {
    if (!before.has(id))
      changes.push({
        collection: "seats",
        index: next.index,
        before: null,
        after: next.shape,
      });
  }
  return changedCommand(document, changes, label);
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

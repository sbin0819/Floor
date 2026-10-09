import { createSeatAreaResolver, seatDisplayName } from "./seats";
import type { FloorPlanDocument } from "./types";
import type { PlanContext } from "./validate";

export type SeatDiff = {
  created: { id: string; shapeId: string; name: string; parentId: string }[];
  updated: {
    id: string;
    name: string;
    parentId: string;
    previousName: string;
    previousParentId: string | null;
  }[];
  archived: { id: string; name: string; parentId: string | null }[];
  firstSeatAreaIds: string[];
  occupiedAreaIds: string[];
};

// 게시 검증 뒤 호출한다. 예약·잠금·행 쓰기는 이 차이를 사용하는 서버가 맡는다.
export function diffSeats(
  document: FloorPlanDocument,
  context: Pick<PlanContext, "floorId" | "spaces">,
): SeatDiff | null {
  const rows = new Map(
    context.spaces.map((row) => [row.id.toLowerCase(), row]),
  );
  const onFloor = (floorId: string) =>
    floorId.toLowerCase() === context.floorId.toLowerCase();
  const previous = context.spaces.filter(
    (row) => onFloor(row.floorId) && row.type === "desk" && !row.archived,
  );
  const previousAreas = new Set(
    previous.flatMap((row) =>
      row.parentId ? [row.parentId.toLowerCase()] : [],
    ),
  );
  const areaOf = createSeatAreaResolver(document, context);
  const present = new Set<string>();
  const occupied = new Map<string, string>();
  const result: SeatDiff = {
    created: [],
    updated: [],
    archived: [],
    firstSeatAreaIds: [],
    occupiedAreaIds: [],
  };
  for (const seat of document.seats) {
    const id = seat.spaceId.toLowerCase();
    if (present.has(id)) return null;
    present.add(id);
    const row = rows.get(id);
    if (row && (!onFloor(row.floorId) || row.type !== "desk" || row.archived))
      return null;
    const name = seatDisplayName(seat, row);
    const area = areaOf(seat);
    if (name === null || !area) return null;
    occupied.set(area.id.toLowerCase(), area.id);
    if (!row)
      result.created.push({ id, shapeId: seat.id, name, parentId: area.id });
    else if (
      row.name !== name ||
      row.parentId?.toLowerCase() !== area.id.toLowerCase()
    ) {
      result.updated.push({
        id: row.id,
        name,
        parentId: area.id,
        previousName: row.name,
        previousParentId: row.parentId,
      });
    }
  }
  result.archived = previous
    .filter((row) => !present.has(row.id.toLowerCase()))
    .map(({ id, name, parentId }) => ({ id, name, parentId }));
  result.occupiedAreaIds = [...occupied.values()].sort();
  result.firstSeatAreaIds = result.occupiedAreaIds.filter(
    (id) => !previousAreas.has(id.toLowerCase()),
  );
  return result;
}

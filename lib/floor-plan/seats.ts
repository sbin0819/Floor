import RBush from "rbush";
import { isSimplePolygon, pointInPolygonStrict } from "./geometry";
import { seatLabelSchema } from "./schema";
import type { FloorPlanDocument, PlanSeat } from "./types";
import type { PlanContext } from "./validate";

type Space = PlanContext["spaces"][number];
type SeatContext = Pick<PlanContext, "floorId" | "spaces">;

export function seatDisplayName(
  seat: Pick<PlanSeat, "label">,
  row?: Pick<Space, "name"> | null,
): string | null {
  return seat.label ?? row?.name ?? null;
}

export function hydrateSeatLabels(
  document: FloorPlanDocument,
  spaces: readonly Pick<Space, "id" | "name">[],
): FloorPlanDocument {
  const rows = new Map(spaces.map((row) => [row.id.toLowerCase(), row]));
  let changed = false;
  const seats = document.seats.map((seat) => {
    if (seat.label !== undefined) return seat;
    const label = seatLabelSchema.safeParse(
      rows.get(seat.spaceId.toLowerCase())?.name,
    );
    if (!label.success) return seat;
    changed = true;
    return { ...seat, label: label.data };
  });
  return changed ? { ...document, seats } : document;
}

export function createSeatAreaResolver(
  document: FloorPlanDocument,
  context: SeatContext,
): (seat: Pick<PlanSeat, "at">) => Space | null {
  const rows = new Map(
    context.spaces.map((row) => [row.id.toLowerCase(), row]),
  );
  const areas = document.spaces.flatMap((shape) => {
    const row = rows.get(shape.spaceId.toLowerCase());
    if (
      !row ||
      row.floorId.toLowerCase() !== context.floorId.toLowerCase() ||
      row.archived ||
      row.type !== "desk_area" ||
      !isSimplePolygon(shape.polygon)
    )
      return [];
    return [
      {
        row,
        polygon: shape.polygon,
        minX: Math.min(...shape.polygon.map(([x]) => x)),
        maxX: Math.max(...shape.polygon.map(([x]) => x)),
        minY: Math.min(...shape.polygon.map(([, y]) => y)),
        maxY: Math.max(...shape.polygon.map(([, y]) => y)),
      },
    ];
  });
  const index = new RBush<(typeof areas)[number]>().load(areas);
  return ({ at: [x, y] }) => {
    let found: Space | null = null;
    for (const area of index.search({ minX: x, maxX: x, minY: y, maxY: y })) {
      if (!pointInPolygonStrict([x, y], area.polygon)) continue;
      if (found) return null;
      found = area.row;
    }
    return found;
  };
}

export function seatAreaOf(
  seat: Pick<PlanSeat, "at">,
  document: FloorPlanDocument,
  context: SeatContext,
): Space | null {
  return createSeatAreaResolver(document, context)(seat);
}

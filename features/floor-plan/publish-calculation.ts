import { ActionError } from "@/lib/actions/result";
import { isBlockingPlanIssue, type PlanIssue } from "@/lib/floor-plan/issues";
import { floorPlanSchema } from "@/lib/floor-plan/schema";
import { diffSeats, type SeatDiff } from "@/lib/floor-plan/seat-diff";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";
import { validatePlan, type PlanContext } from "@/lib/floor-plan/validate";

export function calculatePlanPublication(
  document: FloorPlanDocument,
  context: PlanContext,
) {
  const parsed = floorPlanSchema.safeParse(document);
  if (!parsed.success) throw new ActionError("PLAN_INVALID");
  const issues = validatePlan(parsed.data, context);
  const diff = diffSeats(parsed.data, context);
  if (!diff && !issues.some(isBlockingPlanIssue))
    throw new ActionError("PLAN_INVALID");
  return { document: parsed.data, issues, diff };
}
export function blockingPlanSpaceIds(diff: SeatDiff, context: PlanContext) {
  const occupied = new Set(diff.occupiedAreaIds);
  return [
    ...new Set([
      ...diff.archived.map((seat) => seat.id),
      ...diff.firstSeatAreaIds,
      ...context.spaces
        .filter((space) => space.bookable && occupied.has(space.id))
        .map((space) => space.id),
    ]),
  ].sort();
}
export function bookingPlanIssues(
  diff: SeatDiff,
  bookings: readonly { spaceId: string }[],
  context: PlanContext,
): PlanIssue[] {
  const occupied = new Set(bookings.map((booking) => booking.spaceId));
  const removed = new Set(diff.archived.map((seat) => seat.id));
  return blockingPlanSpaceIds(diff, context)
    .filter((id) => occupied.has(id))
    .map((id) => ({
      code: removed.has(id)
        ? "SEAT_REMOVED_WITH_BOOKINGS"
        : "AREA_HAS_BOOKINGS",
      message: `${context.spaces.find((space) => space.id === id)?.name ?? "공간"}: 앞으로의 확정 예약이 남아 있어요.`,
    }));
}
export function changedPlanShapes(
  document: FloorPlanDocument,
  published: FloorPlanDocument | null,
) {
  const shapeValue = (shape: FloorPlanDocument["spaces"][number]) =>
    JSON.stringify([
      shape.spaceId.toLowerCase(),
      shape.polygon,
      shape.label.at,
    ]);
  const old = new Map(
    (published?.spaces ?? []).map((shape) => [shape.id, shapeValue(shape)]),
  );
  let count = 0;
  for (const shape of document.spaces) {
    if (old.get(shape.id) !== shapeValue(shape)) count++;
    old.delete(shape.id);
  }
  return count + old.size;
}

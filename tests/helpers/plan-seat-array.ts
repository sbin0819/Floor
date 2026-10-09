import raw from "@/docs/spec/examples/gangnam-7f.plan.json";
import rows from "@/docs/spec/examples/gangnam-7f.spaces.json";
import { floorPlanSchema } from "@/lib/floor-plan/schema";
import { hydrateSeatLabels } from "@/lib/floor-plan/seats";

export const seatAreaId = "sh_desks";
export const seatRows = rows.spaces;
export function seatDocument(hydrate = true) {
  const document = floorPlanSchema.parse(raw);
  return hydrate ? hydrateSeatLabels(document, seatRows) : document;
}
export function seatUuid(index: number) {
  return `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

import { z } from "zod";
import { floorPlanSchema } from "@/lib/floor-plan/schema";

const id = z.uuid().transform((value) => value.toLowerCase());
export const planEditorSchema = z.strictObject({
  branchId: id,
  floorId: id,
});
export const saveFloorPlanDraftSchema = z.strictObject({
  floorId: id,
  basePlanId: id.nullable(),
  revision: z.int().min(0).max(2_147_483_646).nullable(),
  document: floorPlanSchema,
});
export type PlanEditorInput = z.infer<typeof planEditorSchema>;
export type SaveFloorPlanDraftInput = z.infer<typeof saveFloorPlanDraftSchema>;

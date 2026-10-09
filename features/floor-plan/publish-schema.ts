import { z } from "zod";

const id = z.uuid().transform((value) => value.toLowerCase());
const revision = z.number().int().min(0).max(2_147_483_646);
export const publishFloorPlanSchema = z.strictObject({
  floorId: id,
  expectedDraftId: id,
  revision,
});
export const previewPublishFloorPlanSchema = publishFloorPlanSchema.extend({
  branchId: id,
});
export const planVersionsSchema = z.strictObject({ branchId: id, floorId: id });
export const restorePlanVersionSchema = z
  .strictObject({
    floorId: id,
    version: z.number().int().min(1).max(2_147_483_646),
    expectedDraftId: id.nullable(),
    revision: revision.nullable(),
    basePlanId: id.nullable(),
  })
  .refine(
    (value) => (value.expectedDraftId === null) === (value.revision === null),
    {
      path: ["revision"],
      message: "초안과 수정 번호를 함께 보내 주세요.",
    },
  );
export type PreviewPublishFloorPlanInput = z.input<
  typeof previewPublishFloorPlanSchema
>;
export type PlanVersionsInput = z.input<typeof planVersionsSchema>;

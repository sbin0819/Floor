import { z } from "zod";

export const PLAN_BACKGROUND_MAX_BYTES = 3 * 1024 * 1024;
export const PLAN_BACKGROUND_EXPIRY_SECONDS = 300;
const id = z.uuid().transform((value) => value.toLowerCase());
export const createPlanBackgroundUploadSchema = z.strictObject({
  floorId: id,
  expectedDraftId: id,
  size: z.number().int().min(1).max(PLAN_BACKGROUND_MAX_BYTES),
});
export const confirmPlanBackgroundUploadSchema = z.strictObject({
  floorId: id,
  uploadId: id,
});
export type CreatePlanBackgroundUploadResult = {
  uploadId: string;
  planId: string;
  url: string;
};
export type ConfirmPlanBackgroundUploadResult = {
  uploadId: string;
  planId: string;
  width: number;
  height: number;
};

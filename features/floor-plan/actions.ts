"use server";

import { createPlanEditorActions } from "./editor-action-factory";
import { createPlanPublishActions } from "./publish-action-factory";
import { createPlanBackgroundActions } from "./background-action-factory";

export async function saveFloorPlanDraft(input: unknown) {
  return createPlanEditorActions().saveFloorPlanDraft(input);
}
export async function publishFloorPlan(input: unknown) {
  return createPlanPublishActions().publishFloorPlan(input);
}
export async function restorePlanVersion(input: unknown) {
  return createPlanPublishActions().restorePlanVersion(input);
}
export async function createPlanBackgroundUpload(input: unknown) {
  return createPlanBackgroundActions().createPlanBackgroundUpload(input);
}
export async function confirmPlanBackgroundUpload(input: unknown) {
  return createPlanBackgroundActions().confirmPlanBackgroundUpload(input);
}

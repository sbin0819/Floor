"use server";

import { createPlanEditorActions } from "./editor-action-factory";

export async function saveFloorPlanDraft(input: unknown) {
  return createPlanEditorActions().saveFloorPlanDraft(input);
}

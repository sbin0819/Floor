import { cache } from "react";
import { createFloorPlanQueries } from "./query-factory";
import { createPlanEditorQueries } from "./editor-query-factory";
import type { PlanEditorInput } from "./editor-schema";
import { createPlanPublishQueries } from "./publish-query-factory";
import type {
  PlanVersionsInput,
  PreviewPublishFloorPlanInput,
} from "./publish-schema";

export const getFloorPlanDocument = cache(async (planId: string) =>
  createFloorPlanQueries().getFloorPlanDocument(planId),
);

const readPlanEditor = cache((branchId: string, floorId: string) =>
  createPlanEditorQueries().getPlanEditor({ branchId, floorId }),
);
export function getPlanEditor({ branchId, floorId }: PlanEditorInput) {
  return readPlanEditor(branchId, floorId);
}
const readPublishPreview = cache(
  (
    branchId: string,
    floorId: string,
    expectedDraftId: string,
    revision: number,
  ) =>
    createPlanPublishQueries().previewPublishFloorPlan({
      branchId,
      floorId,
      expectedDraftId,
      revision,
    }),
);
export function previewPublishFloorPlan(input: PreviewPublishFloorPlanInput) {
  return readPublishPreview(
    input.branchId,
    input.floorId,
    input.expectedDraftId,
    input.revision,
  );
}
const readVersions = cache((branchId: string, floorId: string) =>
  createPlanPublishQueries().getPlanVersions({ branchId, floorId }),
);
export function getPlanVersions(input: PlanVersionsInput) {
  return readVersions(input.branchId, input.floorId);
}

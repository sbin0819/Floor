import { cache } from "react";
import { createFloorPlanQueries } from "./query-factory";
import { createPlanEditorQueries } from "./editor-query-factory";
import type { PlanEditorInput } from "./editor-schema";

export const getFloorPlanDocument = cache(async (planId: string) =>
  createFloorPlanQueries().getFloorPlanDocument(planId),
);

const readPlanEditor = cache((branchId: string, floorId: string) =>
  createPlanEditorQueries().getPlanEditor({ branchId, floorId }),
);
export function getPlanEditor({ branchId, floorId }: PlanEditorInput) {
  return readPlanEditor(branchId, floorId);
}

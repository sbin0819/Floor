import { cache } from "react";
import { createFloorPlanQueries } from "./query-factory";

export const getFloorPlanDocument = cache(async (planId: string) =>
  createFloorPlanQueries().getFloorPlanDocument(planId),
);

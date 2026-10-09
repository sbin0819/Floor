import { z } from "zod";
import { ActionError } from "@/lib/actions/result";
import { requireSession } from "@/lib/auth/session";
import type { Session } from "@/lib/auth/types";
import type { DalDatabase } from "@/lib/dal/database";
import { getFloorPlanWithAccess } from "@/lib/dal/floor-plans";
import { floorPlanSchema } from "@/lib/floor-plan/schema";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";
import { can } from "@/lib/permissions/can";
import { canAccessFloor } from "@/lib/permissions/can-access";
import { loadPermissionContext } from "@/lib/permissions/context";

export type FloorPlanQueryDependencies = {
  database?: DalDatabase;
  requireSession?: () => Promise<Session>;
  now?: () => Date;
  adminFilesEnabled?: () => boolean;
};

export function createFloorPlanQueries(
  dependencies: FloorPlanQueryDependencies = {},
) {
  const db = dependencies.database;
  const session = dependencies.requireSession ?? requireSession;
  return {
    async getFloorPlanDocument(planId: string): Promise<FloorPlanDocument> {
      const actor = await session();
      const id = z.uuid().safeParse(planId);
      if (!id.success) throw new ActionError("NOT_FOUND");
      const row = await getFloorPlanWithAccess(id.data.toLowerCase(), db);
      if (!row) throw new ActionError("NOT_FOUND");
      const context = await loadPermissionContext(actor, row.branchId, db);
      if (
        !can(context, "floor.view", { branchId: row.branchId }) ||
        !canAccessFloor(context, row)
      )
        throw new ActionError("NOT_FOUND");
      return floorPlanSchema.parse(row.document);
    },
  };
}

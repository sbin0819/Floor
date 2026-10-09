import { z } from "zod";
import { ActionError } from "@/lib/actions/result";
import { requireSession } from "@/lib/auth/session";
import { getBranch } from "@/lib/dal/branches";
import {
  getPlanEditorFloor,
  listAdminPlanFloors,
  listPlanEditorSources,
  listPlanEditorSpaces,
} from "@/lib/dal/floor-plan-editor";
import { can } from "@/lib/permissions/can";
import { loadPermissionContext } from "@/lib/permissions/context";
import type { PermissionContext } from "@/lib/permissions/types";
import type { FloorPlanQueryDependencies } from "./query-factory";
import { planEditorSchema, type PlanEditorInput } from "./editor-schema";
import type { AdminPlansData, PlanEditorData } from "./editor-types";

function requireEditor(context: PermissionContext, branchId: string) {
  if (!context.staffBranchIds.includes(branchId))
    throw new ActionError("NOT_FOUND");
  if (!can(context, "plan.edit", { branchId }))
    throw new ActionError("FORBIDDEN");
}
export function createPlanEditorQueries(
  dependencies: FloorPlanQueryDependencies = {},
) {
  const db = dependencies.database;
  const readSession = dependencies.requireSession ?? requireSession;
  return {
    async getPlanEditor(input: PlanEditorInput): Promise<PlanEditorData> {
      const session = await readSession();
      const parsed = planEditorSchema.safeParse(input);
      if (!parsed.success) throw new ActionError("NOT_FOUND");
      const { branchId, floorId } = parsed.data;
      const [floor, context] = await Promise.all([
        getPlanEditorFloor(floorId, db),
        loadPermissionContext(session, branchId, db),
      ]);
      if (!floor || floor.branchId !== branchId)
        throw new ActionError("NOT_FOUND");
      requireEditor(context, floor.branchId);
      const [sources, spaces] = await Promise.all([
        listPlanEditorSources(floorId, session.userId, db),
        listPlanEditorSpaces(floorId, session.userId, db),
      ]);
      const draft = sources.find((row) => row.status === "draft");
      const published = sources.find((row) => row.status === "published");
      return {
        branch: {
          id: floor.branchId,
          name: floor.branchName,
          timezone: floor.timezone,
        },
        floor: {
          id: floor.id,
          name: floor.name,
          access: floor.access,
          allowedTeamIds: floor.allowedTeamIds,
        },
        draft: draft
          ? {
              planId: draft.planId,
              version: draft.version,
              revision: draft.revision,
              document: draft.document,
              updatedAt: draft.updatedAt?.toISOString() ?? null,
              updatedByName: draft.updatedByName,
            }
          : null,
        published: published
          ? {
              planId: published.planId,
              version: published.version,
              document: published.document,
            }
          : null,
        spaces,
        canManageSpaces: can(context, "space.manage", { branchId }),
      };
    },
    async getAdminPlans(input: string): Promise<AdminPlansData> {
      const session = await readSession();
      const parsed = z.uuid().safeParse(input);
      if (!parsed.success) throw new ActionError("NOT_FOUND");
      const branchId = parsed.data.toLowerCase();
      const [branch, context] = await Promise.all([
        getBranch(branchId, db),
        loadPermissionContext(session, branchId, db),
      ]);
      if (!branch) throw new ActionError("NOT_FOUND");
      requireEditor(context, branch.id);
      const rows = await listAdminPlanFloors(branchId, session.userId, db);
      return {
        branch: { id: branch.id, name: branch.name, timezone: branch.timezone },
        floors: rows.map((row) => ({
          id: row.id,
          name: row.name,
          published: row.published
            ? {
                ...row.published,
                publishedAt: row.published.publishedAt?.toISOString() ?? null,
              }
            : null,
          draft:
            row.draft.planId !== null && row.draft.version !== null
              ? {
                  planId: row.draft.planId,
                  version: row.draft.version,
                  updatedByName: row.draft.updatedByName,
                  updatedAt: row.draft.updatedAt?.toISOString() ?? null,
                }
              : null,
        })),
      };
    },
  };
}

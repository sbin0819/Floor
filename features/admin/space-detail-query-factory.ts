import { z } from "zod";
import { ActionError } from "@/lib/actions/result";
import { requireSession } from "@/lib/auth/session";
import {
  readAdminSpaceDetail,
  readAdminSpaceIdentity,
} from "@/lib/dal/admin-space-read";
import { searchTeams } from "@/lib/dal/teams-read";
import { can } from "@/lib/permissions/can";
import { loadPermissionContext } from "@/lib/permissions/context";
import { adminFilesEnabled } from "@/lib/storage/r2";
import { normalizeTeamName } from "@/lib/teams/normalize";
import type { AdminQueryDependencies } from "./query-factory";
import type {
  AdminSpaceDetailData,
  AdminSpaceDetailOptions,
} from "./space-detail-types";

function validId(value: string) {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new ActionError("NOT_FOUND");
  return parsed.data.toLowerCase();
}
export function createAdminSpaceQueries(
  dependencies: AdminQueryDependencies & { filesEnabled?: boolean } = {},
) {
  return {
    async getAdminSpace(
      branchId: string,
      floorId: string,
      spaceId: string,
      options: AdminSpaceDetailOptions = {},
    ): Promise<AdminSpaceDetailData> {
      const session = await (dependencies.requireSession ?? requireSession)();
      const scope = {
        branchId: validId(branchId),
        floorId: validId(floorId),
        spaceId: validId(spaceId),
        userId: session.userId,
      };
      const db = dependencies.database;
      const [identity, context] = await Promise.all([
        readAdminSpaceIdentity(scope, db),
        loadPermissionContext(session, scope.branchId, db),
      ]);
      if (!identity || !context.staffBranchIds.includes(identity.branchId))
        throw new ActionError("NOT_FOUND");
      const target = { branchId: identity.branchId };
      const permissions = {
        manageSpaces: can(context, "space.manage", target),
        editAccess: can(context, "plan.edit", target),
      };
      if (!permissions.manageSpaces && !permissions.editAccess)
        throw new ActionError("FORBIDDEN");
      const query = normalizeTeamName(
        options.tab === "access" && typeof options.team === "string"
          ? options.team
          : "",
      );
      const valid =
        query.length >= 2 && query.length <= 40 && !query.includes("\0");
      const [row, results] = await Promise.all([
        readAdminSpaceDetail(scope, db),
        valid ? searchTeams(query, db) : [],
      ]);
      if (!row || row.space.type === "desk") throw new ActionError("NOT_FOUND");
      return {
        branch: row.branch,
        floor: { ...row.floor, allowedTeams: row.floorTeams },
        space: {
          ...row.space,
          type: row.space.type,
          archivedAt: row.space.archivedAt?.toISOString() ?? null,
          allowedTeams: row.spaceTeams,
          deskCount: row.deskCount,
        },
        permissions,
        teamSearch: { query, valid, results },
        photos: row.photos,
        filesEnabled: dependencies.filesEnabled ?? adminFilesEnabled(),
      };
    },
  };
}

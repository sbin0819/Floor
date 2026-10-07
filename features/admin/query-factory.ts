import { z } from "zod";
import { ActionError } from "@/lib/actions/result";
import { requireSession } from "@/lib/auth/session";
import type { Session } from "@/lib/auth/types";
import type { DalDatabase } from "@/lib/dal";
import { getTeamsByIds, listAdminSpaces } from "@/lib/dal/admin";
import {
  getBranch,
  getFloorWithAccess,
  listFloorsWithAccess,
} from "@/lib/dal/branches";
import { getDeskCounts } from "@/lib/dal/spaces";
import { searchTeams } from "@/lib/dal/teams-read";
import { can } from "@/lib/permissions/can";
import { loadPermissionContext } from "@/lib/permissions/context";
import type { PermissionContext } from "@/lib/permissions/types";
import { normalizeTeamName } from "@/lib/teams/normalize";
import type {
  AdminBranchData,
  AdminFloorData,
  AdminPermissions,
  AdminSpace,
} from "./types";

export type AdminQueryDependencies = {
  database?: DalDatabase;
  requireSession?: () => Promise<Session>;
};
function validId(value: string): string {
  if (!z.uuid().safeParse(value).success) throw new ActionError("NOT_FOUND");
  return value.toLowerCase();
}
function permissions(
  context: PermissionContext,
  branchId: string,
): AdminPermissions {
  return {
    manageSpaces: can(context, "space.manage", { branchId }),
    editAccess: can(context, "plan.edit", { branchId }),
  };
}

export function createAdminQueries(dependencies: AdminQueryDependencies = {}) {
  const db = dependencies.database;
  const readSession = dependencies.requireSession ?? requireSession;
  async function checkedBranch(session: Session, branchId: string) {
    const branch = await getBranch(branchId, db);
    if (!branch) throw new ActionError("NOT_FOUND");
    const context = await loadPermissionContext(session, branch.id, db);
    if (!context.staffBranchIds.includes(branch.id))
      throw new ActionError("NOT_FOUND");
    return {
      branch: {
        id: branch.id,
        name: branch.name,
        address: branch.address,
        timezone: branch.timezone,
        openHours: branch.openHours,
      },
      permissions: permissions(context, branch.id),
    };
  }
  return {
    async getAdminBranch(branchId: string): Promise<AdminBranchData> {
      const session = await readSession();
      const data = await checkedBranch(session, validId(branchId));
      const floors = await listFloorsWithAccess(data.branch.id, db);
      return {
        ...data,
        floors: await Promise.all(
          floors.map(async (floor) => ({
            id: floor.id,
            name: floor.name,
            level: floor.level,
            sortOrder: floor.sortOrder,
            access: floor.access,
            spaceCount: (await listAdminSpaces({ floorId: floor.id }, db))
              .length,
          })),
        ),
      };
    },
    async getAdminFloor(
      branchId: string,
      floorId: string,
      teamQuery?: unknown,
    ): Promise<AdminFloorData> {
      const session = await readSession();
      const expectedBranch = validId(branchId);
      const floor = await getFloorWithAccess(validId(floorId), db);
      if (!floor || floor.branchId !== expectedBranch)
        throw new ActionError("NOT_FOUND");
      const data = await checkedBranch(session, floor.branchId);
      const rows = await listAdminSpaces(
        { floorId: floor.id, includeArchived: true },
        db,
      );
      const ids = [
        ...new Set([
          ...floor.allowedTeamIds,
          ...rows.flatMap(({ allowedTeamIds }) => allowedTeamIds),
        ]),
      ];
      const teams = await getTeamsByIds(ids, db);
      const desks = await getDeskCounts(
        rows.map(({ id }) => id),
        db,
      );
      const query = normalizeTeamName(
        typeof teamQuery === "string" ? teamQuery : "",
      );
      const valid =
        query.length >= 2 && query.length <= 40 && !query.includes("\0");
      const spaces: AdminSpace[] = rows.flatMap((row) =>
        row.type === "desk"
          ? []
          : [
              {
                id: row.id,
                floorId: row.floorId,
                name: row.name,
                type: row.type,
                capacity: row.capacity,
                bookable: row.bookable,
                amenities: row.amenities,
                access: row.access,
                archivedAt: row.archivedAt?.toISOString() ?? null,
                allowedTeams: teams.filter(({ id }) =>
                  row.allowedTeamIds.includes(id),
                ),
                deskCount:
                  desks.find(({ parentId }) => parentId === row.id)?.count ?? 0,
              },
            ],
      );
      return {
        ...data,
        floor: {
          id: floor.id,
          name: floor.name,
          level: floor.level,
          sortOrder: floor.sortOrder,
          access: floor.access,
          allowedTeams: teams.filter(({ id }) =>
            floor.allowedTeamIds.includes(id),
          ),
        },
        spaces,
        teamSearch: {
          query,
          valid,
          results: valid ? await searchTeams(query, db) : [],
        },
      };
    },
  };
}

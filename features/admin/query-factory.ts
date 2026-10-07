import { z } from "zod";
import { ActionError } from "@/lib/actions/result";
import { requireSession } from "@/lib/auth/session";
import type { Session } from "@/lib/auth/types";
import type { DalDatabase } from "@/lib/dal";
import {
  countActiveSpacesByFloor,
  getTeamsByIds,
  listAdminSpaceDetails,
} from "@/lib/dal/admin";
import {
  getBranch,
  getFloorWithAccess,
  listFloorsWithAccess,
} from "@/lib/dal/branches";
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
    const [branch, context] = await Promise.all([
      getBranch(branchId, db),
      loadPermissionContext(session, branchId, db),
    ]);
    if (!branch) throw new ActionError("NOT_FOUND");
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
      const [floors, counts] = await Promise.all([
        listFloorsWithAccess(data.branch.id, db),
        countActiveSpacesByFloor(data.branch.id, db),
      ]);
      return {
        ...data,
        floors: floors.map((floor) => ({
          id: floor.id,
          name: floor.name,
          level: floor.level,
          sortOrder: floor.sortOrder,
          access: floor.access,
          spaceCount:
            counts.find(({ floorId }) => floorId === floor.id)?.count ?? 0,
        })),
      };
    },
    async getAdminFloor(
      branchId: string,
      floorId: string,
      teamQuery?: unknown,
    ): Promise<AdminFloorData> {
      const session = await readSession();
      const expectedBranch = validId(branchId);
      const normalizedFloor = validId(floorId);
      const [floor, data] = await Promise.all([
        getFloorWithAccess(normalizedFloor, db),
        checkedBranch(session, expectedBranch),
      ]);
      if (!floor || floor.branchId !== expectedBranch)
        throw new ActionError("NOT_FOUND");
      const query = normalizeTeamName(
        typeof teamQuery === "string" ? teamQuery : "",
      );
      const valid =
        query.length >= 2 && query.length <= 40 && !query.includes("\0");
      const [rows, floorTeams, results] = await Promise.all([
        listAdminSpaceDetails(floor.id, db),
        getTeamsByIds(floor.allowedTeamIds, db),
        valid ? searchTeams(query, db) : [],
      ]);
      const spaces: AdminSpace[] = rows.map((row) => ({
        id: row.id,
        floorId: row.floorId,
        name: row.name,
        type: row.type as AdminSpace["type"],
        capacity: row.capacity,
        bookable: row.bookable,
        amenities: row.amenities,
        access: row.access,
        archivedAt: row.archivedAt?.toISOString() ?? null,
        allowedTeams: row.allowedTeams,
        deskCount: row.deskCount,
      }));
      return {
        ...data,
        floor: {
          id: floor.id,
          name: floor.name,
          level: floor.level,
          sortOrder: floor.sortOrder,
          access: floor.access,
          allowedTeams: floorTeams,
        },
        spaces,
        teamSearch: {
          query,
          valid,
          results,
        },
      };
    },
  };
}

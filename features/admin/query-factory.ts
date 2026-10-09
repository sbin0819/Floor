import { z } from "zod";
import { getOperatingState } from "@/features/bookings/operating-state";
import { readBookingNow } from "@/features/bookings/request-clock";
import { ActionError } from "@/lib/actions/result";
import { requireSession } from "@/lib/auth/session";
import type { Session } from "@/lib/auth/types";
import type { DalDatabase } from "@/lib/dal";
import {
  countActiveSpacesByFloor,
  getTeamsByIds,
  listAdminSpaceDetails,
} from "@/lib/dal/admin";
import { listOperatorBranchSummaries } from "@/lib/dal/admin-home";
import {
  getBranch,
  getFloorWithAccess,
  getOperatorBranches,
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
  OperatorBranchCardsData,
} from "./types";

export type AdminQueryDependencies = {
  database?: DalDatabase;
  requireSession?: () => Promise<Session>;
  now?: () => Date;
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
    async getOperatorBranchCards(): Promise<OperatorBranchCardsData> {
      const session = await readSession();
      const assigned = await getOperatorBranches(session.userId, db);
      if (assigned.length === 0) throw new ActionError("FORBIDDEN");
      const now = dependencies.now?.() ?? readBookingNow(db !== undefined);
      // 집계에도 담당자를 JOIN해, 앞선 권한 확인 후 담당이 해제돼도 노출하지 않는다.
      const rows = await listOperatorBranchSummaries(session.userId, db);
      if (rows.length === 0) throw new ActionError("FORBIDDEN");
      return {
        now: now.toISOString(),
        branches: rows.map((row) => ({
          id: row.id,
          name: row.name,
          address: row.address,
          floorCount: row.floorCount,
          spaceCount: row.spaceCount,
          operatingState: getOperatingState(now, row.timezone, row.openHours),
        })),
      };
    },
    async getAdminBranch(branchId: string): Promise<AdminBranchData> {
      const session = await readSession();
      const data = await checkedBranch(session, validId(branchId));
      if (!data.permissions.manageSpaces && !data.permissions.editAccess)
        throw new ActionError("FORBIDDEN");
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
      if (!data.permissions.manageSpaces && !data.permissions.editAccess)
        throw new ActionError("FORBIDDEN");
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

import type {
  FloorForAccess,
  PermissionContext,
  SpaceForAccess,
} from "@/lib/permissions/types";

export type { FloorForAccess, SpaceForAccess } from "@/lib/permissions/types";

export function canAccessFloor(
  ctx: PermissionContext,
  floor: FloorForAccess,
): boolean {
  if (ctx.staffBranchIds.includes(floor.branchId)) return true;
  if (floor.access === "closed") return false;
  if (floor.access === "everyone") return true;
  return ctx.teams.some(({ teamId }) => floor.allowedTeamIds.includes(teamId));
}

export function canAccess(
  ctx: PermissionContext,
  space: SpaceForAccess,
): boolean {
  if (ctx.staffBranchIds.includes(space.floor.branchId)) return true;
  if (space.floor.access === "closed" || space.access === "closed")
    return false;

  const floorTeams =
    space.floor.access === "teams" ? new Set(space.floor.allowedTeamIds) : null;
  const spaceTeams =
    space.access === "teams" ? new Set(space.allowedTeamIds) : null;

  if (floorTeams === null && spaceTeams === null) return true;
  // 서로 다른 두 팀의 소속을 조합해 교집합 밖의 공간에 접근할 수 없게 한다.
  return ctx.teams.some(
    ({ teamId }) =>
      (floorTeams === null || floorTeams.has(teamId)) &&
      (spaceTeams === null || spaceTeams.has(teamId)),
  );
}

import { can } from "@/lib/permissions/can";
import { canAccess } from "@/lib/permissions/can-access";
import type {
  PermissionContext,
  SpaceForAccess,
} from "@/lib/permissions/types";

export function canBookAs(
  context: PermissionContext,
  space: SpaceForAccess,
  teamId: string | null,
): boolean {
  const branchId = space.floor.branchId;
  if (!canAccess(context, space) || !can(context, "floor.view", { branchId }))
    return false;
  if (teamId === null) {
    if (!can(context, "booking.own", { branchId })) return false;
    return (
      context.staffBranchIds.includes(branchId) ||
      (space.floor.access !== "teams" && space.access !== "teams")
    );
  }
  if (
    !context.teams.some((team) => team.teamId === teamId) ||
    !can(context, "booking.team", { branchId, teamId })
  )
    return false;
  if (space.floor.access === "closed" || space.access === "closed")
    return false;
  return (
    (space.floor.access !== "teams" ||
      space.floor.allowedTeamIds.includes(teamId)) &&
    (space.access !== "teams" || space.allowedTeamIds.includes(teamId))
  );
}

export function availableBookingActors(
  context: PermissionContext,
  space: SpaceForAccess,
): (string | null)[] {
  const candidates = [
    null,
    ...new Set(context.teams.map(({ teamId }) => teamId)),
  ];
  return candidates.filter((teamId) => canBookAs(context, space, teamId));
}

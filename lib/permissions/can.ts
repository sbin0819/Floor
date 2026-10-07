import { defaultPermissions } from "@/lib/permissions/defaults";
import type { PermissionKey, Role } from "@/lib/permissions/keys";
import type {
  PermissionContext,
  PermissionTarget,
} from "@/lib/permissions/types";

export type {
  PermissionContext,
  PermissionTarget,
} from "@/lib/permissions/types";

export function heldRoles(
  ctx: PermissionContext,
  target: PermissionTarget,
): Role[] {
  const held: Role[] = ["user"];
  const membership = target.teamId
    ? ctx.teams.find(({ teamId }) => teamId === target.teamId)
    : undefined;

  if (membership) {
    held.push("team_member");
    if (membership.role === "admin") held.push("team_admin");
  }
  if (target.branchId && ctx.staffBranchIds.includes(target.branchId)) {
    held.push("operator");
  }

  return held;
}

export function can(
  ctx: PermissionContext,
  permission: PermissionKey,
  target: PermissionTarget,
): boolean {
  const settings = target.branchId
    ? ctx.roleSettings[target.branchId]
    : undefined;

  return heldRoles(ctx, target).some((role) => {
    if (role === "operator" && permission === "roles.manage") return true;
    return (settings?.[role] ?? defaultPermissions[role]).includes(permission);
  });
}

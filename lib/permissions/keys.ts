export const permissionKeys = [
  "floor.view",
  "booking.own",
  "chat.lounge",
  "booking.team",
  "chat.team",
  "booking.manage_team",
  "chat.team.moderate",
  "team.manage_members",
  "booking.manage_all",
  "branch.announce",
  "space.manage",
  "plan.edit",
  "stats.view",
  "roles.manage",
] as const;

export const roles = ["user", "team_member", "team_admin", "operator"] as const;

export type PermissionKey = (typeof permissionKeys)[number];
export type Role = (typeof roles)[number];

export function isPermissionKey(value: string): value is PermissionKey {
  return permissionKeys.some((permission) => permission === value);
}

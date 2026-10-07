import type { PermissionKey, Role } from "@/lib/permissions/keys";
import type { RoleLimits } from "@/lib/permissions/types";

export const defaultPermissions: Record<Role, readonly PermissionKey[]> = {
  user: ["floor.view", "booking.own", "chat.lounge"],
  team_member: ["booking.team", "chat.team"],
  team_admin: [
    "booking.manage_team",
    "chat.team.moderate",
    "team.manage_members",
  ],
  operator: [
    "booking.manage_all",
    "branch.announce",
    "space.manage",
    "plan.edit",
    "stats.view",
    "roles.manage",
  ],
};

export const defaultLimits = {
  user: {
    maxMinutesPerBooking: 120,
    maxMinutesPerDay: 120,
    maxDaysAhead: 7,
  },
  team_member: {
    maxMinutesPerBooking: 240,
    maxMinutesPerDay: 480,
    maxDaysAhead: 14,
  },
  team_admin: {},
  operator: {
    maxMinutesPerBooking: null,
    maxMinutesPerDay: null,
    maxDaysAhead: null,
  },
} satisfies Record<Role, Partial<RoleLimits>>;

import type { PermissionKey, Role } from "@/lib/permissions/keys";

export type RoleLimits = {
  maxMinutesPerBooking: number | null;
  maxMinutesPerDay: number | null;
  maxDaysAhead: number | null;
};

export type PermissionTarget = { branchId?: string; teamId?: string };

export type PermissionContext = {
  userId: string;
  teams: { teamId: string; role: "admin" | "member" }[];
  staffBranchIds: string[];
  roleSettings: Record<string, Partial<Record<Role, PermissionKey[]>>>;
};

export type AccessScope = "everyone" | "teams" | "closed";

export type FloorForAccess = {
  branchId: string;
  access: AccessScope;
  allowedTeamIds: string[];
};

export type SpaceForAccess = {
  access: AccessScope | null;
  allowedTeamIds: string[];
  floor: FloorForAccess;
};

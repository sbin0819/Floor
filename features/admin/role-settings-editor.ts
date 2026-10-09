import { resolveBookingLimits } from "@/features/bookings/limits";
import { can } from "@/lib/permissions/can";
import { defaultPermissions } from "@/lib/permissions/defaults";
import {
  permissionKeys,
  roles,
  type PermissionKey,
  type Role,
} from "@/lib/permissions/keys";
import type { PermissionContext, RoleLimits } from "@/lib/permissions/types";
import type {
  RoleSettingInput,
  RoleSettingsEditorContext,
  RoleSettingsValues,
} from "./role-settings-types";

export const permissionLabels: Record<PermissionKey, string> = {
  "floor.view": "평면도·공간 보기",
  "booking.own": "개인으로 예약",
  "chat.lounge": "라운지에 쓰기",
  "booking.team": "팀 이름으로 예약",
  "chat.team": "팀 스페이스 쓰기",
  "booking.manage_team": "팀원 예약 바꾸기·취소",
  "chat.team.moderate": "팀 스페이스 메시지 지우기",
  "team.manage_members": "팀원 관리",
  "booking.manage_all": "모든 예약 바꾸기·취소",
  "branch.announce": "공지 보내기, 라운지·신고 관리",
  "space.manage": "공간·점검 관리",
  "plan.edit": "평면도 편집·게시, 이용 대상",
  "stats.view": "대시보드 보기",
  "roles.manage": "역할과 권한 바꾸기",
};

export const roleLabels: Record<Role, string> = {
  user: "일반 사용자",
  team_member: "팀원",
  team_admin: "팀 관리자",
  operator: "운영자",
};

const operatorOnly: readonly PermissionKey[] = [
  "booking.manage_all",
  "branch.announce",
  "space.manage",
  "plan.edit",
  "stats.view",
  "roles.manage",
];
const teamScoped: readonly PermissionKey[] = [
  "chat.team",
  "chat.team.moderate",
  "team.manage_members",
];
const limitKeys = [
  "maxMinutesPerBooking",
  "maxMinutesPerDay",
  "maxDaysAhead",
] as const;

export type PermissionCell = {
  checked: boolean;
  disabled: boolean;
  reason: "operator_required" | "operator_only" | "team_scoped" | null;
};

export function permissionCell(
  role: Role,
  key: PermissionKey,
  permissions: readonly PermissionKey[],
): PermissionCell {
  if (role === "operator" && key === "roles.manage")
    return { checked: true, disabled: true, reason: "operator_required" };
  if (role !== "operator" && operatorOnly.includes(key))
    return { checked: false, disabled: true, reason: "operator_only" };
  if (teamScoped.includes(key))
    return {
      checked: defaultPermissions[role].includes(key),
      disabled: true,
      reason: "team_scoped",
    };
  return { checked: permissions.includes(key), disabled: false, reason: null };
}

export function normalizeRoleSetting(
  input: RoleSettingInput,
): RoleSettingInput {
  return {
    role: input.role,
    permissions: permissionKeys.filter(
      (key) => permissionCell(input.role, key, input.permissions).checked,
    ),
    limits: input.role === "team_admin" ? {} : { ...input.limits },
  };
}

export function permissionsEqual(
  first: readonly PermissionKey[],
  second: readonly PermissionKey[],
): boolean {
  const a = new Set(first);
  const b = new Set(second);
  return a.size === b.size && [...a].every((key) => b.has(key));
}

export function effectiveRoleLimits(
  role: Role,
  limits: Partial<RoleLimits>,
): Partial<RoleLimits> {
  return role === "team_admin" ? {} : resolveBookingLimits(role, limits);
}

function changedCells(
  role: Role,
  before: RoleSettingsValues,
  after: RoleSettingsValues,
) {
  const permissions = permissionKeys.filter((key) => {
    const previous = permissionCell(role, key, before[role].permissions);
    return (
      !previous.disabled &&
      previous.checked !==
        permissionCell(role, key, after[role].permissions).checked
    );
  }).length;
  const previous = effectiveRoleLimits(role, before[role].limits);
  const current = effectiveRoleLimits(role, after[role].limits);
  return (
    permissions +
    limitKeys.filter((key) => previous[key] !== current[key]).length
  );
}

export function countRoleSettingsChanges(
  before: RoleSettingsValues,
  after: RoleSettingsValues,
): number {
  return roles.reduce(
    (count, role) => count + changedCells(role, before, after),
    0,
  );
}

export function changedRoleSettings(
  before: RoleSettingsValues,
  after: RoleSettingsValues,
): RoleSettingInput[] {
  return roles
    .filter((role) => changedCells(role, before, after) > 0)
    .map((role) => normalizeRoleSetting({ role, ...after[role] }));
}

export function applyRoleSettingsChanges(
  before: RoleSettingsValues,
  changes: readonly RoleSettingInput[],
): RoleSettingsValues {
  const after: RoleSettingsValues = {
    user: {
      permissions: [...before.user.permissions],
      limits: { ...before.user.limits },
    },
    team_member: {
      permissions: [...before.team_member.permissions],
      limits: { ...before.team_member.limits },
    },
    team_admin: {
      permissions: [...before.team_admin.permissions],
      limits: { ...before.team_admin.limits },
    },
    operator: {
      permissions: [...before.operator.permissions],
      limits: { ...before.operator.limits },
    },
  };
  for (const change of changes) {
    const value = normalizeRoleSetting(change);
    after[value.role] = {
      permissions: value.permissions,
      limits: value.limits,
    };
  }
  return after;
}

export function lostPermissions(
  before: RoleSettingsValues,
  after: RoleSettingsValues,
  { branchId, isOperator }: RoleSettingsEditorContext,
): PermissionKey[] {
  const context = (settings: RoleSettingsValues): PermissionContext => ({
    userId: "role-settings-editor",
    teams: [],
    staffBranchIds: isOperator ? [branchId] : [],
    roleSettings: {
      [branchId]: {
        user: settings.user.permissions,
        team_member: settings.team_member.permissions,
        team_admin: settings.team_admin.permissions,
        operator: settings.operator.permissions,
      },
    },
  });
  // 저장 전 값을 먼저 정규화하면 과거 행에서 실제로 사라질 권한을 놓친다.
  const previous = context(before);
  const next = context(after);
  return permissionKeys.filter(
    (key) => can(previous, key, { branchId }) && !can(next, key, { branchId }),
  );
}

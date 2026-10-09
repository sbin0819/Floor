import type { RoleSettingsEditorData } from "@/features/admin/role-settings-types";
import { defaultLimits, defaultPermissions } from "@/lib/permissions/defaults";

export const roleSettingsBranchId = "c2000000-0000-4000-8000-000000000001";
export const roleSettingsPath = `/admin/branches/${roleSettingsBranchId}/roles`;
export function roleSettingsFixture(): RoleSettingsEditorData {
  return {
    branch: {
      id: roleSettingsBranchId,
      name: "강남점",
      timezone: "Asia/Seoul",
    },
    roles: {
      user: {
        permissions: [...defaultPermissions.user],
        limits: { ...defaultLimits.user },
        stored: false,
      },
      team_member: {
        permissions: [...defaultPermissions.team_member],
        limits: { ...defaultLimits.team_member },
        stored: false,
      },
      team_admin: {
        permissions: [...defaultPermissions.team_admin],
        limits: {},
        stored: false,
      },
      operator: {
        permissions: [...defaultPermissions.operator],
        limits: { ...defaultLimits.operator },
        stored: false,
      },
    },
    updatedAt: null,
    updatedByName: null,
    context: { branchId: roleSettingsBranchId, isOperator: true },
  };
}

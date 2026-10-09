import type { PermissionKey, Role } from "@/lib/permissions/keys";
import type { RoleLimits } from "@/lib/permissions/types";

export type RoleSettingValue = {
  permissions: PermissionKey[];
  limits: Partial<RoleLimits>;
};

export type RoleSettingInput = RoleSettingValue & { role: Role };
export type RoleSettingsValues = Record<Role, RoleSettingValue>;
export type RoleSettingsEditorContext = {
  branchId: string;
  isOperator: boolean;
};

export type RoleSettingsEditorData = {
  branch: { id: string; name: string; timezone: string };
  roles: Record<Role, RoleSettingValue & { stored: boolean }>;
  updatedAt: string | null;
  updatedByName: string | null;
  context: RoleSettingsEditorContext & { isOperator: true };
};

import { z } from "zod";
import { ActionError } from "@/lib/actions/result";
import { requireSession } from "@/lib/auth/session";
import { listRoleSettingsEditorRows } from "@/lib/dal/role-settings-editor";
import { defaultLimits, defaultPermissions } from "@/lib/permissions/defaults";
import { isPermissionKey, roles } from "@/lib/permissions/keys";
import type { AdminQueryDependencies } from "./query-factory";
import { requireRoleSettingsAccess } from "./role-settings-access";
import type { RoleSettingsEditorData } from "./role-settings-types";

export function createRoleSettingsQueries(
  dependencies: AdminQueryDependencies = {},
) {
  return {
    async getRoleSettingsEditor(
      input: string,
    ): Promise<RoleSettingsEditorData> {
      const session = await (dependencies.requireSession ?? requireSession)();
      const parsed = z.uuid().safeParse(input);
      if (!parsed.success) throw new ActionError("NOT_FOUND");
      const branchId = parsed.data.toLowerCase();
      const branch = await requireRoleSettingsAccess(
        session,
        branchId,
        dependencies.database,
      );
      const rows = await listRoleSettingsEditorRows(
        branchId,
        session.userId,
        dependencies.database,
      );
      const settings = {} as RoleSettingsEditorData["roles"];
      for (const role of roles) {
        const stored = rows.find((row) => row.role === role);
        settings[role] = {
          permissions: stored
            ? stored.permissions.filter(isPermissionKey)
            : [...defaultPermissions[role]],
          limits: { ...(stored?.limits ?? defaultLimits[role]) },
          stored: stored !== undefined,
        };
      }
      return {
        branch,
        roles: settings,
        updatedAt: rows[0]?.updatedAt.toISOString() ?? null,
        updatedByName: rows[0]?.updatedByName ?? null,
        context: { branchId, isOperator: true },
      };
    },
  };
}

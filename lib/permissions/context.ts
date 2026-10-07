import "server-only";

import type { Session } from "@/lib/auth/types";
import {
  getMemberships,
  getRoleSettings,
  type DalDatabase,
  type RoleSettings,
} from "@/lib/dal";
import { roles } from "@/lib/permissions/keys";
import type { PermissionContext } from "@/lib/permissions/types";

export async function loadPermissionContext(
  session: Session,
  branchId?: string,
  database?: DalDatabase,
): Promise<PermissionContext> {
  const [memberships, settings] = await Promise.all([
    getMemberships(session.userId, database),
    branchId
      ? getRoleSettings(branchId, database)
      : Promise.resolve<RoleSettings>({}),
  ]);

  const context: PermissionContext = {
    userId: session.userId,
    ...memberships,
    roleSettings: {},
  };
  if (branchId) {
    const branchSettings: PermissionContext["roleSettings"][string] = {};
    for (const role of roles) {
      const setting = settings[role];
      if (setting) branchSettings[role] = setting.permissions;
    }
    context.roleSettings[branchId] = branchSettings;
  }
  return context;
}

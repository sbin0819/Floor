import "server-only";

import { cache } from "react";
import type { Session } from "@/lib/auth/types";
import {
  getMemberships,
  getRoleSettings,
  type DalDatabase,
  type RoleSettings,
} from "@/lib/dal";
import { roles } from "@/lib/permissions/keys";
import type { PermissionContext } from "@/lib/permissions/types";
import { getRoleSettingsForBranches } from "@/lib/dal/role-settings";

export type PermissionData = {
  context: PermissionContext;
  settings: RoleSettings;
};

async function readPermissionData(
  userId: string,
  branchId?: string,
  database?: DalDatabase,
): Promise<PermissionData> {
  const [memberships, settings] = await Promise.all([
    getMemberships(userId, database),
    branchId
      ? getRoleSettings(branchId, database)
      : Promise.resolve<RoleSettings>({}),
  ]);

  const context: PermissionContext = {
    userId,
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
  return { context, settings };
}

const cachedPermissionData = cache((userId: string, branchId?: string) =>
  readPermissionData(userId, branchId),
);

export function loadPermissionData(
  session: Session,
  branchId?: string,
  database?: DalDatabase,
): Promise<PermissionData> {
  // 주입된 DB는 트랜잭션 안의 최신 상태를 읽어야 하므로 요청 메모를 거치지 않는다.
  return database === undefined
    ? cachedPermissionData(session.userId, branchId)
    : readPermissionData(session.userId, branchId, database);
}

export async function loadPermissionContext(
  session: Session,
  branchId?: string | readonly string[],
  database?: DalDatabase,
): Promise<PermissionContext> {
  if (branchId !== undefined && typeof branchId !== "string") {
    const key = [...new Set(branchId)].sort().join(",");
    return database === undefined
      ? cachedMultiBranchContext(session.userId, key)
      : readMultiBranchContext(session.userId, key, database);
  }
  return (await loadPermissionData(session, branchId, database)).context;
}

async function readMultiBranchContext(
  userId: string,
  key: string,
  database?: DalDatabase,
): Promise<PermissionContext> {
  const [memberships, settings] = await Promise.all([
    getMemberships(userId, database),
    getRoleSettingsForBranches(key ? key.split(",") : [], database),
  ]);
  return { userId, ...memberships, roleSettings: settings };
}
const cachedMultiBranchContext = cache((userId: string, key: string) =>
  readMultiBranchContext(userId, key),
);

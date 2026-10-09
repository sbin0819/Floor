import { ActionError } from "@/lib/actions/result";
import type { Session } from "@/lib/auth/types";
import { getMemberships, type DalDatabase } from "@/lib/dal";
import { getRoleSettingsBranch } from "@/lib/dal/role-settings-editor";
import { can } from "@/lib/permissions/can";

export async function requireRoleSettingsAccess(
  session: Session,
  branchId: string,
  db?: DalDatabase,
) {
  const [branch, memberships] = await Promise.all([
    getRoleSettingsBranch(branchId, db),
    getMemberships(session.userId, db),
  ]);
  if (!branch || !memberships.staffBranchIds.includes(branchId))
    throw new ActionError("NOT_FOUND");
  // roles.manage는 can()이 운영자에게 항상 보장하므로 설정을 다시 읽지 않는다.
  if (
    !can(
      { userId: session.userId, ...memberships, roleSettings: {} },
      "roles.manage",
      { branchId },
    )
  )
    throw new ActionError("FORBIDDEN");
  return branch;
}

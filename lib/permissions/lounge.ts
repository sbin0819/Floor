import { can } from "./can";
import type { PermissionKey, Role } from "./keys";

export type LoungeRoleSettings = Partial<Record<Role, PermissionKey[]>>;

export function loungeAccessFrom({
  isStaff,
  roleSettings,
}: {
  isStaff: boolean;
  roleSettings: LoungeRoleSettings;
}) {
  // 지점의 설정만 주어진 순수 판정이다. 팀 역할은 라운지 권한에 섞이지 않는다.
  const branchId = "lounge";
  const context = {
    userId: "member",
    teams: [],
    staffBranchIds: isStaff ? [branchId] : [],
    roleSettings: { [branchId]: roleSettings },
  };
  return {
    canWrite: can(context, "chat.lounge", { branchId }),
    isAdmin: can(context, "branch.announce", { branchId }),
  };
}

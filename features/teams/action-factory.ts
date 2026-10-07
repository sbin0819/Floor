import type { ActionDependencies } from "@/lib/actions/create-action";
import type { Session } from "@/lib/auth/types";
import type { DalDatabase, TransactionDatabase } from "@/lib/dal";
import { can } from "@/lib/permissions/can";
import { loadPermissionContext } from "@/lib/permissions/context";

export type TeamActionDependencies = Partial<ActionDependencies> & {
  database?: DalDatabase & TransactionDatabase;
};

export async function canManageTeam(
  session: Session,
  teamId: string,
  database?: DalDatabase,
): Promise<boolean> {
  const context = await loadPermissionContext(session, undefined, database);
  // 주 이용 지점은 참고 정보이고 팀 관리 권한에 영향을 주지 않는다.
  return can(context, "team.manage_members", { teamId });
}

export function actionDependencies(
  dependencies: TeamActionDependencies,
): Partial<ActionDependencies> {
  return {
    ...(dependencies.getSession ? { getSession: dependencies.getSession } : {}),
    ...(dependencies.logError ? { logError: dependencies.logError } : {}),
  };
}

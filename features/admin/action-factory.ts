import type { ActionDependencies } from "@/lib/actions/create-action";
import { getPostgresError } from "@/lib/actions/errors";
import { ActionError } from "@/lib/actions/result";
import type { Session } from "@/lib/auth/types";
import type { DalDatabase, TransactionDatabase } from "@/lib/dal";
import { getBranch, getFloorWithAccess } from "@/lib/dal/branches";
import { getSpaceForAccess } from "@/lib/dal/spaces";
import { can } from "@/lib/permissions/can";
import { loadPermissionContext } from "@/lib/permissions/context";
import { floorChannel } from "@/lib/realtime/channels";
import { getRealtimePublisher } from "@/lib/realtime/server";
import type { RealtimePublisher } from "@/lib/realtime/types";

export type AdminDependencies = Partial<ActionDependencies> & {
  database?: DalDatabase & TransactionDatabase;
  now?: () => Date;
  publisher?: Pick<RealtimePublisher, "publish">;
};
export function adminActionDependencies(dependencies: AdminDependencies) {
  return {
    ...(dependencies.getSession ? { getSession: dependencies.getSession } : {}),
    ...(dependencies.logError ? { logError: dependencies.logError } : {}),
  };
}
type AdminPermission = "space.manage" | "plan.edit";
export async function checkAdminBranch(
  session: Session,
  branchId: string,
  permission: AdminPermission,
  database?: DalDatabase,
) {
  const branch = await getBranch(branchId, database);
  if (!branch) throw new ActionError("NOT_FOUND");
  const context = await loadPermissionContext(session, branch.id, database);
  if (!context.staffBranchIds.includes(branch.id))
    throw new ActionError("NOT_FOUND");
  return can(context, permission, { branchId: branch.id });
}
export async function checkAdminFloor(
  session: Session,
  floorId: string,
  permission: AdminPermission,
  database?: DalDatabase,
) {
  const floor = await getFloorWithAccess(floorId, database);
  if (!floor) throw new ActionError("NOT_FOUND");
  return checkAdminBranch(session, floor.branchId, permission, database);
}
export async function checkAdminSpace(
  session: Session,
  spaceId: string,
  permission: AdminPermission,
  database?: DalDatabase,
  allowArchived = true,
) {
  const space = await getSpaceForAccess(spaceId, database);
  if (!space || space.type === "desk" || (!allowArchived && space.archivedAt))
    throw new ActionError("NOT_FOUND");
  return checkAdminBranch(session, space.floor.branchId, permission, database);
}
export function invalidAdminField(field: string, message: string): never {
  throw new ActionError("INVALID_INPUT", {
    fieldErrors: { [field]: [message] },
  });
}
export async function withAdminConstraintErrors<T>(
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const postgres = getPostgresError(error);
    if (postgres?.code === "23505") {
      if (postgres.constraint === "floors_branch_id_level_unique")
        invalidAdminField("level", "이미 있는 층이에요");
      if (postgres.constraint === "spaces_floor_name_unique")
        invalidAdminField("name", "이 층에 같은 이름의 공간이 있어요");
    }
    throw error;
  }
}
export async function publishAdminSpaceChange(
  floorId: string,
  spaceId: string,
  dependencies: AdminDependencies,
) {
  try {
    await (dependencies.publisher ?? getRealtimePublisher()).publish(
      floorChannel(floorId),
      {
        type: "space.status_changed",
        spaceId,
      },
    );
  } catch {
    (dependencies.logError ?? console.error)(
      "Space update notification failed.",
    );
  }
}

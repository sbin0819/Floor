import { createAction } from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import { withTransaction, type DalDatabase } from "@/lib/dal";
import {
  getRoleSettingsVersion,
  lockRoleSettingsBranch,
  removeRoleSettings,
  writeRoleSettings,
} from "@/lib/dal/role-settings-editor";
import {
  adminActionDependencies,
  type AdminDependencies,
} from "./action-factory";
import { requireRoleSettingsAccess } from "./role-settings-access";
import { normalizeRoleSetting } from "./role-settings-editor";
import {
  resetRoleSettingsSchema,
  updateRoleSettingsSchema,
} from "./role-settings-schema";

async function compareVersion(
  branchId: string,
  expected: string | null,
  db: DalDatabase,
) {
  const current = await getRoleSettingsVersion(branchId, db);
  if ((current?.toISOString() ?? null) !== expected)
    throw new ActionError("STALE");
  return current;
}

export function createRoleSettingsActions(
  dependencies: AdminDependencies = {},
) {
  const actionDependencies = adminActionDependencies(dependencies);
  const db = dependencies.database;
  return {
    updateRoleSettings: createAction(
      {
        input: updateRoleSettingsSchema,
        authorize: async ({ session, input }) => {
          await requireRoleSettingsAccess(session, input.branchId, db);
          return true;
        },
        handler: async ({ session, input }) =>
          withTransaction(async (tx) => {
            if (!(await lockRoleSettingsBranch(input.branchId, tx)))
              throw new ActionError("NOT_FOUND");
            await requireRoleSettingsAccess(session, input.branchId, tx);
            const current = await compareVersion(
              input.branchId,
              input.expectedUpdatedAt,
              tx,
            );
            const now = dependencies.now?.() ?? new Date();
            // 같은 밀리초의 저장을 구분할 수 없으므로 기존 버전을 재사용하지 않는다.
            if (current && now <= current) throw new ActionError("STALE");
            await writeRoleSettings(
              input.branchId,
              input.roles.map(normalizeRoleSetting),
              session.userId,
              now,
              tx,
            );
            return { updatedAt: now.toISOString() };
          }, db),
      },
      actionDependencies,
    ),
    resetRoleSettings: createAction(
      {
        input: resetRoleSettingsSchema,
        authorize: async ({ session, input }) => {
          await requireRoleSettingsAccess(session, input.branchId, db);
          return true;
        },
        handler: async ({ session, input }) =>
          withTransaction(async (tx) => {
            if (!(await lockRoleSettingsBranch(input.branchId, tx)))
              throw new ActionError("NOT_FOUND");
            await requireRoleSettingsAccess(session, input.branchId, tx);
            await compareVersion(input.branchId, input.expectedUpdatedAt, tx);
            await removeRoleSettings(input.branchId, tx);
            return { updatedAt: null };
          }, db),
      },
      actionDependencies,
    ),
  };
}

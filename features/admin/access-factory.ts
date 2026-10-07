import { createAction } from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import { withTransaction, type DalDatabase } from "@/lib/dal";
import {
  getTeamsByIds,
  listAdminSpaces,
  lockAdminFloor,
  lockAdminSpace,
  replaceAccessGrants,
  setFloorAccessRecord,
  setSpaceAccessRecord,
} from "@/lib/dal/admin";
import { getFloorWithAccess } from "@/lib/dal/branches";
import { getSpaceForAccess } from "@/lib/dal/spaces";
import { adjustSpacesForFloor, validateSpaceAccess } from "./access-rules";
import {
  adminActionDependencies,
  checkAdminFloor,
  checkAdminSpace,
  invalidAdminField,
  publishAdminSpaceChange,
  type AdminDependencies,
} from "./action-factory";
import { setFloorAccessSchema, setSpaceAccessSchema } from "./schema";

async function assertTeams(teamIds: string[], database: DalDatabase) {
  if ((await getTeamsByIds(teamIds, database)).length !== teamIds.length)
    invalidAdminField("teamIds", "존재하는 팀을 골라 주세요");
}

export function createAccessActions(dependencies: AdminDependencies = {}) {
  const db = dependencies.database;
  const actionDependencies = adminActionDependencies(dependencies);
  const setFloorAccess = createAction(
    {
      input: setFloorAccessSchema,
      authorize: ({ session, input }) =>
        checkAdminFloor(session, input.floorId, "plan.edit", db),
      handler: ({ input }) =>
        withTransaction(async (transaction) => {
          const floor = await lockAdminFloor(
            input.floorId,
            "update",
            transaction,
          );
          if (!floor) throw new ActionError("NOT_FOUND");
          await assertTeams(input.teamIds, transaction);
          const spaces = await listAdminSpaces(
            { floorId: floor.id, includeArchived: true, includeDesks: true },
            transaction,
          );
          const changed = adjustSpacesForFloor(
            { access: input.access, allowedTeamIds: input.teamIds },
            spaces,
          );
          if (
            !(await setFloorAccessRecord(floor.id, input.access, transaction))
          )
            throw new ActionError("NOT_FOUND");
          await replaceAccessGrants(
            { targetType: "floor", targetId: floor.id, teamIds: input.teamIds },
            transaction,
          );
          for (const space of changed) {
            await setSpaceAccessRecord(space.id, space.access, transaction);
            await replaceAccessGrants(
              {
                targetType: "space",
                targetId: space.id,
                teamIds: space.allowedTeamIds,
              },
              transaction,
            );
          }
          return {
            floorId: floor.id,
            changedSpaces: changed.map(({ id, name, access }) => ({
              id,
              name,
              access,
            })),
          };
        }, db),
    },
    actionDependencies,
  );
  const setSpaceAccess = createAction(
    {
      input: setSpaceAccessSchema,
      authorize: ({ session, input }) =>
        checkAdminSpace(session, input.spaceId, "plan.edit", db, false),
      handler: async ({ input }) => {
        const space = await getSpaceForAccess(input.spaceId, db);
        if (!space || space.archivedAt || space.type === "desk")
          throw new ActionError("NOT_FOUND");
        const row = await withTransaction(async (transaction) => {
          if (!(await lockAdminFloor(space.floorId, "share", transaction)))
            throw new ActionError("NOT_FOUND");
          const locked = await lockAdminSpace(space.id, transaction);
          if (
            !locked ||
            locked.floorId !== space.floorId ||
            locked.archivedAt ||
            locked.type === "desk"
          )
            throw new ActionError("NOT_FOUND");
          const floor = await getFloorWithAccess(locked.floorId, transaction);
          if (!floor) throw new ActionError("NOT_FOUND");
          await assertTeams(input.teamIds, transaction);
          const reason = validateSpaceAccess({
            floor,
            space: { access: input.access, allowedTeamIds: input.teamIds },
          });
          if (reason)
            invalidAdminField(
              input.access === "teams" ? "teamIds" : "access",
              reason,
            );
          const updated = await setSpaceAccessRecord(
            locked.id,
            input.access,
            transaction,
          );
          if (!updated) throw new ActionError("NOT_FOUND");
          await replaceAccessGrants(
            {
              targetType: "space",
              targetId: locked.id,
              teamIds: input.teamIds,
            },
            transaction,
          );
          return updated;
        }, db);
        await publishAdminSpaceChange(row.floorId, row.id, dependencies);
        return { spaceId: row.id };
      },
    },
    actionDependencies,
  );
  return { setFloorAccess, setSpaceAccess };
}

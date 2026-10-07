import { createAction } from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import { withTransaction } from "@/lib/dal";
import {
  archiveSpaceRecord,
  countActiveBookings,
  insertFloor,
  insertSpace,
  lockAdminSpace,
  maxFloorSortOrder,
  restoreSpaceRecord,
  updateBranchRecord,
  updateFloorRecord,
  updateSpaceRecord,
} from "@/lib/dal/admin";
import {
  adminActionDependencies,
  checkAdminBranch,
  checkAdminFloor,
  checkAdminSpace,
  invalidAdminField,
  publishAdminSpaceChange,
  withAdminConstraintErrors,
  type AdminDependencies,
} from "./action-factory";
import {
  archiveSpaceSchema,
  createFloorSchema,
  createSpaceSchema,
  restoreSpaceSchema,
  updateBranchSchema,
  updateFloorSchema,
  updateSpaceSchema,
} from "./schema";

function spaceValues<T extends { capacity: number | null; bookable: boolean }>(
  type: string,
  values: T,
): T {
  if (type !== "lounge" && values.capacity === null)
    invalidAdminField("capacity", "정원을 입력해 주세요");
  return {
    ...values,
    bookable:
      type === "lounge" || type === "desk_area" ? false : values.bookable,
  };
}

export function createAdminActions(dependencies: AdminDependencies = {}) {
  const db = dependencies.database;
  const actionDependencies = adminActionDependencies(dependencies);
  const now = dependencies.now ?? (() => new Date());
  const updateBranch = createAction(
    {
      input: updateBranchSchema,
      authorize: ({ session, input }) =>
        checkAdminBranch(session, input.branchId, "space.manage", db),
      handler: async ({ input }) => {
        const row = await updateBranchRecord(input, db);
        if (!row) throw new ActionError("NOT_FOUND");
        return { branchId: row.id };
      },
    },
    actionDependencies,
  );
  const createFloor = createAction(
    {
      input: createFloorSchema,
      authorize: ({ session, input }) =>
        checkAdminBranch(session, input.branchId, "space.manage", db),
      handler: ({ input }) =>
        withAdminConstraintErrors(() =>
          withTransaction(async (transaction) => {
            const sortOrder =
              input.sortOrder ??
              ((await maxFloorSortOrder(input.branchId, transaction)) ?? -1) +
                1;
            if (sortOrder > 999)
              invalidAdminField("sortOrder", "순서는 999 이하로 입력해 주세요");
            const floor = await insertFloor(
              { ...input, sortOrder },
              transaction,
            );
            return { floorId: floor.id };
          }, db),
        ),
    },
    actionDependencies,
  );
  const updateFloor = createAction(
    {
      input: updateFloorSchema,
      authorize: ({ session, input }) =>
        checkAdminFloor(session, input.floorId, "space.manage", db),
      handler: ({ input }) =>
        withAdminConstraintErrors(async () => {
          const floor = await updateFloorRecord(input, db);
          if (!floor) throw new ActionError("NOT_FOUND");
          return { floorId: floor.id };
        }),
    },
    actionDependencies,
  );
  const createSpace = createAction(
    {
      input: createSpaceSchema,
      authorize: ({ session, input }) =>
        checkAdminFloor(session, input.floorId, "space.manage", db),
      handler: ({ input }) =>
        withAdminConstraintErrors(async () => {
          const row = await insertSpace(spaceValues(input.type, input), db);
          return { spaceId: row.id };
        }),
    },
    actionDependencies,
  );
  const updateSpace = createAction(
    {
      input: updateSpaceSchema,
      authorize: ({ session, input }) =>
        checkAdminSpace(session, input.spaceId, "space.manage", db),
      handler: async ({ input }) => {
        const row = await withAdminConstraintErrors(() =>
          withTransaction(async (transaction) => {
            const locked = await lockAdminSpace(input.spaceId, transaction);
            if (!locked || locked.type === "desk")
              throw new ActionError("NOT_FOUND");
            const values = spaceValues(locked.type, input);
            if (
              locked.bookable &&
              !values.bookable &&
              (await countActiveBookings(locked.id, now(), transaction))
            )
              throw new ActionError("SPACE_IN_USE");
            const space = await updateSpaceRecord(values, transaction);
            if (!space) throw new ActionError("NOT_FOUND");
            return space;
          }, db),
        );
        await publishAdminSpaceChange(row.floorId, row.id, dependencies);
        return { spaceId: row.id };
      },
    },
    actionDependencies,
  );
  const archiveSpace = createAction(
    {
      input: archiveSpaceSchema,
      authorize: ({ session, input }) =>
        checkAdminSpace(session, input.spaceId, "space.manage", db),
      handler: async ({ input }) => {
        const result = await withTransaction(async (transaction) => {
          const locked = await lockAdminSpace(input.spaceId, transaction);
          if (!locked || locked.type === "desk")
            throw new ActionError("NOT_FOUND");
          if (locked.archivedAt) return { row: locked, changed: false };
          const current = now();
          if (await countActiveBookings(locked.id, current, transaction))
            throw new ActionError("SPACE_IN_USE");
          const row = await archiveSpaceRecord(locked.id, current, transaction);
          if (!row) throw new ActionError("NOT_FOUND");
          return { row, changed: true };
        }, db);
        if (result.changed)
          await publishAdminSpaceChange(
            result.row.floorId,
            result.row.id,
            dependencies,
          );
        return { spaceId: result.row.id };
      },
    },
    actionDependencies,
  );
  const restoreSpace = createAction(
    {
      input: restoreSpaceSchema,
      authorize: ({ session, input }) =>
        checkAdminSpace(session, input.spaceId, "space.manage", db),
      handler: async ({ input }) => {
        const result = await withAdminConstraintErrors(() =>
          withTransaction(async (transaction) => {
            const locked = await lockAdminSpace(input.spaceId, transaction);
            if (!locked || locked.type === "desk")
              throw new ActionError("NOT_FOUND");
            if (!locked.archivedAt) return { row: locked, changed: false };
            const row = await restoreSpaceRecord(locked.id, transaction);
            if (!row) throw new ActionError("NOT_FOUND");
            return { row, changed: true };
          }, db),
        );
        if (result.changed)
          await publishAdminSpaceChange(
            result.row.floorId,
            result.row.id,
            dependencies,
          );
        return { spaceId: result.row.id };
      },
    },
    actionDependencies,
  );
  return {
    updateBranch,
    createFloor,
    updateFloor,
    createSpace,
    updateSpace,
    archiveSpace,
    restoreSpace,
  };
}

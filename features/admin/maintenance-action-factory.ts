import { createAction } from "@/lib/actions/create-action";
import { getPostgresError } from "@/lib/actions/errors";
import { ActionError } from "@/lib/actions/result";
import type { Session } from "@/lib/auth/types";
import type { DalDatabase } from "@/lib/dal";
import { lockAdminSpace } from "@/lib/dal/admin";
import { lockBookingUsers } from "@/lib/dal/booking-participants";
import { lockFloorForBooking, lockSpaceForBooking } from "@/lib/dal/bookings";
import { getMaintenanceSpace } from "@/lib/dal/maintenance-read";
import {
  deleteUpcomingMaintenance,
  endCurrentMaintenance,
  getMaintenanceBlock,
  insertMaintenance,
  listMaintenanceBookings,
  listMaintenanceParticipants,
  lockMaintenanceBookings,
  updateUpcomingMaintenance,
} from "@/lib/dal/maintenance-write";
import { can } from "@/lib/permissions/can";
import { loadPermissionContext } from "@/lib/permissions/context";
import {
  bookingActionDependencies,
  evictBookingCalls,
  publishBookingChange,
  publishBookingChatEvents,
  type BookingDependencies,
} from "@/features/bookings/action-factory";
import {
  cancelBookingInTransaction,
  type BookingCancellationEffects,
} from "@/features/bookings/cancel-booking-core";
import {
  assertParticipantsLocked,
  withParticipantTransaction,
} from "@/features/bookings/participant-transaction";
import { publishAdminSpaceChange } from "./action-factory";
import {
  blockIdSchema,
  createMaintenanceSchema,
  updateMaintenanceSchema,
  validateMaintenanceWindow,
  ensureMaintenanceSpace,
} from "./maintenance-schema";

type Target = NonNullable<Awaited<ReturnType<typeof getMaintenanceSpace>>>;

async function checkTarget(
  spaceId: string,
  session: Session,
  db?: DalDatabase,
): Promise<Target> {
  const row = await getMaintenanceSpace(spaceId, db);
  if (!row) throw new ActionError("NOT_FOUND");
  const context = await loadPermissionContext(session, row.branch.id, db);
  if (!context.staffBranchIds.includes(row.branch.id))
    throw new ActionError("NOT_FOUND");
  if (!can(context, "space.manage", { branchId: row.branch.id }))
    throw new ActionError("FORBIDDEN");
  return ensureMaintenanceSpace(row);
}

async function targetForBlock(
  blockId: string,
  session: Session,
  db?: DalDatabase,
) {
  const block = await getMaintenanceBlock(blockId, db);
  if (!block) throw new ActionError("NOT_FOUND");
  return { block, target: await checkTarget(block.spaceId, session, db) };
}

function invalidState(): never {
  throw new ActionError("INVALID_INPUT", { message: "maintenance_state" });
}

async function lockTarget(target: Target, session: Session, db: DalDatabase) {
  if (!(await lockFloorForBooking(target.floor.id, db)))
    throw new ActionError("NOT_FOUND");
  // 좌석 점검과 부모 구역 보관도 같은 방향으로 직렬화한다.
  if (
    target.space.type === "desk" &&
    target.space.parentId &&
    !(await lockSpaceForBooking(target.space.parentId, db))
  )
    throw new ActionError("NOT_FOUND");
  if (!(await lockAdminSpace(target.space.id, db)))
    throw new ActionError("NOT_FOUND");
  const current = await checkTarget(target.space.id, session, db);
  if (
    current.floor.id !== target.floor.id ||
    current.space.parentId !== target.space.parentId
  )
    throw new ActionError("STALE");
  return current;
}

async function withOverlapError<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const postgres = getPostgresError(error);
    if (
      postgres?.code === "23P01" &&
      postgres.constraint === "space_blocks_no_overlap"
    )
      throw new ActionError("INVALID_INPUT", {
        fieldErrors: { start: ["이 시간에 이미 점검이 있어요"] },
      });
    throw error;
  }
}

export function createMaintenanceActionFactory(
  dependencies: BookingDependencies = {},
) {
  const db = dependencies.database;
  const now = () => dependencies.now?.() ?? new Date();
  const actionDependencies = bookingActionDependencies(dependencies);

  async function publish(
    target: Target,
    effects: readonly BookingCancellationEffects[],
  ) {
    await evictBookingCalls(
      effects.flatMap((effect) => effect.callUserIds),
      dependencies,
    );
    const changedSpaces = new Set(effects.map((effect) => effect.spaceId));
    for (const spaceId of changedSpaces)
      await publishBookingChange(target.floor.id, spaceId, dependencies);
    await publishBookingChatEvents(
      effects.flatMap((effect) => effect.chatEvents),
      dependencies,
    );
    await publishAdminSpaceChange(
      target.floor.id,
      target.space.id,
      dependencies,
    );
  }

  async function save(
    input:
      | ReturnType<typeof createMaintenanceSchema.parse>
      | ReturnType<typeof updateMaintenanceSchema.parse>,
    session: Session,
  ) {
    const result = await withOverlapError(() =>
      withParticipantTransaction(async (tx) => {
        const initial =
          "blockId" in input
            ? (await targetForBlock(input.blockId, session, tx)).target
            : await checkTarget(input.spaceId, session, tx);
        const target = await lockTarget(initial, session, tx);
        const at = now();
        if ("blockId" in input) {
          const block = await getMaintenanceBlock(input.blockId, tx);
          if (!block) throw new ActionError("NOT_FOUND");
          if (block.during.start <= at) invalidState();
        }
        const window = validateMaintenanceWindow({
          ...input,
          now: at,
          timeZone: target.branch.timezone,
        });
        const filter = {
          spaceId: target.space.id,
          isDeskArea: target.space.type === "desk_area",
          ...window,
          now: at,
        };
        const initialBookings = await listMaintenanceBookings(filter, tx);
        const initialParticipants = await listMaintenanceParticipants(
          initialBookings.map((row) => row.booking.id),
          tx,
        );
        const userIds = [
          ...new Set([
            session.userId,
            ...initialBookings.map((row) => row.booking.userId),
            ...initialParticipants.map((row) => row.userId),
          ]),
        ];
        if (
          !(await lockBookingUsers(
            userIds.map((userId) => ({ userId, strength: "key share" })),
            tx,
          ))
        )
          throw new ActionError("NOT_FOUND");
        await lockMaintenanceBookings(
          initialBookings.map((row) => row.booking.id),
          tx,
        );
        const freshNow = now();
        const freshWindow = validateMaintenanceWindow({
          ...input,
          now: freshNow,
          timeZone: target.branch.timezone,
        });
        const rows = await listMaintenanceBookings(
          { ...filter, ...freshWindow, now: freshNow },
          tx,
        );
        const participants = await listMaintenanceParticipants(
          rows.map((row) => row.booking.id),
          tx,
        );
        assertParticipantsLocked(
          userIds,
          participants.map((row) => row.userId),
        );
        const expected = new Set(input.expectedBookingIds);
        if (
          rows.length !== expected.size ||
          rows.some((row) => !expected.has(row.booking.id))
        )
          throw new ActionError("STALE");
        // 사용자 잠금을 기다리는 동안 바뀐 소속·역할도 다시 확인한다.
        await checkTarget(target.space.id, session, tx);
        const block =
          "blockId" in input
            ? await updateUpcomingMaintenance(
                input.blockId,
                { during: freshWindow, reason: input.reason },
                freshNow,
                tx,
              )
            : await insertMaintenance(
                {
                  spaceId: target.space.id,
                  during: freshWindow,
                  reason: input.reason,
                  createdBy: session.userId,
                },
                tx,
              );
        if (!block) invalidState();
        const effects: BookingCancellationEffects[] = [];
        for (const row of rows) {
          effects.push(
            await cancelBookingInTransaction(
              {
                bookingId: row.booking.id,
                actor: { id: session.userId, name: session.name },
                now: freshNow,
                preparedLocatedBooking: row,
                lockedUserIds: userIds,
                participantIds: participants
                  .filter(
                    (participant) => participant.bookingId === row.booking.id,
                  )
                  .map((participant) => participant.userId),
                cancellation: { kind: "maintenance", reason: input.reason },
              },
              tx,
            ),
          );
        }
        return { target, effects, blockId: block.id };
      }, db),
    );
    await publish(result.target, result.effects);
    return { blockId: result.blockId, cancelledCount: result.effects.length };
  }

  return {
    createMaintenance: createAction(
      {
        input: createMaintenanceSchema,
        authorize: async ({ session, input }) => {
          await checkTarget(input.spaceId, session, db);
          return true;
        },
        handler: ({ session, input }) => save(input, session),
      },
      actionDependencies,
    ),
    updateMaintenance: createAction(
      {
        input: updateMaintenanceSchema,
        authorize: async ({ session, input }) => {
          await targetForBlock(input.blockId, session, db);
          return true;
        },
        handler: ({ session, input }) => save(input, session),
      },
      actionDependencies,
    ),
    endMaintenance: createAction(
      {
        input: blockIdSchema,
        authorize: async ({ session, input }) => {
          await targetForBlock(input.blockId, session, db);
          return true;
        },
        handler: async ({ session, input }) => {
          const target = await withParticipantTransaction(async (tx) => {
            const initial = await targetForBlock(input.blockId, session, tx);
            const target = await lockTarget(initial.target, session, tx);
            if (!(await endCurrentMaintenance(input.blockId, now(), tx)))
              invalidState();
            return target;
          }, db);
          await publish(target, []);
          return { blockId: input.blockId };
        },
      },
      actionDependencies,
    ),
    deleteMaintenance: createAction(
      {
        input: blockIdSchema,
        authorize: async ({ session, input }) => {
          await targetForBlock(input.blockId, session, db);
          return true;
        },
        handler: async ({ session, input }) => {
          const target = await withParticipantTransaction(async (tx) => {
            const initial = await targetForBlock(input.blockId, session, tx);
            const target = await lockTarget(initial.target, session, tx);
            if (!(await deleteUpcomingMaintenance(input.blockId, now(), tx)))
              invalidState();
            return target;
          }, db);
          await publish(target, []);
          return { blockId: input.blockId };
        },
      },
      actionDependencies,
    ),
  };
}

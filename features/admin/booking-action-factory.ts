import { createAction } from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import type { Session } from "@/lib/auth/types";
import type { DalDatabase } from "@/lib/dal";
import { getBookingWithLocation } from "@/lib/dal/bookings";
import {
  listBookingParticipantIds,
  lockBookingUsers,
  lockParticipantBooking,
} from "@/lib/dal/booking-participants";
import { lockTeam } from "@/lib/dal/teams-write";
import { can } from "@/lib/permissions/can";
import { loadPermissionContext } from "@/lib/permissions/context";
import {
  bookingActionDependencies,
  evictBookingCalls,
  publishBookingChange,
  publishBookingChatEvents,
  type BookingDependencies,
} from "@/features/bookings/action-factory";
import { cancelBookingInTransaction } from "@/features/bookings/cancel-booking-core";
import { withParticipantTransaction } from "@/features/bookings/participant-transaction";
import {
  cancelBookingAsOperatorSchema,
  operatorCancellationReason,
} from "./booking-schema";

async function checkOperator(
  session: Session,
  branchId: string,
  db?: DalDatabase,
) {
  const context = await loadPermissionContext(session, branchId, db);
  if (!context.staffBranchIds.includes(branchId))
    throw new ActionError("NOT_FOUND");
  if (!can(context, "booking.manage_all", { branchId }))
    throw new ActionError("FORBIDDEN");
}

export function createCancelBookingAsOperator(
  dependencies: BookingDependencies = {},
) {
  const db = dependencies.database;
  return createAction(
    {
      input: cancelBookingAsOperatorSchema,
      authorize: async ({ session, input }) => {
        const row = await getBookingWithLocation(input.bookingId, db);
        if (!row) throw new ActionError("NOT_FOUND");
        await checkOperator(session, row.branch.id, db);
        return true;
      },
      handler: async ({ session, input }) => {
        const result = await withParticipantTransaction(async (tx) => {
          const before = await getBookingWithLocation(input.bookingId, tx);
          if (!before) throw new ActionError("NOT_FOUND");
          const initialIds =
            before.space.type === "desk"
              ? []
              : await listBookingParticipantIds(input.bookingId, tx);
          const lockedUserIds = [
            ...new Set([session.userId, before.booking.userId, ...initialIds]),
          ];
          if (
            !(await lockBookingUsers(
              lockedUserIds.map((userId) => ({
                userId,
                strength: "key share",
              })),
              tx,
            ))
          )
            throw new ActionError("NOT_FOUND");
          if (before.booking.teamId) await lockTeam(before.booking.teamId, tx);
          const locked = await lockParticipantBooking(input.bookingId, tx);
          if (!locked) throw new ActionError("NOT_FOUND");
          // 잠금을 기다리는 동안 바뀐 예약 시각도 알림에 반영한다.
          const row = await getBookingWithLocation(input.bookingId, tx);
          if (!row) throw new ActionError("NOT_FOUND");
          await checkOperator(session, row.branch.id, tx);
          const now = dependencies.now?.() ?? new Date();
          if (
            row.booking.status !== "confirmed" ||
            row.booking.during.end <= now
          ) {
            throw new ActionError("INVALID_INPUT", {
              message: "not_cancellable",
            });
          }
          const participantIds =
            row.space.type === "desk"
              ? []
              : await listBookingParticipantIds(input.bookingId, tx);
          return cancelBookingInTransaction(
            {
              bookingId: input.bookingId,
              actor: { id: session.userId, name: session.name },
              now,
              preparedLocatedBooking: row,
              lockedUserIds,
              participantIds,
              cancellation: {
                kind: "operator",
                reason: operatorCancellationReason(input),
              },
            },
            tx,
          );
        }, db);
        await evictBookingCalls(result.callUserIds, dependencies);
        await publishBookingChange(
          result.floorId,
          result.spaceId,
          dependencies,
        );
        await publishBookingChatEvents(result.chatEvents, dependencies);
        return { bookingId: result.bookingId };
      },
    },
    bookingActionDependencies(dependencies),
  );
}

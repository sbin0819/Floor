import {
  bookingActionDependencies,
  evictBookingCalls,
  publishBookingChange,
  publishBookingChatEvents,
  type BookingDependencies,
} from "@/features/bookings/action-factory";
import { cancelBookingSchema } from "@/features/bookings/schema";
import { canCancelBooking } from "@/features/bookings/visibility";
import { createAction } from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import { getSpaceForAccess } from "@/lib/dal";
import {
  getBookingWithLocation,
  lockBookingCanceller,
} from "@/lib/dal/bookings";
import { canAccess } from "@/lib/permissions/can-access";
import { loadPermissionContext } from "@/lib/permissions/context";
import {
  listBookingParticipantIds,
  lockBookingUsers,
  lockParticipantBooking,
} from "@/lib/dal/booking-participants";
import { withParticipantTransaction } from "./participant-transaction";
import { cancelBookingInTransaction } from "./cancel-booking-core";
import { lockTeam } from "@/lib/dal/teams-write";

export function createCancelBookingAction(
  dependencies: BookingDependencies = {},
) {
  const db = dependencies.database;
  return createAction(
    {
      input: cancelBookingSchema,
      authorize: async ({ session, input }) => {
        const row = await getBookingWithLocation(input.bookingId, db);
        if (!row) throw new ActionError("NOT_FOUND");
        const context = await loadPermissionContext(session, row.branch.id, db);
        const accessSpaceId =
          row.space.type === "desk" ? row.space.parentId : row.space.id;
        const space = accessSpaceId
          ? await getSpaceForAccess(accessSpaceId, db)
          : null;
        const owns = row.booking.userId === session.userId;
        const teamMember =
          row.booking.teamId !== null &&
          context.teams.some(({ teamId }) => teamId === row.booking.teamId);
        if (!owns && !teamMember && (!space || !canAccess(context, space)))
          throw new ActionError("NOT_FOUND");
        if (
          row.booking.status !== "confirmed" ||
          row.booking.during.end <= (dependencies.now ?? (() => new Date()))()
        )
          throw new ActionError("NOT_FOUND");
        return canCancelBooking(context, row.booking, row.branch.id);
      },
      handler: async ({ session, input }) => {
        const now = (dependencies.now ?? (() => new Date()))();
        const result = await withParticipantTransaction(async (transaction) => {
          const row = await getBookingWithLocation(
            input.bookingId,
            transaction,
          );
          if (!row) throw new ActionError("NOT_FOUND");
          const isDesk = row.space.type === "desk";
          const ownDesk = isDesk && row.booking.userId === session.userId;
          let participantIds: string[] = [];
          let lockedUserIds = [session.userId];
          if (ownDesk) {
            // 본인 좌석 취소에는 참석자와 알림이 없어 기존 잠금 경로를 유지한다.
            if (!(await lockBookingCanceller(session.userId, transaction)))
              throw new ActionError("NOT_FOUND");
          } else {
            participantIds = isDesk
              ? []
              : await listBookingParticipantIds(row.booking.id, transaction);
            lockedUserIds = [
              ...new Set([
                session.userId,
                row.booking.userId,
                ...participantIds,
              ]),
            ];
            if (
              !(await lockBookingUsers(
                lockedUserIds.map((userId) => ({
                  userId,
                  strength: "key share",
                })),
                transaction,
              ))
            )
              throw new ActionError("NOT_FOUND");
            if (row.booking.teamId) {
              const team = await lockTeam(row.booking.teamId, transaction);
              if (!team && row.booking.userId !== session.userId)
                throw new ActionError("NOT_FOUND");
            }
            if (row.booking.userId !== session.userId) {
              const current = await loadPermissionContext(
                session,
                row.branch.id,
                transaction,
              );
              if (!canCancelBooking(current, row.booking, row.branch.id))
                throw new ActionError("FORBIDDEN");
            }
            const locked = await lockParticipantBooking(
              row.booking.id,
              transaction,
            );
            if (!locked || locked.userId !== row.booking.userId)
              throw new ActionError("NOT_FOUND");
            participantIds = isDesk
              ? []
              : await listBookingParticipantIds(row.booking.id, transaction);
          }
          return cancelBookingInTransaction(
            {
              bookingId: input.bookingId,
              actor: { id: session.userId, name: session.name },
              now,
              preparedLocatedBooking: row,
              lockedUserIds,
              participantIds,
            },
            transaction,
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

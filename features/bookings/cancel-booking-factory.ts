import {
  bookingActionDependencies,
  publishBookingChange,
  type BookingDependencies,
} from "@/features/bookings/action-factory";
import { cancelBookingSchema } from "@/features/bookings/schema";
import { canCancelBooking } from "@/features/bookings/visibility";
import { createAction } from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import { getSpaceForAccess } from "@/lib/dal";
import {
  cancelBookingRecord,
  getBookingWithLocation,
  lockBookingCanceller,
} from "@/lib/dal/bookings";
import { canAccess } from "@/lib/permissions/can-access";
import { loadPermissionContext } from "@/lib/permissions/context";
import {
  getDeskNotificationAreaName,
  listBookingParticipantIds,
  lockBookingUsers,
  lockParticipantBooking,
} from "@/lib/dal/booking-participants";
import {
  assertParticipantsLocked,
  withParticipantTransaction,
} from "./participant-transaction";
import {
  buildBookingNotifications,
  notificationBookingSnapshot,
} from "@/features/notifications/builders";
import {
  deleteBookingReminders,
  insertNotifications,
} from "@/lib/dal/notifications";

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
          if (ownDesk) {
            // 본인 좌석 취소에는 참석자와 알림이 없어 기존 잠금 경로를 유지한다.
            if (!(await lockBookingCanceller(session.userId, transaction)))
              throw new ActionError("NOT_FOUND");
          } else {
            participantIds = isDesk
              ? []
              : await listBookingParticipantIds(row.booking.id, transaction);
            const userIds = [
              ...new Set([
                session.userId,
                row.booking.userId,
                ...participantIds,
              ]),
            ];
            if (
              !(await lockBookingUsers(
                userIds.map((userId) => ({ userId, strength: "key share" })),
                transaction,
              ))
            )
              throw new ActionError("NOT_FOUND");
            const locked = await lockParticipantBooking(
              row.booking.id,
              transaction,
            );
            if (!locked || locked.userId !== row.booking.userId)
              throw new ActionError("NOT_FOUND");
            participantIds = isDesk
              ? []
              : await listBookingParticipantIds(row.booking.id, transaction);
            assertParticipantsLocked(userIds, participantIds);
          }
          const cancelled = await cancelBookingRecord(
            { bookingId: input.bookingId, userId: session.userId, now },
            transaction,
          );
          if (!cancelled) throw new ActionError("NOT_FOUND");
          if (!isDesk)
            await deleteBookingReminders(
              { bookingId: cancelled.id },
              transaction,
            );
          if (!ownDesk) {
            const areaName = isDesk
              ? await getDeskNotificationAreaName(
                  row.space.parentId,
                  transaction,
                )
              : undefined;
            const snapshot = notificationBookingSnapshot({
              ...row,
              booking: cancelled,
              areaName,
            });
            await insertNotifications(
              buildBookingNotifications({
                type: "booking_cancelled",
                booking: snapshot,
                actor: { id: session.userId, name: session.name },
                userIds: [
                  ...participantIds,
                  ...(session.userId !== cancelled.userId
                    ? [cancelled.userId]
                    : []),
                ],
                now,
              }),
              transaction,
            );
          }
          return {
            bookingId: cancelled.id,
            floorId: row.floor.id,
            spaceId:
              row.space.type === "desk"
                ? (row.space.parentId ?? row.space.id)
                : row.space.id,
          };
        }, db);
        await publishBookingChange(
          result.floorId,
          result.spaceId,
          dependencies,
        );
        return { bookingId: result.bookingId };
      },
    },
    bookingActionDependencies(dependencies),
  );
}

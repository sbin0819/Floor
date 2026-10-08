import {
  bookingActionDependencies,
  publishBookingChange,
  type BookingDependencies,
} from "@/features/bookings/action-factory";
import { cancelBookingSchema } from "@/features/bookings/schema";
import { canCancelBooking } from "@/features/bookings/visibility";
import { createAction } from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import { getSpaceForAccess, withTransaction } from "@/lib/dal";
import {
  cancelBookingRecord,
  getBookingWithLocation,
  lockBookingCanceller,
} from "@/lib/dal/bookings";
import { canAccess } from "@/lib/permissions/can-access";
import { loadPermissionContext } from "@/lib/permissions/context";

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
        const result = await withTransaction(async (transaction) => {
          const row = await getBookingWithLocation(
            input.bookingId,
            transaction,
          );
          if (!row) throw new ActionError("NOT_FOUND");
          // cancelled_by의 FK 잠금도 생성 액션과 같은 사용자 → 예약 순서로 잡는다.
          if (!(await lockBookingCanceller(session.userId, transaction)))
            throw new ActionError("NOT_FOUND");
          const cancelled = await cancelBookingRecord(
            { bookingId: input.bookingId, userId: session.userId, now },
            transaction,
          );
          if (!cancelled) throw new ActionError("NOT_FOUND");
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

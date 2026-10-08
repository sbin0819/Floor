import {
  bookingActionDependencies,
  publishBookingChange,
  type BookingDependencies,
} from "./action-factory";
import { leaveBookingSchema } from "./schema";
import { createAction } from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import { withTransaction } from "@/lib/dal";
import { getBookingWithLocation } from "@/lib/dal/bookings";
import {
  deleteCurrentBookingParticipant,
  lockBookingUsers,
  lockParticipantBooking,
} from "@/lib/dal/booking-participants";

export function createLeaveBookingAction(
  dependencies: BookingDependencies = {},
) {
  return createAction(
    {
      input: leaveBookingSchema,
      authorize: "none",
      handler: async ({ session, input }) => {
        const now = (dependencies.now ?? (() => new Date()))();
        const result = await withTransaction(async (transaction) => {
          const row = await getBookingWithLocation(
            input.bookingId,
            transaction,
          );
          if (!row) throw new ActionError("NOT_FOUND");
          if (
            !(await lockBookingUsers(
              [
                { userId: session.userId, strength: "key share" },
                { userId: row.booking.userId, strength: "key share" },
              ],
              transaction,
            ))
          )
            throw new ActionError("NOT_FOUND");
          const locked = await lockParticipantBooking(
            input.bookingId,
            transaction,
          );
          if (!locked || locked.userId !== row.booking.userId)
            throw new ActionError("NOT_FOUND");
          const removed = await deleteCurrentBookingParticipant(
            { bookingId: input.bookingId, userId: session.userId, now },
            transaction,
          );
          if (!removed) throw new ActionError("NOT_FOUND");
          return {
            bookingId: removed.bookingId,
            floorId: row.floor.id,
            spaceId: row.space.id,
          };
        }, dependencies.database);
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

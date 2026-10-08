import {
  bookingActionDependencies,
  publishBookingChange,
  publishBookingChatEvents,
  type BookingDependencies,
} from "./action-factory";
import { leaveBookingSchema } from "./schema";
import { createAction } from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import { withTransaction } from "@/lib/dal";
import { getBookingWithLocation } from "@/lib/dal/bookings";
import { recordMeetingMessages } from "@/lib/dal/chat-meeting";
import {
  deleteCurrentBookingParticipant,
  listBookingParticipantIds,
  lockBookingUsers,
  lockParticipantBooking,
} from "@/lib/dal/booking-participants";
import {
  buildBookingNotifications,
  notificationBookingSnapshot,
} from "@/features/notifications/builders";
import {
  deleteBookingReminders,
  insertNotifications,
} from "@/lib/dal/notifications";

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
          await deleteBookingReminders(
            { bookingId: locked.id, userIds: [session.userId] },
            transaction,
          );
          await insertNotifications(
            buildBookingNotifications({
              type: "participant_left",
              booking: notificationBookingSnapshot({ ...row, booking: locked }),
              actor: { id: session.userId, name: session.name },
              userIds: [locked.userId],
              now,
            }),
            transaction,
          );
          const currentIds = await listBookingParticipantIds(
            locked.id,
            transaction,
          );
          const chatEvents = await recordMeetingMessages(
            {
              bookingId: locked.id,
              actorId: null,
              memberIds: [locked.userId, ...currentIds],
              removedUserIds: [session.userId],
              messages: [{ type: "participant_left", name: session.name }],
              changed: true,
              now,
            },
            transaction,
          );
          return {
            bookingId: removed.bookingId,
            chatEvents,
            floorId: row.floor.id,
            spaceId: row.space.id,
          };
        }, dependencies.database);
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

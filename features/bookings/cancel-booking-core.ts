import { ActionError } from "@/lib/actions/result";
import type { DalDatabase } from "@/lib/dal";
import { getDeskNotificationAreaName } from "@/lib/dal/booking-participants";
import {
  cancelBookingRecord,
  type getBookingWithLocation,
} from "@/lib/dal/bookings";
import { recordMeetingMessages } from "@/lib/dal/chat-meeting";
import {
  deleteBookingReminders,
  insertNotifications,
} from "@/lib/dal/notifications";
import type { RealtimeItem } from "@/lib/realtime/types";
import {
  buildBookingNotifications,
  notificationBookingSnapshot,
} from "@/features/notifications/builders";
import { assertParticipantsLocked } from "./participant-transaction";

export type CancellationLocatedBooking = NonNullable<
  Awaited<ReturnType<typeof getBookingWithLocation>>
>;

export type BookingCancellationEffects = {
  bookingId: string;
  floorId: string;
  spaceId: string;
  callUserIds: string[];
  notificationUserIds: string[];
  chatEvents: RealtimeItem[];
};

// 호출자가 권한과 사용자·예약 잠금을 끝낸 뒤 부른다. 여기서 다시 잠그면
// 여러 예약을 취소할 때 이미 잡은 방보다 앞선 행을 뒤늦게 잠글 수 있다.
export async function cancelBookingInTransaction(
  {
    bookingId,
    actor,
    now,
    preparedLocatedBooking: row,
    lockedUserIds,
    participantIds,
  }: {
    bookingId: string;
    actor: { id: string; name: string };
    now: Date;
    preparedLocatedBooking: CancellationLocatedBooking;
    lockedUserIds: readonly string[];
    participantIds: readonly string[];
  },
  transaction: DalDatabase,
): Promise<BookingCancellationEffects> {
  if (row.booking.id !== bookingId) throw new ActionError("NOT_FOUND");
  assertParticipantsLocked(lockedUserIds, [
    actor.id,
    row.booking.userId,
    ...participantIds,
  ]);
  const isDesk = row.space.type === "desk";
  const ownDesk = isDesk && row.booking.userId === actor.id;
  const cancelled = await cancelBookingRecord(
    { bookingId, userId: actor.id, now },
    transaction,
  );
  if (!cancelled) throw new ActionError("NOT_FOUND");
  if (!isDesk)
    await deleteBookingReminders({ bookingId: cancelled.id }, transaction);

  let notificationUserIds: string[] = [];
  if (!ownDesk) {
    const areaName = isDesk
      ? await getDeskNotificationAreaName(row.space.parentId, transaction)
      : undefined;
    const snapshot = notificationBookingSnapshot({
      ...row,
      booking: cancelled,
      areaName,
    });
    const notifications = buildBookingNotifications({
      type: "booking_cancelled",
      booking: snapshot,
      actor,
      userIds: [
        ...participantIds,
        ...(actor.id !== cancelled.userId ? [cancelled.userId] : []),
      ],
      now,
    });
    await insertNotifications(notifications, transaction);
    notificationUserIds = notifications.map(({ userId }) => userId);
  }
  const memberIds = [cancelled.userId, ...participantIds];
  const chatEvents = isDesk
    ? []
    : await recordMeetingMessages(
        {
          bookingId: cancelled.id,
          actorId: memberIds.includes(actor.id) ? actor.id : null,
          memberIds,
          messages: [{ type: "booking_cancelled", actorName: actor.name }],
          changed: true,
          now,
        },
        transaction,
      );
  return {
    bookingId: cancelled.id,
    callUserIds: isDesk ? [] : memberIds,
    notificationUserIds,
    chatEvents,
    floorId: row.floor.id,
    spaceId: isDesk ? (row.space.parentId ?? row.space.id) : row.space.id,
  };
}

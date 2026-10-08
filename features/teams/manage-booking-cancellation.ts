import type { DalDatabase } from "@/lib/dal";
import type { FutureTeamBooking } from "@/lib/dal/team-bookings";
import {
  cancelBookingInTransaction,
  type BookingCancellationEffects,
} from "@/features/bookings/cancel-booking-core";

export function futureTeamBookingUsers(rows: readonly FutureTeamBooking[]) {
  return [
    ...new Set(
      rows.flatMap(({ booking, participantIds }) => [
        booking.userId,
        ...participantIds,
      ]),
    ),
  ];
}

// DB 조회·잠금은 DAL, 여러 도메인의 쓰기 조합은 feature에 둔다.
export async function cancelFutureTeamBookings(
  input: {
    bookings: readonly FutureTeamBooking[];
    actor: { id: string; name: string };
    now: Date;
    lockedUserIds: readonly string[];
  },
  transaction: DalDatabase,
): Promise<BookingCancellationEffects[]> {
  const results: BookingCancellationEffects[] = [];
  for (const row of input.bookings) {
    results.push(
      await cancelBookingInTransaction(
        {
          bookingId: row.booking.id,
          actor: input.actor,
          now: input.now,
          preparedLocatedBooking: row,
          lockedUserIds: input.lockedUserIds,
          participantIds: row.space.type === "desk" ? [] : row.participantIds,
        },
        transaction,
      ),
    );
  }
  return results;
}

import "server-only";

import { eq, or, sql } from "drizzle-orm";
import { bookingParticipants, bookings, users } from "@/lib/db/schema";

export function ownedOrInvitedBooking(userId: string) {
  return or(
    eq(bookings.userId, userId),
    sql`exists (select 1 from ${bookingParticipants} invited
      where invited.booking_id = ${bookings.id} and invited.user_id = ${userId})`,
  );
}

export const bookingParticipantNames = sql<string[]>`coalesce((
  select jsonb_agg(person.name order by person.name, person.id)
  from ${bookingParticipants} participant
  join ${users} person on person.id = participant.user_id
  where participant.booking_id = ${bookings}.${sql.identifier("id")}
), '[]'::jsonb)`;

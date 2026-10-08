import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import type { DalDatabase } from "./database";
import { bookings, bookingParticipants } from "@/lib/db/schema";
import type { TimeRange } from "@/lib/db/range";

export async function updateBookingRecord(
  input: {
    bookingId: string;
    userId: string;
    during: TimeRange;
    attendeeCount: number | null;
    title: string | null;
    now: Date;
  },
  database: DalDatabase,
) {
  const [booking] = await database
    .update(bookings)
    .set({
      during: input.during,
      attendeeCount: input.attendeeCount,
      title: input.title,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(bookings.id, input.bookingId),
        eq(bookings.userId, input.userId),
        eq(bookings.status, "confirmed"),
        sql`upper(${bookings.during}) > ${input.now.toISOString()}::timestamptz`,
      ),
    )
    .returning();
  return booking ?? null;
}

export async function removeBookingParticipants(
  bookingId: string,
  userIds: readonly string[],
  database: DalDatabase,
) {
  if (userIds.length)
    await database
      .delete(bookingParticipants)
      .where(
        and(
          eq(bookingParticipants.bookingId, bookingId),
          inArray(bookingParticipants.userId, [...userIds]),
        ),
      );
}

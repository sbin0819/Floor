import "server-only";

import type { DalDatabase } from "@/lib/dal/database";
import { bookingParticipants } from "@/lib/db/schema";

export async function insertBookingParticipants(
  bookingId: string,
  userIds: readonly string[],
  database: DalDatabase,
) {
  if (userIds.length)
    await database
      .insert(bookingParticipants)
      .values(userIds.map((userId) => ({ bookingId, userId })));
}

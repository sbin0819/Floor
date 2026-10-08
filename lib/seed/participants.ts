import type { DalDatabase } from "@/lib/dal";
import { insertBookingParticipants } from "@/lib/dal/booking-participants";
import type { SeedBookings2Data } from "./bookings-2";
import { SeedError } from "./errors";

export async function insertSeedParticipants(
  bookingId: string,
  extras: SeedBookings2Data | undefined,
  userIds: ReadonlyMap<string, string>,
  database: DalDatabase,
) {
  const keys = extras?.participants.find(
    (row) => row.bookingId === bookingId,
  )?.userKeys;
  if (!keys?.length) return;
  const ids = keys.map((key) => {
    const id = userIds.get(key);
    if (!id) throw new SeedError("참석자 시드가 참조하는 계정이 없어요.");
    return id;
  });
  await insertBookingParticipants(bookingId, ids, database);
}

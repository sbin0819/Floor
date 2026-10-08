import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bookingParticipants, bookings, users } from "@/lib/db/schema";
import {
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("22. booking participants from the real migration", () => {
  let database: TestDatabase;
  let fixture: BookingActors;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database?.client.close();
  });
  beforeEach(async () => {
    fixture = await seedBookingActors(database);
  });

  it("rejects a duplicate booking/user composite key", async () => {
    const booking = await insertFixtureBooking(database, fixture);
    const row = { bookingId: booking.id, userId: fixture.stranger.userId };
    await database.db.insert(bookingParticipants).values(row);
    await expect(
      database.db.insert(bookingParticipants).values(row),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
  });

  it("cascades booking deletion without deleting users", async () => {
    const booking = await insertFixtureBooking(database, fixture);
    await database.db.insert(bookingParticipants).values([
      { bookingId: booking.id, userId: fixture.stranger.userId },
      { bookingId: booking.id, userId: fixture.operator.userId },
    ]);
    await database.db.delete(bookings).where(eq(bookings.id, booking.id));
    expect(await database.db.select().from(bookingParticipants)).toEqual([]);
    expect(
      await database.db
        .select()
        .from(users)
        .where(eq(users.id, fixture.stranger.userId)),
    ).toHaveLength(1);
  });

  it.each(["booking", "user"])(
    "rejects a missing %s foreign key",
    async (kind) => {
      const booking = await insertFixtureBooking(database, fixture);
      await expect(
        database.db.insert(bookingParticipants).values({
          bookingId: kind === "booking" ? crypto.randomUUID() : booking.id,
          userId:
            kind === "user" ? crypto.randomUUID() : fixture.stranger.userId,
        }),
      ).rejects.toMatchObject({ cause: { code: "23503" } });
    },
  );
});

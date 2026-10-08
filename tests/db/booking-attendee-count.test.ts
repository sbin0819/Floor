import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("21. booking attendee count constraint from the actual migration", () => {
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

  it.each([0, 501, -1])("rejects attendee_count %s", async (attendeeCount) => {
    await expect(
      insertFixtureBooking(database, fixture, { attendeeCount }),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint: "bookings_attendee_count_range" },
    });
  });

  it.each([null, 1, 500])(
    "accepts attendee_count %s",
    async (attendeeCount) => {
      expect(
        (await insertFixtureBooking(database, fixture, { attendeeCount }))
          .attendeeCount,
      ).toBe(attendeeCount);
    },
  );

  it("defaults an omitted attendee count to null without a data backfill", async () => {
    expect(
      (await insertFixtureBooking(database, fixture)).attendeeCount,
    ).toBeNull();
  });
});

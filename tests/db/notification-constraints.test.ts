import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bookings, notifications } from "@/lib/db/schema";
import {
  bookingNow,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("23. notification constraints from actual migrations", () => {
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
  async function reminder() {
    const booking = await insertFixtureBooking(database, fixture);
    return {
      userId: fixture.person.userId,
      bookingId: booking.id,
      type: "booking_reminder" as const,
      scheduledFor: bookingNow,
      expiresAt: booking.during.end,
      data: {
        spaceName: "회의실 A",
        floorName: "7F",
        branchName: "강남점",
        timezone: "Asia/Seoul",
        start: booking.during.start.toISOString(),
        end: booking.during.end.toISOString(),
        minutesBefore: 5 as const,
      },
    };
  }
  it("rejects the same recipient, booking and reminder instant", async () => {
    const row = await reminder();
    await database.db.insert(notifications).values(row);
    await expect(
      database.db.insert(notifications).values(row),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint: "notifications_reminder_unique" },
    });
  });
  it("allows different types, people and reminder instants", async () => {
    const row = await reminder();
    await database.db
      .insert(notifications)
      .values([
        row,
        { ...row, type: "booking_invited", expiresAt: null },
        { ...row, userId: fixture.stranger.userId },
        { ...row, scheduledFor: new Date(row.scheduledFor.getTime() + 1000) },
      ]);
    expect(await database.db.select().from(notifications)).toHaveLength(4);
  });
  it("cascades booking deletion to both reminders and ordinary notifications", async () => {
    const row = await reminder();
    await database.db
      .insert(notifications)
      .values([row, { ...row, type: "booking_cancelled", expiresAt: null }]);
    await database.db.delete(bookings).where(eq(bookings.id, row.bookingId));
    expect(await database.db.select().from(notifications)).toEqual([]);
  });
  it("creates the three read indexes and partial reminder uniqueness", async () => {
    const result = await database.db.execute(
      sql`select indexname, indexdef from pg_indexes where tablename = 'notifications'`,
    );
    const names = result.rows.map((row) => row.indexname);
    expect(names).toEqual(
      expect.arrayContaining([
        "notifications_user_scheduled_idx",
        "notifications_unread_user_idx",
        "notifications_booking_id_idx",
        "notifications_reminder_unique",
      ]),
    );
    expect(
      result.rows.find(
        (row) => row.indexname === "notifications_user_scheduled_idx",
      )?.indexdef,
    ).toContain("scheduled_for DESC");
    expect(
      result.rows.find(
        (row) => row.indexname === "notifications_unread_user_idx",
      )?.indexdef,
    ).toContain("read_at IS NULL");
  });
});

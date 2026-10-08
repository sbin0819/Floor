import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  buildBookingNotifications,
  buildReminderNotifications,
  type NotificationBooking,
} from "@/features/notifications/builders";
import {
  deleteBookingReminders,
  insertNotifications,
} from "@/lib/dal/notifications";
import * as schema from "@/lib/db/schema";
import { notifications } from "@/lib/db/schema";
import {
  bookingRange,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("bulk notification writes", () => {
  let database: TestDatabase;
  let fixture: BookingActors;
  let snapshot: NotificationBooking;
  const now = new Date("2026-10-07T00:00:00Z");
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database?.client.close();
  });
  beforeEach(async () => {
    fixture = await seedBookingActors(database);
    const booking = await insertFixtureBooking(database, fixture);
    snapshot = {
      id: booking.id,
      during: booking.during,
      title: booking.title,
      spaceName: "회의실 A",
      floorName: "7F",
      branchName: "강남점",
      timezone: "Asia/Seoul",
    };
  });
  const rows = () =>
    buildReminderNotifications(
      snapshot,
      [fixture.person.userId, fixture.stranger.userId],
      now,
    );
  it("inserts recipients and reminder offsets together in one SQL statement", async () => {
    const queries: string[] = [];
    const db = drizzle({
      client: database.client,
      schema,
      logger: {
        logQuery(query) {
          queries.push(query);
        },
      },
    });
    await insertNotifications(rows(), db);
    expect(queries).toHaveLength(1);
    expect(await database.db.select().from(notifications)).toHaveLength(8);
  });
  it("sends no SQL for empty inserts or an explicit empty reminder recipient list", async () => {
    const queries: string[] = [];
    const db = drizzle({
      client: database.client,
      schema,
      logger: {
        logQuery(query) {
          queries.push(query);
        },
      },
    });
    await insertNotifications([], db);
    await deleteBookingReminders({ bookingId: snapshot.id, userIds: [] }, db);
    expect(queries).toEqual([]);
  });
  it("deletes all selected recipients' reminders without removing event notifications", async () => {
    await insertNotifications(
      [
        ...rows(),
        ...buildBookingNotifications({
          type: "booking_invited",
          booking: snapshot,
          actor: { id: fixture.person.userId, name: fixture.person.name },
          userIds: [fixture.stranger.userId],
          now,
        }),
      ],
      database.db,
    );
    await deleteBookingReminders(
      { bookingId: snapshot.id, userIds: [fixture.stranger.userId] },
      database.db,
    );
    const remaining = await database.db.select().from(notifications);
    expect(remaining).toHaveLength(5);
    expect(
      remaining
        .filter(({ type }) => type === "booking_reminder")
        .every(({ userId }) => userId === fixture.person.userId),
    ).toBe(true);
    expect(
      remaining.filter(({ type }) => type === "booking_invited"),
    ).toHaveLength(1);
  });
  it("deletes one booking's reminders but no other booking's", async () => {
    const other = await insertFixtureBooking(database, fixture, {
      during: bookingRange("14:00", "15:00"),
    });
    await insertNotifications(
      [
        ...rows(),
        ...buildReminderNotifications(
          { ...snapshot, id: other.id, during: other.during },
          [fixture.person.userId],
          now,
        ),
      ],
      database.db,
    );
    await deleteBookingReminders({ bookingId: snapshot.id }, database.db);
    const remaining = await database.db.select().from(notifications);
    expect(remaining).toHaveLength(4);
    expect(remaining.every(({ bookingId }) => bookingId === other.id)).toBe(
      true,
    );
  });
  it("rolls reminder deletion back with the surrounding transaction", async () => {
    await insertNotifications(rows(), database.db);
    await expect(
      database.db.transaction(async (tx) => {
        await deleteBookingReminders({ bookingId: snapshot.id }, tx);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await database.db.select().from(notifications)).toHaveLength(8);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bookingParticipants, chatRooms, notifications } from "@/lib/db/schema";
import { createBookingQueries } from "@/features/bookings/query-factory";
import { createNotificationQueries } from "@/features/notifications/query-factory";
import {
  bookingDate,
  bookingNow,
  bookingRange,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

describe("meeting entry joins preserve booking visibility and query budgets", () => {
  let db: TestDatabase;
  let actors: BookingActors;
  beforeAll(async () => {
    db = await createTestDatabase();
  });
  afterAll(async () => {
    await db.client.close();
  });
  beforeEach(async () => {
    actors = await seedBookingActors(db);
  });
  function queries(invited = false) {
    return createBookingQueries({
      database: db.db,
      requireSession: async () => (invited ? actors.member : actors.person),
      now: () => bookingNow,
    });
  }

  it("adds one nullable room ID using the same SQL and does not grant a bystander a booking", async () => {
    const booking = await insertFixtureBooking(db, actors);
    await db.db
      .insert(bookingParticipants)
      .values({
        bookingId: booking.id,
        userId: actors.member.userId,
        createdAt: bookingNow,
      });
    const meter = createQueryMeter(db.client);
    try {
      meter.start();
      const before = await queries().getMyBookings();
      const baseline = meter.stop();
      expect(before.upcoming[0]).toMatchObject({
        id: booking.id,
        meetingRoomId: null,
      });
      const [room] = await db.db
        .insert(chatRooms)
        .values({ kind: "meeting", bookingId: booking.id })
        .returning();
      meter.start();
      const after = await queries().getMyBookings();
      expect(meter.stop()).toEqual(baseline);
      expect(after.upcoming).toHaveLength(1);
      expect(after.upcoming[0]).toMatchObject({
        id: booking.id,
        meetingRoomId: room!.id,
      });
      const invited = await queries(true).getMyBookings();
      expect(invited.upcoming[0]).toMatchObject({
        id: booking.id,
        meetingRoomId: room!.id,
        relation: "invited",
        photo: null,
      });
      const month = await queries(true).getMyBookingsMonth({
        month: bookingDate.slice(0, 7),
        day: bookingDate,
      });
      expect(month.bookings[0]).toMatchObject({
        meetingRoomId: room!.id,
        photo: null,
      });
      expect(
        (await queries().getHomeUpcomingBookings()).bookings[0],
      ).toMatchObject({ meetingRoomId: room!.id });
      const stranger = createBookingQueries({
        database: db.db,
        requireSession: async () => actors.stranger,
        now: () => bookingNow,
      });
      expect((await stranger.getMyBookings()).upcoming).toEqual([]);
    } finally {
      meter.restore();
    }
  });

  it("keeps a cancelled booking's meeting entry and leaves a desk without one", async () => {
    const cancelled = await insertFixtureBooking(db, actors, {
      status: "cancelled",
      cancelledAt: bookingNow,
      cancelledBy: actors.person.userId,
      during: bookingRange("10:00", "11:00"),
    });
    const [room] = await db.db
      .insert(chatRooms)
      .values({ kind: "meeting", bookingId: cancelled.id })
      .returning();
    const desk = await insertFixtureBooking(db, actors, {
      spaceId: actors.deskId,
    });
    const result = await queries().getMyBookings();
    expect(result.past.find(({ id }) => id === cancelled.id)).toMatchObject({
      meetingRoomId: room!.id,
    });
    expect(result.upcoming.find(({ id }) => id === desk.id)).toMatchObject({
      meetingRoomId: null,
      desk: { id: actors.deskId },
    });
  });

  it("returns the meeting destination from both reminder queries without adding reads", async () => {
    const booking = await insertFixtureBooking(db, actors);
    await db.db
      .insert(notifications)
      .values({
        userId: actors.person.userId,
        bookingId: booking.id,
        type: "booking_reminder",
        scheduledFor: bookingNow,
        expiresAt: booking.during.end,
        data: {
          spaceName: "회의실",
          floorName: "7F",
          branchName: "강남점",
          timezone: "Asia/Seoul",
          start: booking.during.start.toISOString(),
          end: booking.during.end.toISOString(),
          minutesBefore: 0,
        },
      });
    const read = createNotificationQueries({
      database: db.db,
      requireSession: async () => actors.person,
      now: () => bookingNow,
    });
    const meter = createQueryMeter(db.client);
    try {
      meter.start();
      expect((await read.getNotificationSummary()).items[0]).toMatchObject({
        bookingId: booking.id,
        href: `/m/${booking.id}`,
      });
      expect(meter.stop().perStage).toEqual([3]);
      meter.start();
      expect((await read.getNotifications()).items[0]).toMatchObject({
        bookingId: booking.id,
        href: `/m/${booking.id}`,
      });
      expect(meter.stop().perStage).toEqual([2]);
    } finally {
      meter.restore();
    }
  });
});

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBookingQueries } from "@/features/bookings/query-factory";
import { bookingParticipants, bookings, spacePhotos } from "@/lib/db/schema";
import { sumBookedMinutes, listMyBranchBookingDates } from "@/lib/dal/bookings";
import { bookingDayRange } from "@/features/bookings/rules";
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

describe("invited booking query boundaries", () => {
  let database: TestDatabase;
  let fixture: BookingActors;
  let id: string;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    fixture = await seedBookingActors(database);
    const booking = await insertFixtureBooking(database, fixture, {
      userId: fixture.admin.userId,
      spaceId: fixture.restrictedSpaceId,
      title: "초대 모임",
      attendeeCount: 3,
      during: bookingRange("14:00", "15:00"),
    });
    id = booking.id;
    await database.db.insert(bookingParticipants).values([
      { bookingId: id, userId: fixture.person.userId },
      { bookingId: id, userId: fixture.stranger.userId },
    ]);
    await database.db.insert(spacePhotos).values({
      spaceId: fixture.restrictedSpaceId,
      path: "/seed/photos/meeting-a-01.webp",
      alt: "전용 회의실",
      sortOrder: 0,
    });
  });
  const query = (session = fixture.person) =>
    createBookingQueries({
      database: database.db,
      requireSession: async () => session,
      now: () => bookingNow,
    });
  it("exposes the explicitly invited private room but never its photo or other identities", async () => {
    const result = await query().getMyBookings();
    expect(result.upcoming).toHaveLength(1);
    expect(result.upcoming[0]).toMatchObject({
      id,
      relation: "invited",
      invitedByName: fixture.admin.name,
      participantNames: [fixture.person.name, fixture.stranger.name],
      spaceName: "회의실 A",
      title: "초대 모임",
      attendeeCount: 3,
      photo: null,
    });
    expect(result.upcoming[0]).not.toHaveProperty("canCancel");
    const serialized = JSON.stringify(result);
    for (const actor of [fixture.admin, fixture.person, fixture.stranger]) {
      expect(serialized).not.toContain(actor.email);
      expect(serialized).not.toContain(actor.userId);
    }
    expect(serialized).not.toContain("meeting-a-01.webp");
    await expect(
      query().getSpaceDay(
        fixture.branchId,
        fixture.floorId,
        fixture.restrictedSpaceId,
        bookingDate,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("retains the owner's photo and sorted participant names without expanding floor title visibility", async () => {
    const owned = await query(fixture.admin).getMyBookings();
    expect(owned.upcoming[0]).toMatchObject({
      relation: "owner",
      invitedByName: null,
      photo: { path: "/seed/photos/meeting-a-01.webp" },
      participantNames: [fixture.person.name, fixture.stranger.name],
    });
    await database.db
      .update(bookings)
      .set({ spaceId: fixture.publicSpaceId })
      .where(eq(bookings.id, id));
    const day = await query().getSpaceDay(
      fixture.branchId,
      fixture.floorId,
      fixture.publicSpaceId,
      bookingDate,
    );
    expect(day?.bookings[0]).toMatchObject({ isMine: false, canCancel: false });
    expect(day?.bookings[0]).not.toHaveProperty("title");
    expect(day?.bookings[0]).not.toHaveProperty("attendeeCount");
  });
  it("includes invitations in calendar and upcoming cards with cancellation disabled", async () => {
    const calendar = await query().getMyBookingsMonth({
      month: "2026-10",
      day: bookingDate,
    });
    const next = await query().getHomeUpcomingBookings();
    for (const data of [calendar, next])
      expect(data.bookings).toEqual([
        expect.objectContaining({
          id,
          relation: "invited",
          canCancel: false,
          photo: null,
        }),
      ]);
    const owner = await query(fixture.admin).getMyBookingsMonth({
      month: "2026-10",
    });
    expect(owner.bookings[0]?.canCancel).toBe(true);
  });
  it("includes invitations in weekly cards with exactly the existing nine safe keys", async () => {
    const result = await query().getHomeWeekBookings();
    const booking = result.days
      .flatMap(({ bookings }) => bookings)
      .find((row) => row.id === id);
    expect(booking).toBeDefined();
    expect(Object.keys(booking!).sort()).toEqual(
      [
        "id",
        "start",
        "end",
        "date",
        "timezone",
        "branchId",
        "floorId",
        "spaceId",
        "spaceName",
      ].sort(),
    );
  });
  it("shows cancelled invitations in past and removes left reservations from every personal query", async () => {
    await database.db
      .update(bookings)
      .set({
        status: "cancelled",
        cancelledAt: bookingNow,
        cancelledBy: fixture.admin.userId,
      })
      .where(eq(bookings.id, id));
    expect((await query().getMyBookings()).past).toEqual([
      expect.objectContaining({ id, status: "cancelled", relation: "invited" }),
    ]);
    await database.db
      .delete(bookingParticipants)
      .where(
        and(
          eq(bookingParticipants.bookingId, id),
          eq(bookingParticipants.userId, fixture.person.userId),
        ),
      );
    expect(await query().getMyBookings()).toMatchObject({
      upcoming: [],
      past: [],
    });
    expect(
      (await query().getMyBookingsMonth({ month: "2026-10" })).bookings,
    ).toEqual([]);
    expect((await query().getHomeUpcomingBookings()).bookings).toEqual([]);
    expect(
      (await query().getHomeWeekBookings()).days.flatMap(
        ({ bookings }) => bookings,
      ),
    ).toEqual([]);
  });
  it("does not include invited time in quotas or toolbar booking dates", async () => {
    expect(
      await sumBookedMinutes(
        {
          branchId: fixture.branchId,
          during: bookingDayRange(bookingDate, "Asia/Seoul"),
          actor: { userId: fixture.person.userId },
        },
        database.db,
      ),
    ).toBe(0);
    expect(
      await listMyBranchBookingDates(
        {
          userId: fixture.person.userId,
          branchId: fixture.branchId,
          today: bookingDate,
          timezone: "Asia/Seoul",
        },
        database.db,
      ),
    ).toEqual([]);
  });
  it("keeps read budgets constant with many participants and shared personal bookings", async () => {
    const meter = createQueryMeter(database.client);
    try {
      const methods = [
        () => query().getMyBookings(),
        () => query().getMyBookingsMonth({ month: "2026-10" }),
        () => query().getHomeUpcomingBookings(),
        () => query().getHomeWeekBookings(),
      ];
      const baseline = [];
      for (const read of methods) {
        meter.start();
        await read();
        baseline.push(meter.stop().perStage);
      }
      await database.db.insert(bookingParticipants).values([
        { bookingId: id, userId: fixture.member.userId },
        { bookingId: id, userId: fixture.otherMember.userId },
      ]);
      for (const [index, read] of methods.entries()) {
        meter.start();
        await read();
        expect(meter.stop().perStage).toEqual(baseline[index]);
      }
    } finally {
      meter.restore();
    }
  });
});

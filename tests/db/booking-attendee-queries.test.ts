import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBookingQueries } from "@/features/bookings/query-factory";
import type { Session } from "@/lib/auth/types";
import {
  bookingDate,
  bookingNow,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("attendee count visibility", () => {
  let database: TestDatabase;
  let fixture: BookingActors;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    fixture = await seedBookingActors(database);
    await insertFixtureBooking(database, fixture, {
      userId: fixture.admin.userId,
      teamId: fixture.teamId,
      attendeeCount: 3,
      title: "팀 계획",
    });
  });
  const queries = (session: Session) =>
    createBookingQueries({
      database: database.db,
      requireSession: async () => session,
      now: () => bookingNow,
    });
  it("only exposes the count to the owner, teammate and branch operator", async () => {
    for (const session of [fixture.admin, fixture.member, fixture.operator]) {
      const data = await queries(session).getSpaceDay(
        fixture.branchId,
        fixture.floorId,
        fixture.publicSpaceId,
        bookingDate,
      );
      expect(data.bookings[0]).toMatchObject({
        title: "팀 계획",
        attendeeCount: 3,
      });
    }
    for (const session of [
      fixture.stranger,
      fixture.otherMember,
      fixture.otherOperator,
    ]) {
      const data = await queries(session).getSpaceDay(
        fixture.branchId,
        fixture.floorId,
        fixture.publicSpaceId,
        bookingDate,
      );
      expect(Object.hasOwn(data.bookings[0]!, "attendeeCount")).toBe(false);
      expect(Object.hasOwn(data.bookings[0]!, "title")).toBe(false);
    }
  });
  it("keeps counts out of floor intervals", async () => {
    const data = await queries(fixture.admin).getFloorDay(
      fixture.branchId,
      fixture.floorId,
      bookingDate,
    );
    expect(JSON.stringify(data)).not.toContain("attendeeCount");
  });
  it("exposes the count in own list, calendar and next bookings", async () => {
    const query = queries(fixture.admin);
    const list = await query.getMyBookings();
    expect(list.upcoming[0]).toMatchObject({ attendeeCount: 3 });
    const calendar = await query.getMyBookingsMonth({
      month: bookingDate.slice(0, 7),
      day: bookingDate,
    });
    expect(calendar.bookings[0]).toMatchObject({ attendeeCount: 3 });
    const home = await query.getHomeUpcomingBookings();
    expect(home.bookings[0]).toMatchObject({ attendeeCount: 3 });
  });
});

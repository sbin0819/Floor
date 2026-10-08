import { eq, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createBookingQueries } from "@/features/bookings/query-factory";
import * as bookingDal from "@/lib/dal/bookings";
import * as deskDal from "@/lib/dal/desks";
import * as floorDeskDal from "@/lib/dal/desk-floor";
import { spaces, spaceBlocks, spacePhotos } from "@/lib/db/schema";
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

describe("desk query paths and exposure", () => {
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
  });
  afterEach(() => vi.restoreAllMocks());
  const queries = () =>
    createBookingQueries({
      database: database.db,
      requireSession: async () => fixture.person,
      now: () => bookingNow,
    });
  const detail = () =>
    queries().getSpaceDay(
      fixture.branchId,
      fixture.floorId,
      fixture.deskAreaId,
      bookingDate,
    );
  it("loads both desk query paths in two stages with no more than six statements per stage", async () => {
    const meter = createQueryMeter(database.client);
    try {
      for (const [query, expected] of [
        [
          () =>
            queries().getFloorDay(
              fixture.branchId,
              fixture.floorId,
              bookingDate,
            ),
          [6, 4],
        ],
        [detail, [6, 6]],
      ] as const) {
        meter.start();
        await query();
        expect(meter.stop().perStage).toEqual(expected);
      }
    } finally {
      meter.restore();
    }
  });
  it("does not read room schedules or minute quotas on the desk path", async () => {
    const schedule = vi.spyOn(bookingDal, "listSpaceBookings");
    const sums = vi.spyOn(bookingDal, "sumActorBookedMinutes");
    const result = await detail();
    expect(result.desk?.seats).toHaveLength(2);
    expect(result.bookings).toEqual([]);
    expect(result.blocks).toEqual([]);
    expect(schedule).not.toHaveBeenCalled();
    expect(sums).not.toHaveBeenCalled();
    expect(result.actors[0]).toMatchObject({
      remainingMinutes: null,
      limits: { maxDaysAhead: 7 },
    });
  });
  it("does not add statements for many more desk areas or seats", async () => {
    const extraAreas = Array.from({ length: 8 }, (_, i) => ({
      id: crypto.randomUUID(),
      floorId: fixture.floorId,
      type: "desk_area" as const,
      name: `추가 구역 ${i}`,
      bookable: false,
    }));
    await database.db.insert(spaces).values(extraAreas);
    await database.db.insert(spaces).values(
      extraAreas.flatMap((area) =>
        Array.from({ length: 8 }, (_, i) => ({
          floorId: fixture.floorId,
          parentId: area.id,
          type: "desk" as const,
          name: `${area.name} 자리 ${i}`,
        })),
      ),
    );
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      const result = await queries().getFloorDay(
        fixture.branchId,
        fixture.floorId,
        bookingDate,
      );
      expect(meter.stop().perStage).toEqual([6, 4]);
      for (const area of extraAreas)
        expect(result.spaces.find(({ id }) => id === area.id)).toMatchObject({
          deskCount: 8,
        });
    } finally {
      meter.restore();
    }
  });
  it("returns only seat state and the current user's booking details", async () => {
    const own = await insertFixtureBooking(database, fixture, {
      spaceId: fixture.deskId,
      during: bookingRange("09:00", "13:00"),
    });
    const other = await insertFixtureBooking(database, fixture, {
      spaceId: fixture.otherDeskId,
      userId: fixture.stranger.userId,
      teamId: fixture.teamId,
      during: bookingRange("09:00", "13:00"),
    });
    const result = await detail();
    expect(result.desk?.myBookings).toEqual([
      expect.objectContaining({
        id: own.id,
        deskId: fixture.deskId,
        part: "am",
        canCancel: true,
      }),
    ]);
    expect(
      result.desk?.seats.find(({ id }) => id === fixture.deskId)?.states,
    ).toMatchObject({ am: "mine", pm: "free", day: "mine" });
    expect(
      result.desk?.seats.find(({ id }) => id === fixture.otherDeskId)?.states,
    ).toMatchObject({ am: "booked", pm: "free", day: "booked" });
    const encoded = JSON.stringify(result.desk);
    for (const value of [
      fixture.stranger.userId,
      fixture.stranger.name,
      fixture.teamId,
      other.id,
    ])
      expect(encoded).not.toContain(value);
  });
  it("never reads any desk information for an inaccessible area", async () => {
    await database.db
      .update(spaces)
      .set({ access: "closed" })
      .where(eq(spaces.id, fixture.deskAreaId));
    const desks = vi.spyOn(deskDal, "listDesks");
    const schedule = vi.spyOn(deskDal, "listDeskBookings");
    const combined = vi.spyOn(floorDeskDal, "readFloorDeskSchedule");
    const data = await queries().getFloorDay(
      fixture.branchId,
      fixture.floorId,
      bookingDate,
    );
    expect(data.spaces.find(({ id }) => id === fixture.deskAreaId)).toEqual({
      kind: "restricted",
      id: fixture.deskAreaId,
      type: "desk_area",
    });
    for (const [ids] of desks.mock.calls)
      expect(ids).not.toContain(fixture.deskAreaId);
    for (const [input] of schedule.mock.calls)
      expect(input.parentIds).not.toContain(fixture.deskAreaId);
    expect(combined).toHaveBeenCalled();
    for (const [input] of combined.mock.calls)
      expect(input.parentIds).not.toContain(fixture.deskAreaId);
    expect(JSON.stringify(data)).not.toContain(fixture.deskId);
    await expect(detail()).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("uses area blocks and unavailable desks with the documented priority", async () => {
    await database.db
      .update(spaces)
      .set({ bookable: false })
      .where(eq(spaces.id, fixture.deskId));
    await database.db.insert(spaceBlocks).values({
      spaceId: fixture.deskAreaId,
      createdBy: fixture.operator.userId,
      during: bookingRange("09:00", "13:00"),
    });
    const result = await detail();
    expect(
      result.desk?.seats.find(({ id }) => id === fixture.deskId)?.states.am,
    ).toBe("unavailable");
    expect(
      result.desk?.seats.find(({ id }) => id === fixture.otherDeskId)?.states
        .am,
    ).toBe("blocked");
    expect(
      result.desk?.parts.find(({ part }) => part === "am")?.freeCount,
    ).toBe(0);
  });
  it("keeps empty unbookable areas on the desk path and bookable areas on the room path", async () => {
    await database.db
      .update(spaces)
      .set({ archivedAt: bookingNow })
      .where(sql`${spaces.parentId} = ${fixture.deskAreaId}`);
    expect((await detail()).desk?.seats).toEqual([]);
    await database.db
      .update(spaces)
      .set({ bookable: true })
      .where(eq(spaces.id, fixture.deskAreaId));
    expect((await detail()).desk).toBeNull();
  });
  it("maps own desk bookings to the parent metadata and photo for list, calendar, home and week", async () => {
    const booked = await insertFixtureBooking(database, fixture, {
      spaceId: fixture.deskId,
      during: bookingRange("09:00", "13:00"),
    });
    const photo = {
      path: "/seed/photos/meeting-small-sage.webp",
      alt: "구역 사진",
    };
    await database.db
      .insert(spacePhotos)
      .values({ spaceId: fixture.deskAreaId, ...photo, sortOrder: 0 });
    const expected = {
      id: booked.id,
      spaceId: fixture.deskAreaId,
      spaceType: "desk_area",
      photo,
      desk: { id: fixture.deskId, name: "좌석 1", part: "am" },
    };
    expect((await queries().getMyBookings()).upcoming[0]).toMatchObject(
      expected,
    );
    expect(
      (
        await queries().getMyBookingsMonth({
          month: "2026-10",
          day: bookingDate,
        })
      ).bookings[0],
    ).toMatchObject(expected);
    expect(
      (await queries().getHomeUpcomingBookings()).bookings[0],
    ).toMatchObject(expected);
    const week = (await queries().getHomeWeekBookings()).days.flatMap(
      ({ bookings }) => bookings,
    )[0]!;
    expect(week.spaceId).toBe(fixture.deskAreaId);
    expect(Object.keys(week).sort()).toEqual(
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
});

import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createAdminActions } from "@/features/admin/manage-factory";
import { bookingDayRange } from "@/features/bookings/rules";
import { countActiveBookings } from "@/lib/dal/admin";
import { listMyWeekBookings } from "@/lib/dal/booking-home";
import {
  cancelBookingRecord,
  listMyUpcomingBookings,
  sumActorBookedMinutes,
  sumBookedMinutes,
} from "@/lib/dal/bookings";
import {
  getDeskForAccess,
  hasUserDeskBookingOverlap,
  listDeskBlocks,
  listDeskBookings,
  listDesks,
  listFloorSeats,
} from "@/lib/dal/desks";
import { floorPlans, floors, spaceBlocks, spaces } from "@/lib/db/schema";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";
import {
  bookingNow,
  bookingRange,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("desk DAL and parent protections", () => {
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
  const during = bookingRange("09:00", "22:00");

  it("reads area access instead of any seat-level access", async () => {
    await database.db
      .update(spaces)
      .set({ access: "closed" })
      .where(eq(spaces.id, fixture.deskId));
    const row = await getDeskForAccess(fixture.deskId, database.db);
    expect(row?.desk.access).toBe("closed");
    expect(row?.area).toMatchObject({
      id: fixture.deskAreaId,
      access: null,
      allowedTeamIds: [],
      floor: { id: fixture.floorId, branchId: fixture.branchId },
    });
  });
  it.each([
    "not-desk",
    "archived-desk",
    "archived-area",
    "bookable-area",
    "wrong-floor",
    "wrong-parent-kind",
    "missing-parent",
  ])("rejects invalid desk hierarchy %s", async (kind) => {
    if (kind === "not-desk")
      expect(
        await getDeskForAccess(fixture.publicSpaceId, database.db),
      ).toBeNull();
    else {
      if (kind === "archived-desk")
        await database.db
          .update(spaces)
          .set({ archivedAt: bookingNow })
          .where(eq(spaces.id, fixture.deskId));
      if (kind === "archived-area")
        await database.db
          .update(spaces)
          .set({ archivedAt: bookingNow })
          .where(eq(spaces.id, fixture.deskAreaId));
      if (kind === "bookable-area")
        await database.db
          .update(spaces)
          .set({ bookable: true })
          .where(eq(spaces.id, fixture.deskAreaId));
      if (kind === "wrong-floor")
        await database.db
          .update(spaces)
          .set({ floorId: fixture.otherFloorId })
          .where(eq(spaces.id, fixture.deskId));
      if (kind === "wrong-parent-kind")
        await database.db
          .update(spaces)
          .set({ parentId: fixture.publicSpaceId })
          .where(eq(spaces.id, fixture.deskId));
      if (kind === "missing-parent")
        await database.db
          .update(spaces)
          .set({ parentId: null })
          .where(eq(spaces.id, fixture.deskId));
      expect(await getDeskForAccess(fixture.deskId, database.db)).toBeNull();
    }
  });
  it("bulk-reads only active seats and confirmed ranges for the authorized area IDs", async () => {
    const row = await insertFixtureBooking(database, fixture, {
      spaceId: fixture.deskId,
    });
    await insertFixtureBooking(database, fixture, {
      spaceId: fixture.otherDeskId,
      status: "cancelled",
      cancelledAt: bookingNow,
    });
    await insertFixtureBooking(database, fixture);
    expect(await listDesks([fixture.deskAreaId], database.db)).toHaveLength(2);
    expect(
      await listDeskBookings(
        { parentIds: [fixture.deskAreaId], during },
        database.db,
      ),
    ).toEqual([
      {
        id: row.id,
        spaceId: fixture.deskId,
        parentId: fixture.deskAreaId,
        userId: fixture.person.userId,
        teamId: null,
        during: row.during,
      },
    ]);
    await database.db
      .update(spaces)
      .set({ archivedAt: bookingNow })
      .where(eq(spaces.id, fixture.otherDeskId));
    expect(await listDesks([fixture.deskAreaId], database.db)).toHaveLength(1);
    expect(await listDesks([], database.db)).toEqual([]);
    expect(
      await listDeskBookings({ parentIds: [], during }, database.db),
    ).toEqual([]);
  });
  it("reads area and child maintenance together without unrelated blocks", async () => {
    for (const spaceId of [
      fixture.deskAreaId,
      fixture.deskId,
      fixture.publicSpaceId,
    ])
      await database.db
        .insert(spaceBlocks)
        .values({ spaceId, createdBy: fixture.operator.userId, during });
    const rows = await listDeskBlocks(
      { parentIds: [fixture.deskAreaId], during },
      database.db,
    );
    expect(rows.map(({ spaceId }) => spaceId).sort()).toEqual(
      [fixture.deskAreaId, fixture.deskId].sort(),
    );
    expect(rows.every(({ parentId }) => parentId === fixture.deskAreaId)).toBe(
      true,
    );
    expect(
      await listDeskBlocks({ parentIds: [], during }, database.db),
    ).toEqual([]);
  });
  it("counts personal and team desk overlaps across branches, excluding cancellation and adjacent halves", async () => {
    const row = await insertFixtureBooking(database, fixture, {
      spaceId: fixture.deskId,
      teamId: fixture.teamId,
      during: bookingRange("09:00", "13:00"),
    });
    expect(
      await hasUserDeskBookingOverlap(
        fixture.person.userId,
        bookingRange("13:00", "22:00"),
        database.db,
      ),
    ).toBe(false);
    expect(
      await hasUserDeskBookingOverlap(
        fixture.person.userId,
        during,
        database.db,
      ),
    ).toBe(true);
    expect(
      await hasUserDeskBookingOverlap(
        fixture.stranger.userId,
        during,
        database.db,
      ),
    ).toBe(false);
    await database.db
      .update(spaces)
      .set({ floorId: fixture.otherFloorId })
      .where(eq(spaces.id, fixture.deskId));
    expect(
      await hasUserDeskBookingOverlap(
        fixture.person.userId,
        during,
        database.db,
      ),
    ).toBe(true);
    await cancelBookingRecord(
      { bookingId: row.id, userId: fixture.person.userId, now: bookingNow },
      database.db,
    );
    expect(
      await hasUserDeskBookingOverlap(
        fixture.person.userId,
        during,
        database.db,
      ),
    ).toBe(false);
  });
  it("excludes every desk booking from individual and aggregated quota minutes", async () => {
    await insertFixtureBooking(database, fixture, {
      spaceId: fixture.deskId,
      during,
    });
    await insertFixtureBooking(database, fixture, {
      spaceId: fixture.otherDeskId,
      during,
      teamId: fixture.teamId,
    });
    await insertFixtureBooking(database, fixture, {
      during: bookingRange("13:00", "14:00"),
    });
    const day = bookingDayRange("2026-10-07", "Asia/Seoul");
    expect(
      await sumBookedMinutes(
        {
          branchId: fixture.branchId,
          during: day,
          actor: { userId: fixture.person.userId },
        },
        database.db,
      ),
    ).toBe(60);
    expect(
      await sumBookedMinutes(
        {
          branchId: fixture.branchId,
          during: day,
          actor: { teamId: fixture.teamId },
        },
        database.db,
      ),
    ).toBe(0);
    expect(
      await sumActorBookedMinutes(
        {
          branchId: fixture.branchId,
          during: day,
          userId: fixture.person.userId,
          teamIds: [fixture.teamId],
          includePersonal: true,
        },
        database.db,
      ),
    ).toEqual([{ teamId: null, minutes: 60 }]);
  });
  it("blocks area archive while a child desk is in use, then permits archive after cancellation", async () => {
    const booking = await insertFixtureBooking(database, fixture, {
      spaceId: fixture.deskId,
    });
    expect(
      await countActiveBookings(fixture.deskAreaId, bookingNow, database.db),
    ).toBe(1);
    const actions = createAdminActions({
      database: database.db,
      getSession: async () => fixture.operator,
      now: () => bookingNow,
      logError: vi.fn(),
    });
    expect(await actions.archiveSpace({ spaceId: fixture.deskAreaId })).toEqual(
      { ok: false, code: "SPACE_IN_USE" },
    );
    await cancelBookingRecord(
      { bookingId: booking.id, userId: fixture.person.userId, now: bookingNow },
      database.db,
    );
    expect(
      (await actions.archiveSpace({ spaceId: fixture.deskAreaId })).ok,
    ).toBe(true);
  });
  it("does not count ended child bookings when archiving", async () => {
    await insertFixtureBooking(database, fixture, {
      spaceId: fixture.deskId,
      during: bookingRange("09:00", "10:00"),
    });
    expect(
      await countActiveBookings(fixture.deskAreaId, bookingNow, database.db),
    ).toBe(0);
  });
  it("reads seats alone from the published floor pointer and returns an empty list without it", async () => {
    expect(await listFloorSeats(fixture.floorId, database.db)).toEqual([]);
    const document: FloorPlanDocument = {
      schema: 1,
      unit: "mm",
      bounds: { w: 1000, h: 1000 },
      walls: [],
      openings: [],
      spaces: [],
      fixtures: [],
      seats: [
        {
          id: "seat",
          spaceId: fixture.deskId,
          at: [100, 100],
          size: [50, 50],
          rotation: 0,
        },
      ],
    };
    const [plan] = await database.db
      .insert(floorPlans)
      .values({
        floorId: fixture.floorId,
        version: 1,
        status: "published",
        document,
        createdBy: fixture.operator.userId,
      })
      .returning();
    await database.db
      .update(floors)
      .set({ publishedPlanId: plan!.id })
      .where(eq(floors.id, fixture.floorId));
    expect(await listFloorSeats(fixture.floorId, database.db)).toEqual(
      document.seats,
    );
  });
  it("keeps the original desk for mapping but joins its parent for history and week identity", async () => {
    const booking = await insertFixtureBooking(database, fixture, {
      spaceId: fixture.deskId,
    });
    const rows = await listMyUpcomingBookings(
      fixture.person.userId,
      bookingNow,
      database.db,
    );
    expect(rows[0]?.space.id).toBe(fixture.deskId);
    expect(rows[0]?.area?.id).toBe(fixture.deskAreaId);
    const week = await listMyWeekBookings(
      { userId: fixture.person.userId, start: during.start, end: during.end },
      database.db,
    );
    expect(week).toMatchObject([
      { id: booking.id, spaceId: fixture.deskAreaId, spaceName: "데스크 구역" },
    ]);
  });
});

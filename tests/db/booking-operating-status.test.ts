import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBookingQueries } from "@/features/bookings/query-factory";
import { branches, spaceBlocks, users } from "@/lib/db/schema";
import {
  bookingDate,
  bookingInstant,
  bookingRange,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("current space status is limited to branch operating hours", () => {
  let database: TestDatabase;
  let fixture: BookingActors;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  beforeEach(async () => {
    fixture = await seedBookingActors(database);
    await database.db
      .update(users)
      .set({ defaultBranchId: fixture.branchId })
      .where(eq(users.id, fixture.person.userId));
  });
  afterAll(async () => {
    await database?.client.close();
  });
  function queries(now: string) {
    return createBookingQueries({
      database: database.db,
      requireSession: async () => fixture.person,
      now: () => new Date(now),
    });
  }

  it.each([
    ["08:59", "before_open"],
    ["22:00", "after_close"],
    ["23:30", "after_close"],
  ])(
    "does not emit floor/detail statuses or free counts at %s",
    async (time, status) => {
      await database.db.insert(spaceBlocks).values({
        spaceId: fixture.publicSpaceId,
        during: bookingRange("00:00", "24:00"),
        createdBy: fixture.operator.userId,
      });
      const query = queries(bookingInstant(time));
      const floor = await query.getFloorDay(
        fixture.branchId,
        fixture.floorId,
        bookingDate,
      );
      const detail = await query.getSpaceDay(
        fixture.branchId,
        fixture.floorId,
        fixture.publicSpaceId,
        bookingDate,
      );
      const home = await query.getHomeFreeSpaces();
      const branch = (await query.getBranchList()).find(
        ({ id }) => id === fixture.branchId,
      );
      expect(floor.isToday).toBe(true);
      expect(floor.operatingState.status).toBe(status);
      expect(floor.groups.length).toBeGreaterThan(0);
      for (const group of floor.groups) expect(group.freeCount).toBeNull();
      const visible = floor.spaces.filter(
        (space) => space.kind === "accessible",
      );
      expect(visible.length).toBeGreaterThan(0);
      for (const space of visible) expect(space.status).toBeNull();
      expect(detail.space.status).toBeNull();
      expect(detail.blocks).toHaveLength(1);
      expect(home).toMatchObject({
        state: "outside_hours",
        freeCount: 0,
        spaces: [],
        operatingState: { status },
      });
      expect(branch).toMatchObject({
        freeSpaceCount: null,
        operatingState: { status },
      });
      expect(
        floor.spaces.find(({ id }) => id === fixture.restrictedSpaceId),
      ).toEqual({
        kind: "restricted",
        id: fixture.restrictedSpaceId,
        type: "meeting_room",
      });
    },
  );

  it.each(["09:00", "21:59"])(
    "keeps current statuses during the open half interval (%s)",
    async (time) => {
      const query = queries(bookingInstant(time));
      const floor = await query.getFloorDay(
        fixture.branchId,
        fixture.floorId,
        bookingDate,
      );
      const detail = await query.getSpaceDay(
        fixture.branchId,
        fixture.floorId,
        fixture.publicSpaceId,
        bookingDate,
      );
      expect(
        floor.spaces.find(({ id }) => id === fixture.publicSpaceId),
      ).toMatchObject({ status: "free" });
      expect(detail.space.status).toBe("free");
      expect(
        floor.groups.find(({ type }) => type === "meeting_room")?.freeCount,
      ).toBe(1);
    },
  );

  it("does not classify a holiday as free in any read model", async () => {
    const date = "2026-10-11";
    const query = queries(bookingInstant("12:00", date));
    const floor = await query.getFloorDay(
      fixture.branchId,
      fixture.floorId,
      date,
    );
    const detail = await query.getSpaceDay(
      fixture.branchId,
      fixture.floorId,
      fixture.publicSpaceId,
      date,
    );
    expect(floor.operatingState.status).toBe("closed");
    for (const space of floor.spaces)
      if (space.kind === "accessible") expect(space.status).toBeNull();
    for (const group of floor.groups) expect(group.freeCount).toBeNull();
    expect(detail.space.status).toBeNull();
    expect(await query.getHomeFreeSpaces()).toMatchObject({
      state: "outside_hours",
      spaces: [],
    });
    expect(
      (await query.getBranchList()).find(({ id }) => id === fixture.branchId)
        ?.freeSpaceCount,
    ).toBeNull();
  });

  it("keeps future day status absent even while the branch is currently open", async () => {
    const query = queries(bookingInstant("12:00"));
    const date = "2026-10-08";
    const floor = await query.getFloorDay(
      fixture.branchId,
      fixture.floorId,
      date,
    );
    const detail = await query.getSpaceDay(
      fixture.branchId,
      fixture.floorId,
      fixture.publicSpaceId,
      date,
    );
    expect(floor.isToday).toBe(false);
    expect(floor.operatingState.status).toBe("open");
    for (const space of floor.spaces)
      if (space.kind === "accessible") expect(space.status).toBeNull();
    for (const group of floor.groups) expect(group.freeCount).toBeNull();
    expect(detail.space.status).toBeNull();
  });

  it("uses the branch timezone for the opening boundary", async () => {
    await database.db
      .update(branches)
      .set({ timezone: "America/New_York" })
      .where(eq(branches.id, fixture.branchId));
    const query = queries("2026-10-07T12:59:00.000Z");
    const floor = await query.getFloorDay(
      fixture.branchId,
      fixture.floorId,
      bookingDate,
    );
    expect(floor.isToday).toBe(true);
    expect(floor.operatingState.status).toBe("before_open");
    for (const space of floor.spaces)
      if (space.kind === "accessible") expect(space.status).toBeNull();
    const detail = await query.getSpaceDay(
      fixture.branchId,
      fixture.floorId,
      fixture.publicSpaceId,
      bookingDate,
    );
    expect(detail.space.status).toBeNull();
  });
});

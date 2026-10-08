import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  archiveSpaceRecord,
  countActiveBookings,
  getTeamsByIds,
  insertFloor,
  insertSpace,
  listAdminSpaces,
  lockAdminFloor,
  lockAdminSpace,
  maxFloorSortOrder,
  replaceAccessGrants,
  restoreSpaceRecord,
  setFloorAccessRecord,
  setSpaceAccessRecord,
  updateBranchRecord,
  updateFloorRecord,
  updateSpaceRecord,
} from "@/lib/dal/admin";
import { withTransaction } from "@/lib/dal/database";
import { getFloorWithAccess } from "@/lib/dal/branches";
import { getDeskCounts } from "@/lib/dal/spaces";
import * as schema from "@/lib/db/schema";
import { accessGrants, bookings, branches, spaces } from "@/lib/db/schema";
import {
  bookingNow,
  bookingRange,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("operator administration DAL", () => {
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

  it("updates branch details without changing the timezone or existing bookings", async () => {
    const booking = await insertFixtureBooking(database, fixture);
    const input = {
      branchId: fixture.branchId,
      name: "변경 지점",
      address: null,
      openHours: {
        mon: null,
        tue: null,
        wed: { open: "14:00", close: "18:00" },
        thu: null,
        fri: null,
        sat: null,
        sun: null,
      },
      timezone: "America/New_York",
    };
    expect(await updateBranchRecord(input, database.db)).toMatchObject({
      name: input.name,
      address: null,
      timezone: "Asia/Seoul",
      openHours: input.openHours,
    });
    expect(await database.db.select().from(bookings)).toEqual([booking]);
    expect(
      await updateBranchRecord(
        { ...input, branchId: crypto.randomUUID() },
        database.db,
      ),
    ).toBeNull();
  });

  it("creates and updates floors, with null for an empty branch's maximum order", async () => {
    const [empty] = await database.db
      .insert(branches)
      .values({ name: "빈 지점" })
      .returning();
    if (!empty) throw new Error("Expected branch fixture.");
    expect(await maxFloorSortOrder(empty.id, database.db)).toBeNull();
    expect(await maxFloorSortOrder(fixture.branchId, database.db)).toBe(2);
    const first = await insertFloor(
      { branchId: empty.id, level: -1, name: "B1", sortOrder: 0 },
      database.db,
    );
    expect(first).toMatchObject({
      branchId: empty.id,
      level: -1,
      name: "B1",
      sortOrder: 0,
      access: "everyone",
      publishedPlanId: null,
    });
    expect(await maxFloorSortOrder(empty.id, database.db)).toBe(0);
    expect(
      await updateFloorRecord(
        { floorId: first.id, level: 1, name: "1F", sortOrder: 3 },
        database.db,
      ),
    ).toMatchObject({
      id: first.id,
      branchId: empty.id,
      level: 1,
      name: "1F",
      sortOrder: 3,
    });
    expect(await maxFloorSortOrder(empty.id, database.db)).toBe(3);
    expect(
      await updateFloorRecord(
        { floorId: crypto.randomUUID(), level: 2, name: "2F", sortOrder: 4 },
        database.db,
      ),
    ).toBeNull();
  });

  it("preserves the real floor and space unique constraint names for callers", async () => {
    await expect(
      insertFloor(
        { branchId: fixture.branchId, level: 7, name: "중복", sortOrder: 3 },
        database.db,
      ),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint: "floors_branch_id_level_unique" },
    });
    await expect(
      insertSpace(
        {
          floorId: fixture.floorId,
          type: "meeting_room",
          name: "회의실 B",
          capacity: 4,
          bookable: true,
          amenities: [],
        },
        database.db,
      ),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint: "spaces_floor_name_unique" },
    });
  });

  it("inserts only editable space values and retains safe defaults for separate state", async () => {
    const input = {
      floorId: fixture.floorId,
      type: "meeting_room" as const,
      name: "새 회의실",
      capacity: 5,
      bookable: true,
      amenities: ["monitor", "whiteboard"],
      parentId: fixture.deskAreaId,
      access: "closed",
      archivedAt: bookingNow,
      bookingRules: { unexpected: true },
    };
    const row = await insertSpace(input, database.db);
    expect(row).toMatchObject({
      floorId: fixture.floorId,
      type: "meeting_room",
      name: "새 회의실",
      capacity: 5,
      bookable: true,
      amenities: input.amenities,
      parentId: null,
      access: null,
      archivedAt: null,
      bookingRules: {},
    });
  });

  it("updates editable values without moving or changing a space's type or access", async () => {
    const input = {
      spaceId: fixture.publicSpaceId,
      name: "회의실 새 이름",
      capacity: 8,
      bookable: false,
      amenities: ["video_conf"],
      floorId: fixture.otherFloorId,
      type: "desk",
      access: "closed",
      archivedAt: bookingNow,
    };
    expect(await updateSpaceRecord(input, database.db)).toMatchObject({
      id: fixture.publicSpaceId,
      floorId: fixture.floorId,
      type: "meeting_room",
      access: null,
      archivedAt: null,
      name: input.name,
      capacity: 8,
      bookable: false,
      amenities: input.amenities,
    });
    expect(
      await updateSpaceRecord(
        { ...input, spaceId: crypto.randomUUID() },
        database.db,
      ),
    ).toBeNull();
  });

  it("archives and restores conditionally while preserving the first archive timestamp on a no-op", async () => {
    expect(
      await archiveSpaceRecord(fixture.publicSpaceId, bookingNow, database.db),
    ).toMatchObject({ id: fixture.publicSpaceId, archivedAt: bookingNow });
    expect(
      await archiveSpaceRecord(
        fixture.publicSpaceId,
        new Date(bookingNow.getTime() + 60_000),
        database.db,
      ),
    ).toBeNull();
    const [archived] = await database.db
      .select()
      .from(spaces)
      .where(eq(spaces.id, fixture.publicSpaceId));
    expect(archived?.archivedAt).toEqual(bookingNow);
    expect(
      await restoreSpaceRecord(fixture.publicSpaceId, database.db),
    ).toMatchObject({ id: fixture.publicSpaceId, archivedAt: null });
    expect(
      await restoreSpaceRecord(fixture.publicSpaceId, database.db),
    ).toBeNull();
    expect(
      await archiveSpaceRecord(crypto.randomUUID(), bookingNow, database.db),
    ).toBeNull();
    expect(
      await restoreSpaceRecord(crypto.randomUUID(), database.db),
    ).toBeNull();
  });

  it("propagates the active-name constraint when restoring a reused name", async () => {
    await archiveSpaceRecord(fixture.publicSpaceId, bookingNow, database.db);
    await insertSpace(
      {
        floorId: fixture.floorId,
        type: "meeting_room",
        name: "회의실 B",
        capacity: 4,
        bookable: true,
        amenities: [],
      },
      database.db,
    );
    await expect(
      restoreSpaceRecord(fixture.publicSpaceId, database.db),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint: "spaces_floor_name_unique" },
    });
  });

  it("scopes archived/desk options and returns only each space's own grants", async () => {
    await database.db
      .insert(accessGrants)
      .values({
        targetType: "floor",
        targetId: fixture.restrictedSpaceId,
        teamId: fixture.otherTeamId,
      });
    const visible = await listAdminSpaces(
      { floorId: fixture.floorId },
      database.db,
    );
    expect(visible).toHaveLength(5);
    expect(
      visible.find(({ id }) => id === fixture.restrictedSpaceId)
        ?.allowedTeamIds,
    ).toEqual([fixture.teamId]);
    const archived = await listAdminSpaces(
      { floorId: fixture.floorId, includeArchived: true },
      database.db,
    );
    expect(archived).toHaveLength(6);
    expect(
      archived.find(({ id }) => id === fixture.archivedSpaceId)?.archivedAt,
    ).toEqual(bookingNow);
    const desks = await listAdminSpaces(
      { floorId: fixture.floorId, includeDesks: true },
      database.db,
    );
    expect(desks).toHaveLength(7);
    expect(desks.find(({ id }) => id === fixture.deskId)?.type).toBe("desk");
    const all = await listAdminSpaces(
      { floorId: fixture.floorId, includeArchived: true, includeDesks: true },
      database.db,
    );
    expect(all).toHaveLength(8);
    expect(all.some(({ floorId }) => floorId !== fixture.floorId)).toBe(false);
    expect(
      await listAdminSpaces(
        {
          floorId: crypto.randomUUID(),
          includeArchived: true,
          includeDesks: true,
        },
        database.db,
      ),
    ).toEqual([]);
    expect(await getDeskCounts([fixture.deskAreaId], database.db)).toEqual([
      { parentId: fixture.deskAreaId, count: 2 },
    ]);
  });

  it("counts ongoing and future confirmed bookings only, using the injected end boundary", async () => {
    await insertFixtureBooking(database, fixture);
    await insertFixtureBooking(database, fixture, {
      during: bookingRange("14:00", "15:00"),
    });
    await insertFixtureBooking(database, fixture, {
      during: bookingRange("10:00", "11:00"),
    });
    await insertFixtureBooking(database, fixture, {
      during: {
        start: new Date(bookingNow.getTime() - 60_000),
        end: bookingNow,
      },
      spaceId: fixture.secondSpaceId,
    });
    await insertFixtureBooking(database, fixture, {
      status: "cancelled",
      cancelledAt: bookingNow,
    });
    await insertFixtureBooking(database, fixture, {
      spaceId: fixture.otherSpaceId,
    });
    expect(
      await countActiveBookings(fixture.publicSpaceId, bookingNow, database.db),
    ).toBe(2);
    expect(
      await countActiveBookings(fixture.secondSpaceId, bookingNow, database.db),
    ).toBe(0);
    expect(
      await countActiveBookings(
        fixture.publicSpaceId,
        bookingRange("15:00", "16:00").start,
        database.db,
      ),
    ).toBe(0);
    expect(
      await countActiveBookings(crypto.randomUUID(), bookingNow, database.db),
    ).toBe(0);
  });

  it("sets floor/space access independently without rewriting bookings", async () => {
    const booking = await insertFixtureBooking(database, fixture);
    expect(
      await setFloorAccessRecord(fixture.floorId, "closed", database.db),
    ).toMatchObject({ id: fixture.floorId, access: "closed" });
    expect(
      await setSpaceAccessRecord(fixture.publicSpaceId, "teams", database.db),
    ).toMatchObject({ id: fixture.publicSpaceId, access: "teams" });
    expect(
      await setSpaceAccessRecord(fixture.publicSpaceId, null, database.db),
    ).toMatchObject({ access: null });
    expect(
      await setFloorAccessRecord(crypto.randomUUID(), "everyone", database.db),
    ).toBeNull();
    expect(
      await setSpaceAccessRecord(crypto.randomUUID(), null, database.db),
    ).toBeNull();
    expect(await database.db.select().from(bookings)).toEqual([booking]);
  });

  it("reconciles scoped grants without replacing surviving IDs and deduplicates UUID case", async () => {
    const target = {
      targetType: "space" as const,
      targetId: fixture.restrictedSpaceId,
    };
    const [original] = await database.db
      .select()
      .from(accessGrants)
      .where(eq(accessGrants.targetId, target.targetId));
    expect(original).toBeDefined();
    await database.db.insert(accessGrants).values([
      {
        targetType: "floor",
        targetId: target.targetId,
        teamId: fixture.otherTeamId,
      },
      {
        targetType: "space",
        targetId: fixture.publicSpaceId,
        teamId: fixture.otherTeamId,
      },
    ]);
    await withTransaction(
      (tx) =>
        replaceAccessGrants(
          {
            ...target,
            teamIds: [
              fixture.teamId,
              fixture.otherTeamId,
              fixture.otherTeamId.toUpperCase(),
            ],
          },
          tx,
        ),
      database.db,
    );
    const rows = await database.db.select().from(accessGrants);
    expect(rows.find(({ id }) => id === original!.id)).toEqual(original);
    expect(
      rows.filter(
        ({ targetType, targetId }) =>
          targetType === "space" && targetId === target.targetId,
      ),
    ).toHaveLength(2);
    await withTransaction(
      (tx) =>
        replaceAccessGrants({ ...target, teamIds: [fixture.otherTeamId] }, tx),
      database.db,
    );
    expect(
      (await listAdminSpaces({ floorId: fixture.floorId }, database.db)).find(
        ({ id }) => id === target.targetId,
      )?.allowedTeamIds,
    ).toEqual([fixture.otherTeamId]);
    await withTransaction(
      (tx) => replaceAccessGrants({ ...target, teamIds: [] }, tx),
      database.db,
    );
    const remaining = await database.db.select().from(accessGrants);
    expect(remaining).toHaveLength(3);
    expect(
      remaining.some(
        ({ targetType, targetId }) =>
          targetType === "space" && targetId === target.targetId,
      ),
    ).toBe(false);
    expect(
      remaining.some(
        ({ targetType, targetId }) =>
          targetType === "floor" && targetId === target.targetId,
      ),
    ).toBe(true);
  });

  it("rolls back access and removed grants together if a replacement team is missing", async () => {
    const before = await getFloorWithAccess(
      fixture.restrictedFloorId,
      database.db,
    );
    await expect(
      withTransaction(async (tx) => {
        await lockAdminFloor(fixture.restrictedFloorId, "update", tx);
        await setFloorAccessRecord(fixture.restrictedFloorId, "closed", tx);
        await replaceAccessGrants(
          {
            targetType: "floor",
            targetId: fixture.restrictedFloorId,
            teamIds: [crypto.randomUUID()],
          },
          tx,
        );
      }, database.db),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(
      await getFloorWithAccess(fixture.restrictedFloorId, database.db),
    ).toEqual(before);
  });

  it("returns only team IDs and names, omits unknown IDs and handles an empty list", async () => {
    const rows = await getTeamsByIds(
      [
        fixture.teamId,
        fixture.teamId,
        fixture.otherTeamId,
        crypto.randomUUID(),
      ],
      database.db,
    );
    expect(rows).toEqual([
      { id: fixture.teamId, name: "그로스팀" },
      { id: fixture.otherTeamId, name: "플랫폼팀" },
    ]);
    for (const row of rows)
      expect(Object.keys(row).sort()).toEqual(["id", "name"]);
    expect(await getTeamsByIds([], database.db)).toEqual([]);
  });

  it.each(["share", "update"] as const)(
    "records floor FOR %s before space FOR UPDATE and state-conditional writes",
    async (mode) => {
      const statements: { query: string; params: unknown[] }[] = [];
      const logged = drizzle({
        client: database.client,
        schema,
        logger: {
          logQuery(query, params) {
            statements.push({ query, params });
          },
        },
      });
      await withTransaction(async (tx) => {
        expect(await lockAdminFloor(fixture.floorId, mode, tx)).toMatchObject({
          id: fixture.floorId,
        });
        expect(await lockAdminSpace(fixture.publicSpaceId, tx)).toMatchObject({
          id: fixture.publicSpaceId,
        });
        expect(
          await countActiveBookings(fixture.publicSpaceId, bookingNow, tx),
        ).toBe(0);
        await archiveSpaceRecord(fixture.publicSpaceId, bookingNow, tx);
        await restoreSpaceRecord(fixture.publicSpaceId, tx);
      }, logged);
      const locks = statements.filter(({ query }) =>
        /for (?:share|update)/u.test(query),
      );
      expect(locks).toHaveLength(2);
      expect(locks[0]?.query).toMatch(
        new RegExp(`from "floors".*for ${mode}`, "u"),
      );
      expect(locks[1]?.query).toMatch(/from "spaces".*for update/u);
      const writes = statements.filter(({ query }) =>
        query.startsWith('update "spaces"'),
      );
      expect(writes).toHaveLength(2);
      expect(writes[0]?.query).toMatch(
        /where .*"archived_at" is null.*returning/u,
      );
      expect(writes[1]?.query).toMatch(
        /where .*"archived_at" is not null.*returning/u,
      );
      expect(writes[0]?.params).toContain(bookingNow.toISOString());
      const active = statements.find(({ query }) =>
        query.includes('upper("bookings"."during")'),
      );
      expect(active?.query).toMatch(
        /"status" = .*upper\("bookings"\."during"\) > /u,
      );
      expect(active?.params).toContain(bookingNow.toISOString());
      expect(statements.every(({ query }) => !/now\(\)/iu.test(query))).toBe(
        true,
      );
    },
  );

  it("returns null for missing rows from both floor lock modes and the space lock", async () => {
    await withTransaction(async (tx) => {
      expect(await lockAdminFloor(crypto.randomUUID(), "share", tx)).toBeNull();
      expect(
        await lockAdminFloor(crypto.randomUUID(), "update", tx),
      ).toBeNull();
      expect(await lockAdminSpace(crypto.randomUUID(), tx)).toBeNull();
    }, database.db);
    expect(await database.db.execute(sql`SELECT 1`)).toBeDefined();
  });
});

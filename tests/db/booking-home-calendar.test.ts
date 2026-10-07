import { eq } from "drizzle-orm";
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
import { ActionError } from "@/lib/actions/result";
import * as homeDal from "@/lib/dal/booking-home";
import {
  accessGrants,
  bookings,
  branches,
  floors,
  roleSettings,
  spacePhotos,
  spaces,
  teamMembers,
  teams,
  users,
} from "@/lib/db/schema";
import { addDays, zonedDateTime } from "@/lib/time/zoned";
import {
  bookingNow,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

describe("home calendar and frequent space queries", () => {
  let database: TestDatabase;
  let actors: BookingActors;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  beforeEach(async () => {
    actors = await seedBookingActors(database);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await database?.client.close();
  });
  const query = (session = actors.person, now = bookingNow) =>
    createBookingQueries({
      database: database.db,
      requireSession: async () => session,
      now: () => now,
    });
  async function insert(
    start: string,
    changes: Partial<typeof bookings.$inferInsert> = {},
  ) {
    const instant = new Date(start);
    const [row] = await database.db
      .insert(bookings)
      .values({
        userId: actors.person.userId,
        spaceId: actors.publicSpaceId,
        during: {
          start: instant,
          end: new Date(instant.getTime() + 30 * 60_000),
        },
        ...changes,
      })
      .returning();
    if (!row) throw new Error("Missing home booking fixture.");
    return row;
  }
  const selectBranch = (
    branchId = actors.branchId,
    userId = actors.person.userId,
  ) =>
    database.db
      .update(users)
      .set({ defaultBranchId: branchId })
      .where(eq(users.id, userId));
  async function addSpace(
    name: string,
    floorId = actors.floorId,
    changes: Partial<typeof spaces.$inferInsert> = {},
  ) {
    const [space] = await database.db
      .insert(spaces)
      .values({ name, floorId, type: "meeting_room", ...changes })
      .returning();
    if (!space) throw new Error("Missing frequent space fixture.");
    return space.id;
  }
  const photo = (spaceId: string, name: string, sortOrder = 0) =>
    database.db.insert(spacePhotos).values({
      spaceId,
      sortOrder,
      path: `/seed/photos/${name}.webp`,
      alt: name,
    });

  it.each([
    "getHomeWeekBookings",
    "getHomeFrequentSpaces",
    "getHomeUpcomingBookings",
  ] as const)(
    "%s checks the session before SQL and the clock",
    async (method) => {
      const sql = vi.spyOn(database.client, "query");
      const now = vi.fn(() => bookingNow);
      const queries = createBookingQueries({
        database: database.db,
        now,
        requireSession: async () => {
          throw new ActionError("UNAUTHENTICATED");
        },
      });
      await expect(queries[method]()).rejects.toMatchObject({
        code: "UNAUTHENTICATED",
      });
      expect(sql).not.toHaveBeenCalled();
      expect(now).not.toHaveBeenCalled();
    },
  );

  it("keeps three upcoming reservations and supplies cancellation without changing list contracts", async () => {
    const now = new Date("2026-10-07T03:00:00Z");
    await insert("2026-10-07T02:30:00Z");
    const active = await insert("2026-10-07T03:00:00Z");
    const future = await insert("2026-10-08T03:00:00Z", {
      teamId: actors.teamId,
    });
    const third = await insert("2026-10-09T03:00:00Z");
    await insert("2026-10-10T03:00:00Z");
    await database.db
      .insert(roleSettings)
      .values({ branchId: actors.branchId, role: "user", permissions: [] });
    const result = await query(actors.person, now).getHomeUpcomingBookings();
    expect(result.bookings.map(({ id }) => id)).toEqual([
      active.id,
      future.id,
      third.id,
    ]);
    expect(result.bookings.every(({ canCancel }) => canCancel)).toBe(true);
    const list = await query(actors.person, now).getMyBookings();
    expect(list.upcoming[0]).not.toHaveProperty("canCancel");
  });

  describe("week", () => {
    it("returns exactly seven Seoul dates and no hours when no home branch exists", async () => {
      const now = vi.fn(() => new Date("2026-12-31T15:30:00Z"));
      const data = await createBookingQueries({
        database: database.db,
        requireSession: async () => actors.person,
        now,
      }).getHomeWeekBookings();
      expect(data).toEqual({
        now: "2026-12-31T15:30:00.000Z",
        today: "2027-01-01",
        timezone: "Asia/Seoul",
        openHours: null,
        days: Array.from({ length: 7 }, (_, offset) => ({
          date: addDays("2027-01-01", offset),
          bookings: [],
        })),
      });
      expect(now).toHaveBeenCalledOnce();
    });
    it("shares the home team's branch fallback and default timezone, including holiday settings", async () => {
      await database.db
        .update(branches)
        .set({
          timezone: "America/Los_Angeles",
          openHours: { mon: null, tue: { open: "08:30", close: "19:00" } },
        })
        .where(eq(branches.id, actors.branchId));
      const now = new Date("2026-10-01T03:00:00Z");
      const before = await query(actors.member, now).getHomeWeekBookings();
      const header = await query(actors.member, now).getHomeHeader();
      expect(before.today).toBe(header.date);
      expect(before.today).toBe("2026-09-30");
      expect(before.openHours).toEqual(header.branch?.openHours);
      expect(before.openHours).toEqual({
        mon: null,
        tue: { open: "08:30", close: "19:00" },
      });
      await selectBranch(actors.otherBranchId, actors.member.userId);
      expect(
        await query(actors.member, now).getHomeWeekBookings(),
      ).toMatchObject({
        today: "2026-10-01",
        timezone: "Asia/Seoul",
        openHours: {},
      });
    });
    it("groups own personal and team bookings by start date, including ended-today reservations", async () => {
      const ended = await insert("2026-10-07T00:00:00Z", {
        title: "내 제목은 주 조각에 필요 없음",
      });
      const team = await insert("2026-10-08T03:00:00Z", {
        teamId: actors.teamId,
      });
      const last = await insert("2026-10-13T14:30:00Z");
      await insert("2026-10-14T00:00:00Z");
      await insert("2026-10-06T14:30:00Z");
      await insert("2026-10-08T04:00:00Z", {
        userId: actors.member.userId,
        teamId: actors.teamId,
      });
      await insert("2026-10-08T05:00:00Z", {
        status: "cancelled",
        cancelledAt: bookingNow,
      });
      const data = await query().getHomeWeekBookings();
      expect(
        data.days.flatMap(({ bookings }) => bookings.map(({ id }) => id)),
      ).toEqual([ended.id, team.id, last.id]);
      expect(data.days[0]?.bookings[0]).toEqual({
        id: ended.id,
        start: ended.during.start.toISOString(),
        end: ended.during.end.toISOString(),
        date: "2026-10-07",
        timezone: "Asia/Seoul",
        branchId: actors.branchId,
        floorId: actors.floorId,
        spaceId: actors.publicSpaceId,
        spaceName: "회의실 B",
      });
      expect(JSON.stringify(data)).not.toContain(
        "내 제목은 주 조각에 필요 없음",
      );
    });
    it("uses each booked branch's local date at UTC+14 and UTC-10 range edges", async () => {
      await database.db
        .update(branches)
        .set({ timezone: "Pacific/Kiritimati" })
        .where(eq(branches.id, actors.branchId));
      await database.db
        .update(branches)
        .set({ timezone: "Pacific/Honolulu" })
        .where(eq(branches.id, actors.otherBranchId));
      const first = await insert("2026-10-06T10:00:00Z");
      const last = await insert("2026-10-14T09:30:00Z", {
        spaceId: actors.otherSpaceId,
      });
      await insert("2026-10-06T09:30:00Z");
      await insert("2026-10-14T10:00:00Z", { spaceId: actors.otherSpaceId });
      const data = await query().getHomeWeekBookings();
      expect(data.days[0]?.bookings.map(({ id }) => id)).toEqual([first.id]);
      expect(data.days[6]?.bookings.map(({ id }) => id)).toEqual([last.id]);
      expect(data.days.flatMap(({ bookings }) => bookings)).toHaveLength(2);
    });
    it("preserves seven local calendar dates across DST and sorts repeated local times by instant", async () => {
      await selectBranch();
      await database.db
        .update(branches)
        .set({ timezone: "America/New_York" })
        .where(eq(branches.id, actors.branchId));
      const early = await insert("2026-11-01T05:00:00Z");
      const late = await insert("2026-11-01T06:00:00Z");
      const data = await query(
        actors.person,
        new Date("2026-10-30T12:00:00Z"),
      ).getHomeWeekBookings();
      expect(data.days.map(({ date }) => date)).toEqual(
        Array.from({ length: 7 }, (_, offset) => addDays("2026-10-30", offset)),
      );
      expect(data.days[2]?.bookings.map(({ id }) => id)).toEqual([
        early.id,
        late.id,
      ]);
    });
    it("retains own booking names after access loss but never reads photo, title or other private user fields", async () => {
      const own = await insert("2026-10-08T03:00:00Z", {
        spaceId: actors.restrictedSpaceId,
      });
      await photo(actors.restrictedSpaceId, "meeting-large-clay");
      const sql = vi.spyOn(database.client, "query");
      const result = await query().getHomeWeekBookings();
      expect(result.days[1]?.bookings[0]?.id).toBe(own.id);
      expect(JSON.stringify(result)).not.toMatch(
        /meeting-large-clay|photo|title|email|userId/,
      );
      expect(sql.mock.calls[1]?.[0]).not.toMatch(/space_photos|title|email/);
      expect(sql.mock.calls[1]?.[0]).toMatch(/"bookings"\."user_id" =/);
    });
    it("binds an expanded range and does not truncate a busy week", async () => {
      const values = Array.from({ length: 64 }, (_, index) => {
        const start = new Date(
          zonedDateTime("2026-10-07", "00:00", "Asia/Seoul").getTime() +
            index * 30 * 60_000,
        );
        return {
          userId: actors.person.userId,
          spaceId: actors.publicSpaceId,
          during: { start, end: new Date(start.getTime() + 30 * 60_000) },
        };
      });
      await database.db.insert(bookings).values(values);
      const read = vi.spyOn(homeDal, "listMyWeekBookings");
      expect(
        (await query().getHomeWeekBookings()).days.flatMap(
          ({ bookings }) => bookings,
        ),
      ).toHaveLength(64);
      expect(read).toHaveBeenCalledExactlyOnceWith(
        {
          userId: actors.person.userId,
          start: new Date("2026-10-06T00:00:00Z"),
          end: new Date("2026-10-15T00:00:00Z"),
        },
        database.db,
      );
    });
  });

  describe("frequent spaces", () => {
    it("uses the exact thirty elapsed-day boundary, includes future bookings, and excludes cancelled/other bookings", async () => {
      const since = new Date(bookingNow.getTime() - 30 * 86_400_000);
      await insert(new Date(since.getTime() - 30 * 60_000).toISOString());
      await insert(since.toISOString());
      await insert("2026-11-03T03:00:00Z", { teamId: actors.teamId });
      await insert("2026-10-08T03:00:00Z", {
        status: "cancelled",
        cancelledAt: bookingNow,
      });
      await insert("2026-10-09T03:00:00Z", {
        userId: actors.member.userId,
        teamId: actors.teamId,
      });
      await photo(actors.publicSpaceId, "meeting-small-sand");
      const now = vi.fn(() => bookingNow);
      const count = vi.spyOn(homeDal, "listMySpaceBookingCounts");
      const data = await createBookingQueries({
        database: database.db,
        requireSession: async () => actors.person,
        now,
      }).getHomeFrequentSpaces();
      expect(data.spaces).toEqual([
        {
          id: actors.publicSpaceId,
          name: "회의실 B",
          type: "meeting_room",
          photo: {
            path: "/seed/photos/meeting-small-sand.webp",
            alt: "meeting-small-sand",
          },
          branchId: actors.branchId,
          branchName: "강남점",
          floorId: actors.floorId,
          floorName: "7F",
          date: "2026-10-07",
          bookingCount: 2,
        },
      ]);
      expect(now).toHaveBeenCalledOnce();
      expect(count).toHaveBeenCalledExactlyOnceWith(
        { userId: actors.person.userId, since },
        database.db,
      );
    });
    it("orders by count then latest start then id and limits only after filtering inaccessible candidates", async () => {
      const fourth = await addSpace("네 번째 공간");
      const hidden = [
        actors.restrictedSpaceId,
        actors.closedSpaceId,
        actors.archivedSpaceId,
      ];
      for (const spaceId of hidden)
        for (let index = 0; index < 5; index++)
          await insert(
            `2026-10-${String(8 + index).padStart(2, "0")}T03:00:00Z`,
            { spaceId },
          );
      for (const spaceId of [
        actors.publicSpaceId,
        actors.secondSpaceId,
        actors.otherSpaceId,
        fourth,
      ]) {
        await insert("2026-10-08T03:00:00Z", { spaceId });
        await insert(
          spaceId === actors.secondSpaceId
            ? "2026-10-11T03:00:00Z"
            : "2026-10-09T03:00:00Z",
          { spaceId },
        );
      }
      await insert("2026-10-10T03:00:00Z", { spaceId: actors.publicSpaceId });
      await insert("2026-10-09T04:00:00Z", {
        spaceId: actors.secondSpaceId,
        status: "cancelled",
        cancelledAt: bookingNow,
      });
      const data = await query().getHomeFrequentSpaces();
      expect(data.spaces.map(({ id }) => id)).toEqual([
        actors.publicSpaceId,
        actors.secondSpaceId,
        [actors.otherSpaceId, fourth].sort()[0],
      ]);
      expect(data.spaces.map(({ bookingCount }) => bookingCount)).toEqual([
        3, 2, 2,
      ]);
    });
    it("does not apply the own-booking photo exception to spaces no longer accessible", async () => {
      const ids = [
        actors.restrictedSpaceId,
        actors.closedSpaceId,
        actors.restrictedFloorSpaceId,
        actors.archivedSpaceId,
        actors.deskAreaId,
        actors.deskId,
      ];
      const names = [
        "meeting-large-clay",
        "phone-booth-sage",
        "meeting-large-sand",
        "archived-photo",
        "unbookable-photo",
        "desk-photo",
      ];
      for (const [index, spaceId] of ids.entries()) {
        await insert("2026-10-08T03:00:00Z", {
          spaceId,
          userId: actors.member.userId,
          teamId: actors.teamId,
        });
        await photo(spaceId, names[index]!);
      }
      await insert("2026-10-09T03:00:00Z", { userId: actors.member.userId });
      await photo(actors.publicSpaceId, "allowed-photo");
      await database.db
        .delete(teamMembers)
        .where(eq(teamMembers.userId, actors.member.userId));
      const access = vi.spyOn(homeDal, "listFrequentSpaceAccess");
      const cards = vi.spyOn(homeDal, "getFrequentSpaceCards");
      const sql = vi.spyOn(database.client, "query");
      const result = await query(actors.member).getHomeFrequentSpaces();
      expect(result.spaces.map(({ id }) => id)).toEqual([actors.publicSpaceId]);
      expect(access).toHaveBeenCalledOnce();
      expect(cards).toHaveBeenCalledExactlyOnceWith(
        [actors.publicSpaceId],
        database.db,
      );
      const payload = JSON.stringify(result);
      for (const name of names) expect(payload).not.toContain(name);
      const accessSql = sql.mock.calls.find(([statement]) =>
        statement.includes("frequent_floor_grants"),
      )?.[0];
      expect(accessSql).toBeDefined();
      expect(accessSql).not.toMatch(/space_photos|"name"/);
      const photoRead = sql.mock.calls.find(([statement]) =>
        statement.includes("space_photos"),
      );
      expect(photoRead).toBeDefined();
      expect(photoRead?.[1]).toContain(actors.publicSpaceId);
      for (const id of ids) expect(photoRead?.[1]).not.toContain(id);
    });
    it("excludes a closed floor and respects branch floor.view overrides", async () => {
      await insert("2026-10-08T03:00:00Z");
      await database.db
        .update(floors)
        .set({ access: "closed" })
        .where(eq(floors.id, actors.floorId));
      expect((await query().getHomeFrequentSpaces()).spaces).toEqual([]);
      await database.db
        .update(floors)
        .set({ access: "everyone" })
        .where(eq(floors.id, actors.floorId));
      await database.db.insert(roleSettings).values({
        branchId: actors.branchId,
        role: "user",
        permissions: ["booking.own"],
      });
      expect((await query().getHomeFrequentSpaces()).spaces).toEqual([]);
    });
    it("keeps scoped operator access overrides without leaking another branch's closed room", async () => {
      await insert("2026-10-08T03:00:00Z", {
        userId: actors.operator.userId,
        spaceId: actors.closedSpaceId,
      });
      await insert("2026-10-08T03:00:00Z", {
        userId: actors.operator.userId,
        spaceId: actors.otherSpaceId,
      });
      await database.db
        .update(spaces)
        .set({ access: "closed" })
        .where(eq(spaces.id, actors.otherSpaceId));
      const result = await query(actors.operator).getHomeFrequentSpaces();
      expect(result.spaces.map(({ id }) => id)).toEqual([actors.closedSpaceId]);
    });
    it("requires a common allowed team instead of combining floor and space grants from different memberships", async () => {
      const spaceId = actors.restrictedFloorSpaceId;
      await database.db
        .update(spaces)
        .set({ access: "teams" })
        .where(eq(spaces.id, spaceId));
      await database.db.insert(accessGrants).values({
        targetType: "space",
        targetId: spaceId,
        teamId: actors.otherTeamId,
      });
      await insert("2026-10-08T03:00:00Z", {
        spaceId,
        userId: actors.member.userId,
      });
      expect(
        (await query(actors.member).getHomeFrequentSpaces()).spaces,
      ).toEqual([]);
      await database.db.insert(accessGrants).values({
        targetType: "space",
        targetId: spaceId,
        teamId: actors.teamId,
      });
      const result = await query(actors.member).getHomeFrequentSpaces();
      expect(result.spaces.map(({ id }) => id)).toEqual([spaceId]);
      expect(result.spaces[0]?.bookingCount).toBe(1);
    });
    it("uses each space's current local date and only its zero-order photo", async () => {
      await insert("2026-10-08T03:00:00Z");
      await insert("2026-10-08T03:00:00Z", { spaceId: actors.otherSpaceId });
      await database.db
        .update(branches)
        .set({ timezone: "America/Los_Angeles" })
        .where(eq(branches.id, actors.otherBranchId));
      await photo(actors.publicSpaceId, "non-representative", 1);
      const data = await query(
        actors.person,
        new Date("2026-10-07T03:00:00Z"),
      ).getHomeFrequentSpaces();
      expect(
        data.spaces.find(({ id }) => id === actors.publicSpaceId),
      ).toMatchObject({ date: "2026-10-07", photo: null });
      expect(
        data.spaces.find(({ id }) => id === actors.otherSpaceId),
      ).toMatchObject({ date: "2026-10-06", photo: null });
      expect(JSON.stringify(data)).not.toContain("non-representative");
    });
    it("does not issue detail/photo reads when there are no bookings or no allowed candidates", async () => {
      const sql = vi.spyOn(database.client, "query");
      expect(await query().getHomeFrequentSpaces()).toEqual({ spaces: [] });
      expect(
        sql.mock.calls.some(([statement]) =>
          statement.includes("space_photos"),
        ),
      ).toBe(false);
      await insert("2026-10-08T03:00:00Z", { spaceId: actors.closedSpaceId });
      sql.mockClear();
      expect(await query().getHomeFrequentSpaces()).toEqual({ spaces: [] });
      expect(
        sql.mock.calls.some(([statement]) =>
          statement.includes("space_photos"),
        ),
      ).toBe(false);
    });
    it("binds the elapsed-day lower bound across DST instead of using local midnight or SQL now", async () => {
      const now = new Date("2026-11-02T06:15:00Z");
      const since = new Date("2026-10-03T06:15:00Z");
      await selectBranch();
      await database.db
        .update(branches)
        .set({ timezone: "America/New_York" })
        .where(eq(branches.id, actors.branchId));
      const read = vi.spyOn(homeDal, "listMySpaceBookingCounts");
      const sql = vi.spyOn(database.client, "query");
      await query(actors.person, now).getHomeFrequentSpaces();
      expect(read).toHaveBeenCalledExactlyOnceWith(
        { userId: actors.person.userId, since },
        database.db,
      );
      expect(
        sql.mock.calls.map(([statement]) => statement).join(" "),
      ).not.toMatch(/now\(\)/i);
    });
  });

  it("keeps week at [1,1] and frequent spaces at [4,1,1] with growing branches and memberships", async () => {
    await insert("2026-10-08T03:00:00Z");
    const meter = createQueryMeter(database.client);
    async function measure() {
      meter.start();
      await query().getHomeWeekBookings();
      expect(meter.stop()).toEqual({
        stages: 2,
        statements: 2,
        perStage: [1, 1],
      });
      meter.start();
      await query().getHomeFrequentSpaces();
      expect(meter.stop()).toEqual({
        stages: 3,
        statements: 6,
        perStage: [4, 1, 1],
      });
    }
    try {
      await measure();
      for (let index = 0; index < 8; index++) {
        const [branch] = await database.db
          .insert(branches)
          .values({ name: `추가 ${index}`, timezone: "America/Los_Angeles" })
          .returning();
        const [floor] = await database.db
          .insert(floors)
          .values({ branchId: branch!.id, name: "1F", level: 1 })
          .returning();
        const spaceId = await addSpace(`공간 ${index}`, floor!.id);
        const [team] = await database.db
          .insert(teams)
          .values({
            name: `팀 ${index}`,
            createdBy: actors.person.userId,
            homeBranchId: branch!.id,
          })
          .returning();
        await database.db
          .insert(teamMembers)
          .values({ teamId: team!.id, userId: actors.person.userId });
        await insert("2026-10-08T03:00:00Z", { spaceId });
      }
      await measure();
    } finally {
      meter.restore();
    }
  });
});

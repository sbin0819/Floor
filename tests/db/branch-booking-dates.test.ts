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
import * as bookingDal from "@/lib/dal/bookings";
import { bookings, branches, floors } from "@/lib/db/schema";
import { addDays, zonedDateTime } from "@/lib/time/zoned";
import {
  bookingNow,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

describe("branch navigation's own booking date markers", () => {
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
  const query = (now = bookingNow) =>
    createBookingQueries({
      database: database.db,
      requireSession: async () => actors.member,
      now: () => now,
    });
  const insert = (
    date: string,
    start = "10:00",
    overrides: Partial<typeof bookings.$inferInsert> = {},
    timezone = "Asia/Seoul",
  ) => {
    const instant = zonedDateTime(date, start, timezone);
    return database.db.insert(bookings).values({
      spaceId: actors.publicSpaceId,
      userId: actors.member.userId,
      during: {
        start: instant,
        end: new Date(instant.getTime() + 30 * 60_000),
      },
      ...overrides,
    });
  };

  it("includes own personal/team bookings and today's ended bookings, deduplicates and sorts", async () => {
    const today = "2026-10-07";
    await insert(addDays(today, 3), "10:00", { teamId: actors.teamId });
    await insert(today, "08:00");
    await insert(today, "09:00");
    await insert(addDays(today, 1), "10:00", {
      status: "cancelled",
      cancelledAt: bookingNow,
    });
    await insert(addDays(today, 2), "10:00", {
      userId: actors.admin.userId,
      teamId: actors.teamId,
    });
    await insert(addDays(today, 4), "10:00", { spaceId: actors.otherSpaceId });
    const result = await query().getBranchNavigation(actors.branchId);
    expect(result.today).toBe(today);
    expect(result.bookingDates).toEqual([today, addDays(today, 3)]);
    expect(result.bookingDates.every((date) => typeof date === "string")).toBe(
      true,
    );
  });

  it("uses inclusive local today through day 60 and excludes adjacent midnight boundaries", async () => {
    const today = "2026-10-07";
    await insert(addDays(today, -1), "23:30");
    await insert(today, "00:00");
    await insert(addDays(today, 60), "23:30");
    await insert(addDays(today, 61), "00:00");
    expect(
      (await query().getBranchNavigation(actors.branchId)).bookingDates,
    ).toEqual([today, addDays(today, 60)]);
  });

  it.each([
    {
      now: "2026-03-08T06:30:00Z",
      today: "2026-03-08",
      before: "2026-03-08T04:30:00Z",
      late: "2026-03-09T03:30:00Z",
    },
    {
      now: "2026-11-01T04:30:00Z",
      today: "2026-11-01",
      before: "2026-11-01T03:30:00Z",
      late: "2026-11-02T04:30:00Z",
    },
  ])(
    "keeps branch-local days across DST at $today",
    async ({ now, today, before, late }) => {
      const timezone = "America/New_York";
      await database.db
        .update(branches)
        .set({ timezone })
        .where(eq(branches.id, actors.branchId));
      for (const start of [before, late]) {
        const instant = new Date(start);
        await database.db
          .insert(bookings)
          .values({
            spaceId: actors.publicSpaceId,
            userId: actors.member.userId,
            during: {
              start: instant,
              end: new Date(instant.getTime() + 30 * 60_000),
            },
          });
      }
      await insert(addDays(today, 60), "23:30", {}, timezone);
      await insert(addDays(today, 61), "00:00", {}, timezone);
      const result = await query(new Date(now)).getBranchNavigation(
        actors.branchId,
      );
      expect(result.today).toBe(today);
      expect(result.bookingDates).toEqual([today, addDays(today, 60)]);
    },
  );

  it("crosses the year boundary using calendar days rather than fixed elapsed days", async () => {
    const today = "2026-12-31";
    for (const date of [addDays(today, 60), addDays(today, 1), today])
      await insert(date);
    const result = await query(
      new Date("2026-12-31T03:00:00Z"),
    ).getBranchNavigation(actors.branchId);
    expect(result.bookingDates).toEqual([
      "2026-12-31",
      "2027-01-01",
      "2027-03-01",
    ]);
  });

  it("preserves own date markers after floor access closes without disclosing its name", async () => {
    const date = "2026-10-08";
    await insert(date, "10:00", { spaceId: actors.restrictedFloorSpaceId });
    await database.db
      .update(floors)
      .set({ access: "closed" })
      .where(eq(floors.id, actors.restrictedFloorId));
    const result = await query().getBranchNavigation(actors.branchId);
    expect(result.bookingDates).toEqual([date]);
    expect(result.floors.map(({ id }) => id)).not.toContain(
      actors.restrictedFloorId,
    );
    expect(JSON.stringify(result)).not.toContain("8층 비공개 공간");
  });

  it("does not read booking dates before validating the branch", async () => {
    const readDates = vi.spyOn(bookingDal, "listMyBranchBookingDates");
    await expect(
      query().getBranchNavigation(crypto.randomUUID()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(readDates).not.toHaveBeenCalled();
  });

  it("adds exactly one bounded second-stage statement without selecting booking metadata", async () => {
    await insert("2026-10-08");
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      expect(
        (await query().getBranchNavigation(actors.branchId)).bookingDates,
      ).toEqual(["2026-10-08"]);
      expect(meter.stop()).toEqual({
        stages: 2,
        statements: 7,
        perStage: [6, 1],
      });
    } finally {
      meter.restore();
    }
    const read = vi.spyOn(database.client, "query");
    expect(
      await bookingDal.listMyBranchBookingDates(
        {
          userId: actors.member.userId,
          branchId: actors.branchId,
          today: "2026-10-07",
          timezone: "Asia/Seoul",
        },
        database.db,
      ),
    ).toEqual(["2026-10-08"]);
    const statement = String(read.mock.calls[0]?.[0]);
    expect(read).toHaveBeenCalledOnce();
    expect(statement).toMatch(/select "bookings"\."during"/);
    expect(statement).not.toMatch(
      /"title"|"name"|space_photos|join "users"|join "teams"|now\(\)/,
    );
  });
});

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
import { createAuth, type AuthInstance } from "@/lib/auth/auth";
import * as seedDal from "@/lib/dal/seed";
import { bookings, branches, spaceBlocks, users } from "@/lib/db/schema";
import { createMemoryEmailSender } from "@/lib/email/memory";
import { loadSeedBookings2 } from "@/lib/seed/bookings-2";
import { loadSeedData } from "@/lib/seed/data";
import { runSeed } from "@/lib/seed/run-seed";
import { createDeskParts } from "@/features/bookings/desk-parts";
import { getOperatingDate } from "@/lib/time/open-hours";
import { localDate } from "@/lib/time/zoned";
import { createTestDatabase, type TestDatabase } from "./helper";

const data = loadSeedData();
const extras = loadSeedBookings2(data);
const now = new Date("2026-10-07T03:00:00Z");
describe("desk additions in transactional seed", () => {
  let database: TestDatabase;
  let auth: AuthInstance;
  beforeAll(async () => {
    database = await createTestDatabase();
    auth = createAuth({
      db: database.db,
      email: createMemoryEmailSender(),
      secret: "desk-seed-testing-secret-at-least-32-bytes",
      baseUrl: "http://localhost:3000",
      rateLimit: { enabled: false },
    });
  });
  afterAll(async () => {
    await database?.client.close();
  });
  beforeEach(async () => {
    await database.db.execute(
      sql`TRUNCATE users, branches, auth_verifications CASCADE`,
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const seed = (date = now) =>
    runSeed({ db: database.db, auth, now: date, resetPasswords: false });

  it("writes exactly nine desk bookings and one operating-day block with null title/count, idempotently", async () => {
    const result = await seed();
    expect(result.counts).toMatchObject({ bookings: 30, spaceBlocks: 5 });
    const ids = new Set(extras.deskBookings.map(({ id }) => id));
    const read = async () =>
      (await database.db.select().from(bookings).orderBy(bookings.id)).filter(
        ({ id }) => ids.has(id),
      );
    const rows = await read();
    expect(rows).toHaveLength(9);
    const branch = data.branches.find(({ name }) => name === "강남점")!;
    for (const expected of extras.deskBookings) {
      const date = getOperatingDate(
        now,
        branch.timezone,
        branch.openHours,
        expected.dayOffset,
      );
      const part = createDeskParts({
        date,
        timeZone: branch.timezone,
        openHours: branch.openHours,
      }).find(({ part }) => part === expected.part)!;
      expect(rows.find(({ id }) => id === expected.id)).toMatchObject({
        spaceId: expected.deskId,
        title: null,
        attendeeCount: null,
        during: { start: new Date(part.start), end: new Date(part.end) },
      });
    }
    const block = (
      await database.db
        .select()
        .from(spaceBlocks)
        .where(eq(spaceBlocks.id, extras.deskBlocks[0]!.id))
    )[0]!;
    expect(localDate(block.during.start, branch.timezone)).toBe("2026-10-07");
    expect(localDate(block.during.end, branch.timezone)).toBe("2026-10-09");
    await seed();
    expect(await read()).toEqual(rows);
  });

  it.each(["same-seat", "same-user"])(
    "skips a seed desk booking conflicting with a non-seed %s reservation",
    async (kind) => {
      await seed();
      const original = extras.deskBookings[0]!;
      const row = (
        await database.db
          .select()
          .from(bookings)
          .where(eq(bookings.id, original.id))
      )[0]!;
      await database.db.delete(bookings).where(eq(bookings.id, row.id));
      const otherUser = (
        await database.db
          .select()
          .from(users)
          .where(eq(users.email, "test1@ai.com"))
      )[0]!;
      const foreignId = crypto.randomUUID();
      await database.db.insert(bookings).values({
        id: foreignId,
        spaceId:
          kind === "same-seat"
            ? row.spaceId
            : data.spaces.find(({ name }) => name === "A-23")!.id,
        userId: kind === "same-seat" ? otherUser.id : row.userId,
        during: row.during,
      });
      const result = await seed();
      expect(result.skippedBookings).toBe(1);
      expect(result.counts.bookings).toBe(29);
      expect(
        await database.db
          .select()
          .from(bookings)
          .where(eq(bookings.id, row.id)),
      ).toEqual([]);
      expect(
        await database.db
          .select()
          .from(bookings)
          .where(eq(bookings.id, foreignId)),
      ).toHaveLength(1);
    },
  );

  it("does not alter desk schedules when another already-existing branch is selected", async () => {
    await seed();
    await database.db
      .update(bookings)
      .set({ status: "cancelled", cancelledAt: now })
      .where(eq(bookings.id, extras.deskBookings[0]!.id));
    const before = await database.db
      .select()
      .from(bookings)
      .orderBy(bookings.id);
    const blocks = await database.db
      .select()
      .from(spaceBlocks)
      .orderBy(spaceBlocks.id);
    const branchId = data.branches.find(({ name }) => name === "판교점")!.id;
    const result = await runSeed({
      db: database.db,
      now: new Date("2026-11-07T03:00:00Z"),
      resetPasswords: false,
      branchIds: [branchId],
    });
    expect(result.counts.bookings).toBe(0);
    expect(
      await database.db.select().from(bookings).orderBy(bookings.id),
    ).toEqual(before);
    expect(
      await database.db.select().from(spaceBlocks).orderBy(spaceBlocks.id),
    ).toEqual(blocks);
  });

  it("rolls all prior rows and the new maintenance back after a desk insert fails", async () => {
    const insert = seedDal.insertSeedBooking;
    vi.spyOn(seedDal, "insertSeedBooking").mockImplementation(
      async (input, db) => {
        if (input.id === extras.deskBookings[0]!.id)
          throw new Error("private desk failure");
        await insert(input, db);
      },
    );
    await expect(seed()).rejects.toThrow("되돌렸어요");
    expect(await database.db.select().from(users)).toEqual([]);
    expect(await database.db.select().from(branches)).toEqual([]);
    expect(await database.db.select().from(bookings)).toEqual([]);
    expect(await database.db.select().from(spaceBlocks)).toEqual([]);
  });

  it("uses the next operating dates for weekend seed runs", async () => {
    await seed(new Date("2026-10-11T03:00:00Z"));
    const rows = await database.db.select().from(bookings);
    for (const fixture of extras.deskBookings) {
      const row = rows.find(({ id }) => id === fixture.id)!;
      expect(localDate(row.during.start, "Asia/Seoul")).toBe(
        fixture.dayOffset === 0 ? "2026-10-12" : "2026-10-13",
      );
    }
  });
});

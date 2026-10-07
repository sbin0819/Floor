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
import { createBookingQueries } from "@/features/bookings/query-factory";
import { ActionError } from "@/lib/actions/result";
import { branches, floors, roleSettings, users } from "@/lib/db/schema";
import { defaultPermissions } from "@/lib/permissions/defaults";
import { addDays } from "@/lib/time/zoned";
import {
  bookingDate,
  bookingNow,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

describe("booking entry dates", () => {
  let database: TestDatabase;
  let actors: BookingActors;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    actors = await seedBookingActors(database);
  });
  const queries = (now = bookingNow) =>
    createBookingQueries({
      database: database.db,
      requireSession: async () => actors.member,
      now: () => now,
    });
  const floorHref = () =>
    `/branches/${actors.branchId}/floors/${actors.floorId}`;

  it.each([0, 1, 60])(
    "preserves a valid date %s days ahead in the first floor redirect",
    async (days) => {
      const date = addDays(bookingDate, days);
      expect(await queries().getBookingDestination(date)).toBe(
        `${floorHref()}?date=${date}`,
      );
    },
  );

  it.each([
    undefined,
    null,
    [bookingDate],
    "",
    "2026-1-08",
    "2026-11-31",
    "2026-10-08T00:00:00Z",
    "2026-10-08&space=private",
    addDays(bookingDate, -1),
    addDays(bookingDate, 61),
  ])("ignores an absent, malformed or out-of-range date %j", async (date) => {
    expect(await queries().getBookingDestination(date)).toBe(floorHref());
  });

  it("uses the selected branch timezone, including today and the 60-day boundary", async () => {
    const now = new Date("2026-10-07T16:00:00Z");
    expect(await queries(now).getBookingDestination("2026-10-07")).toBe(
      floorHref(),
    );
    expect(await queries(now).getBookingDestination("2026-10-08")).toBe(
      `${floorHref()}?date=2026-10-08`,
    );
    await database.db
      .update(branches)
      .set({ timezone: "America/Los_Angeles" })
      .where(eq(branches.id, actors.branchId));
    expect(await queries(now).getBookingDestination("2026-10-07")).toBe(
      `${floorHref()}?date=2026-10-07`,
    );
    expect(
      await queries(now).getBookingDestination(addDays("2026-10-07", 60)),
    ).toBe(`${floorHref()}?date=${addDays("2026-10-07", 60)}`);
    expect(
      await queries(now).getBookingDestination(addDays("2026-10-07", 61)),
    ).toBe(floorHref());
  });

  it("checks the default destination timezone instead of the fallback team's timezone", async () => {
    const now = new Date("2026-10-07T16:00:00Z");
    await database.db
      .update(branches)
      .set({ timezone: "America/Los_Angeles" })
      .where(eq(branches.id, actors.otherBranchId));
    await database.db
      .update(users)
      .set({ defaultBranchId: actors.otherBranchId })
      .where(eq(users.id, actors.member.userId));
    expect(await queries(now).getBookingDestination("2026-10-07")).toBe(
      `/branches/${actors.otherBranchId}/floors/${actors.otherFloorId}?date=2026-10-07`,
    );
  });

  it("keeps branchless and inaccessible-floor destinations without a date", async () => {
    const noBranch = createBookingQueries({
      database: database.db,
      requireSession: async () => actors.person,
      now: () => bookingNow,
    });
    expect(await noBranch.getBookingDestination(bookingDate)).toBe("/branches");
    await database.db
      .update(floors)
      .set({ access: "closed" })
      .where(eq(floors.branchId, actors.branchId));
    expect(await queries().getBookingDestination(bookingDate)).toBe(
      `/branches/${actors.branchId}`,
    );
  });

  it("does not bypass floor.view when the requested date is valid", async () => {
    await database.db.insert(roleSettings).values({
      branchId: actors.branchId,
      role: "user",
      permissions: defaultPermissions.user.filter(
        (key) => key !== "floor.view",
      ),
    });
    await database.db.insert(roleSettings).values({
      branchId: actors.branchId,
      role: "team_member",
      permissions: defaultPermissions.team_member.filter(
        (key) => key !== "floor.view",
      ),
    });
    expect(await queries().getBookingDestination(bookingDate)).toBe(
      `/branches/${actors.branchId}`,
    );
  });

  it("still checks the session before reading a branch or current time", async () => {
    const read = vi.spyOn(database.client, "query");
    const now = vi.fn(() => bookingNow);
    const query = createBookingQueries({
      database: database.db,
      requireSession: async () => {
        throw new ActionError("UNAUTHENTICATED");
      },
      now,
    });
    try {
      await expect(
        query.getBookingDestination(bookingDate),
      ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
      expect(read).not.toHaveBeenCalled();
      expect(now).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  });

  it("adds no SQL or stages when carrying a date", async () => {
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      await queries().getBookingDestination();
      const before = meter.stop();
      meter.start();
      await queries().getBookingDestination(bookingDate);
      const after = meter.stop();
      expect(after).toEqual(before);
      expect(after.stages).toBeLessThanOrEqual(3);
      expect(after.perStage.every((count) => count <= 6)).toBe(true);
    } finally {
      meter.restore();
    }
  });
});

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
import { createAdminQueries } from "@/features/admin/query-factory";
import { ActionError } from "@/lib/actions/result";
import type { Session } from "@/lib/auth/types";
import * as homeDal from "@/lib/dal/admin-home";
import * as branchDal from "@/lib/dal/branches";
import {
  branches,
  branchStaff,
  floors,
  roleSettings,
  spaces,
} from "@/lib/db/schema";
import {
  bookingNow,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

describe("operator home cards and execution budget", () => {
  let database: TestDatabase;
  let fixture: BookingActors;
  let meter: ReturnType<typeof createQueryMeter>;
  beforeAll(async () => {
    database = await createTestDatabase();
    meter = createQueryMeter(database.client);
  });
  afterAll(async () => {
    meter.restore();
    await database.client.close();
  });
  beforeEach(async () => {
    fixture = await seedBookingActors(database);
  });
  afterEach(() => vi.restoreAllMocks());
  const queries = (session?: Session, now = bookingNow) =>
    createAdminQueries({
      database: database.db,
      requireSession: async () => session ?? fixture.operator,
      now: () => now,
    });

  it("requires a session before any query, including assignment lookup", async () => {
    const subject = createAdminQueries({
      database: database.db,
      requireSession: async () => {
        throw new ActionError("UNAUTHENTICATED");
      },
    });
    meter.start();
    await expect(subject.getOperatorBranchCards()).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(meter.stop()).toEqual({ stages: 0, statements: 0, perStage: [] });
  });

  it("does not read metadata or counts for a member without an assigned branch", async () => {
    const summaries = vi.spyOn(homeDal, "listOperatorBranchSummaries");
    meter.start();
    await expect(
      queries(fixture.member).getOperatorBranchCards(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(meter.stop()).toEqual({ stages: 1, statements: 1, perStage: [1] });
    expect(summaries).not.toHaveBeenCalled();
  });

  it("returns only assigned branch metadata and active non-seat counts in two SQL stages", async () => {
    meter.start();
    const data = await queries().getOperatorBranchCards();
    expect(meter.stop()).toEqual({
      stages: 2,
      statements: 2,
      perStage: [1, 1],
    });
    expect(data.now).toBe(bookingNow.toISOString());
    expect(data.branches).toHaveLength(1);
    expect(data.branches[0]).toMatchObject({
      id: fixture.branchId,
      name: "강남점",
      address: "가상로 7",
      floorCount: 2,
      spaceCount: 6,
      operatingState: { status: "open", date: "2026-10-07" },
    });
    expect(Object.keys(data.branches[0]!).sort()).toEqual([
      "address",
      "floorCount",
      "id",
      "name",
      "operatingState",
      "spaceCount",
    ]);
    const serialized = JSON.stringify(data);
    for (const hidden of [
      fixture.otherBranchId,
      "서초점",
      "가상로 8",
      "email",
      "userId",
      "contactPhone",
      "createdAt",
      "timezone",
      "openHours",
    ])
      expect(serialized).not.toContain(hidden);
  });

  it("scopes the same query independently for a different operator", async () => {
    const data = await queries(fixture.otherOperator).getOperatorBranchCards();
    expect(data.branches).toHaveLength(1);
    expect(data.branches[0]).toMatchObject({
      id: fixture.otherBranchId,
      floorCount: 1,
      spaceCount: 1,
    });
    expect(JSON.stringify(data)).not.toContain(fixture.branchId);
  });

  it("does not duplicate a branch's counts when another operator also manages it", async () => {
    await database.db.insert(branchStaff).values({
      branchId: fixture.branchId,
      userId: fixture.otherOperator.userId,
    });
    expect(
      (await queries().getOperatorBranchCards()).branches[0],
    ).toMatchObject({ floorCount: 2, spaceCount: 6 });
  });

  it("keeps an empty branch and empty floors with zero spaces", async () => {
    const emptyId = crypto.randomUUID();
    await database.db
      .insert(branches)
      .values({ id: emptyId, name: "가상 빈 지점" });
    await database.db
      .insert(branchStaff)
      .values({ branchId: emptyId, userId: fixture.operator.userId });
    expect(
      (await queries().getOperatorBranchCards()).branches[0],
    ).toMatchObject({
      id: emptyId,
      address: null,
      floorCount: 0,
      spaceCount: 0,
    });
    await database.db
      .insert(floors)
      .values({ branchId: emptyId, level: 1, name: "1층" });
    expect(
      (await queries().getOperatorBranchCards()).branches[0],
    ).toMatchObject({ id: emptyId, floorCount: 1, spaceCount: 0 });
  });

  it("keeps operator read access when write permissions are disabled", async () => {
    await database.db.insert(roleSettings).values({
      branchId: fixture.branchId,
      role: "operator",
      permissions: [],
    });
    expect((await queries().getOperatorBranchCards()).branches[0]?.id).toBe(
      fixture.branchId,
    );
  });

  it("rechecks assignment in the aggregate instead of trusting stale assignment IDs", async () => {
    const read = branchDal.getOperatorBranches;
    vi.spyOn(branchDal, "getOperatorBranches").mockImplementationOnce(
      async (userId, db) => {
        const assigned = await read(userId, db);
        await database.db
          .delete(branchStaff)
          .where(eq(branchStaff.userId, userId));
        return assigned;
      },
    );
    await expect(queries().getOperatorBranchCards()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it.each([
    ["2026-10-06T23:59:00Z", "before_open"],
    ["2026-10-07T00:00:00Z", "open"],
    ["2026-10-07T13:00:00Z", "after_close"],
    ["2026-10-10T23:00:00Z", "closed"],
  ])(
    "calculates today's operating state from injected time %s",
    async (instant, status) => {
      const data = await queries(
        undefined,
        new Date(instant),
      ).getOperatorBranchCards();
      expect(data.now).toBe(instant.replace("Z", ".000Z"));
      expect(data.branches[0]?.operatingState.status).toBe(status);
    },
  );

  it("uses each branch's timezone at the same instant", async () => {
    await database.db.insert(branchStaff).values({
      branchId: fixture.otherBranchId,
      userId: fixture.operator.userId,
    });
    await database.db
      .update(branches)
      .set({ timezone: "America/New_York" })
      .where(eq(branches.id, fixture.otherBranchId));
    const data = await queries().getOperatorBranchCards();
    expect(
      data.branches.find(({ id }) => id === fixture.branchId)?.operatingState,
    ).toMatchObject({ status: "open", date: "2026-10-07" });
    expect(
      data.branches.find(({ id }) => id === fixture.otherBranchId)
        ?.operatingState,
    ).toMatchObject({ status: "after_close", date: "2026-10-06" });
  });

  it("keeps two stages and two statements with ten additional assigned branches and eighty floors", async () => {
    const extraBranches = Array.from({ length: 10 }, (_, index) => ({
      id: crypto.randomUUID(),
      name: `가상 다중 지점 ${index}`,
    }));
    await database.db.insert(branches).values(extraBranches);
    await database.db.insert(branchStaff).values(
      extraBranches.map(({ id }) => ({
        branchId: id,
        userId: fixture.operator.userId,
      })),
    );
    const extraFloors = extraBranches.flatMap(({ id }) =>
      Array.from({ length: 8 }, (_, level) => ({
        id: crypto.randomUUID(),
        branchId: id,
        level,
        name: `${level}층`,
      })),
    );
    await database.db.insert(floors).values(extraFloors);
    await database.db.insert(spaces).values(
      extraFloors.map(({ id }) => ({
        floorId: id,
        type: "meeting_room" as const,
        name: "가상 회의실",
      })),
    );
    meter.start();
    const data = await queries().getOperatorBranchCards();
    expect(meter.stop()).toEqual({
      stages: 2,
      statements: 2,
      perStage: [1, 1],
    });
    expect(data.branches).toHaveLength(11);
    for (const row of data.branches.filter(({ id }) => id !== fixture.branchId))
      expect(row).toMatchObject({ floorCount: 8, spaceCount: 8 });
    expect(data.branches.some(({ id }) => id === fixture.otherBranchId)).toBe(
      false,
    );
  });
});

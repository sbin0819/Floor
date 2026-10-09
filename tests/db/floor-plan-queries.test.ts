import { eq, sql } from "drizzle-orm";
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
import { createFloorPlanQueries } from "@/features/floor-plan/query-factory";
import { ActionError } from "@/lib/actions/result";
import type { Session } from "@/lib/auth/types";
import { getFloorPlanWithAccess } from "@/lib/dal/floor-plans";
import {
  accessGrants,
  floorPlans,
  floors,
  roleSettings,
  spaceBlocks,
} from "@/lib/db/schema";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";
import {
  bookingDate,
  bookingNow,
  bookingRange,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

describe("floor-plan read authorization and budgets", () => {
  let database: TestDatabase;
  let actors: BookingActors;
  let meter: ReturnType<typeof createQueryMeter>;

  beforeAll(async () => {
    database = await createTestDatabase();
    meter = createQueryMeter(database.client);
  });
  beforeEach(async () => {
    actors = await seedBookingActors(database);
  });
  afterAll(async () => {
    meter.restore();
    await database.client.close();
  });

  function document(): FloorPlanDocument {
    return {
      schema: 1,
      unit: "mm",
      bounds: { w: 10000, h: 10000 },
      walls: [],
      openings: [],
      spaces: [
        {
          id: "room",
          spaceId: actors.publicSpaceId,
          polygon: [
            [0, 0],
            [4000, 0],
            [4000, 4000],
            [0, 4000],
          ],
          label: { at: [2000, 2000] },
        },
      ],
      seats: [
        {
          id: "seat",
          spaceId: actors.deskId,
          at: [5000, 5000],
          size: [1400, 700],
          rotation: 0,
        },
      ],
      fixtures: [],
      background: { transform: [1, 0, 0, 1, 0, 0], opacity: 0.35 },
    };
  }
  async function plan(input: Partial<typeof floorPlans.$inferInsert> = {}) {
    const doc = document();
    // DB에는 편집 전용 좌석 이름이 있어도 멤버용 SELECT가 읽지 않는다.
    const withLabels = {
      ...doc,
      seats: doc.seats.map((seat) => ({ ...seat, label: "비공개 좌석 이름" })),
    };
    const [row] = await database.db
      .insert(floorPlans)
      .values({
        floorId: actors.floorId,
        version: 1,
        status: "published",
        document: withLabels,
        backgroundImage: "private-background-key.webp",
        createdBy: actors.operator.userId,
        publishedAt: bookingNow,
        ...input,
      })
      .returning();
    if (!row) throw new Error("Expected a plan fixture.");
    return row;
  }
  const queries = (actor: Session = actors.person) =>
    createFloorPlanQueries({
      database: database.db,
      requireSession: async () => actor,
    });
  const bookingQueries = () =>
    createBookingQueries({
      database: database.db,
      requireSession: async () => actors.person,
      now: () => bookingNow,
    });

  it("checks the session before malformed identifiers and does not query anonymously", async () => {
    const requireSession = vi
      .fn()
      .mockRejectedValue(new ActionError("UNAUTHENTICATED"));
    meter.start();
    await expect(
      createFloorPlanQueries({
        database: database.db,
        requireSession,
      }).getFloorPlanDocument("invalid"),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(meter.stop().statements).toBe(0);
    expect(requireSession).toHaveBeenCalledOnce();
  });
  it.each([
    "",
    "not-uuid",
    "../secret",
    "10000000-0000-4000-8000-000000000001?private=1",
  ])("rejects invalid identifiers without SQL: %s", async (id) => {
    meter.start();
    await expect(queries().getFloorPlanDocument(id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(meter.stop().statements).toBe(0);
  });
  it("does not distinguish a missing plan from a draft", async () => {
    const draft = await plan({ status: "draft" });
    for (const id of [crypto.randomUUID(), draft.id])
      await expect(queries().getFloorPlanDocument(id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
  });
  it.each(["published", "archived"] as const)(
    "returns only the public document of a %s plan",
    async (status) => {
      const row = await plan({ status });
      const data = await queries().getFloorPlanDocument(row.id.toUpperCase());
      const expected = document();
      delete expected.background;
      expect(data).toEqual(expected);
      expect(data).not.toHaveProperty("background");
      expect(data.seats[0]).not.toHaveProperty("label");
      expect(JSON.stringify(data)).not.toMatch(
        /private-background|비공개 좌석|createdBy|publishedAt/,
      );
      const dal = await getFloorPlanWithAccess(row.id, database.db);
      expect(dal?.document).not.toHaveProperty("background");
      expect(dal?.document.seats[0]).not.toHaveProperty("label");
    },
  );
  it("keeps floor team access independent from another floor and space grants", async () => {
    const row = await plan({ floorId: actors.restrictedFloorId });
    await expect(
      queries(actors.member).getFloorPlanDocument(row.id),
    ).resolves.toBeDefined();
    for (const actor of [
      actors.person,
      actors.otherMember,
      actors.otherOperator,
    ])
      await expect(
        queries(actor).getFloorPlanDocument(row.id),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await database.db.insert(accessGrants).values({
      targetType: "space",
      targetId: actors.restrictedFloorId,
      teamId: actors.otherTeamId,
    });
    await expect(
      queries(actors.otherMember).getFloorPlanDocument(row.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("allows an operator's own closed floor but not another branch operator", async () => {
    await database.db
      .update(floors)
      .set({ access: "closed" })
      .where(eq(floors.id, actors.floorId));
    const row = await plan();
    await expect(
      queries(actors.operator).getFloorPlanDocument(row.id),
    ).resolves.toBeDefined();
    for (const actor of [actors.person, actors.member, actors.otherOperator])
      await expect(
        queries(actor).getFloorPlanDocument(row.id),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("honors floor.view removal even when the floor is otherwise accessible", async () => {
    const row = await plan();
    await database.db
      .insert(roleSettings)
      .values({ branchId: actors.branchId, role: "user", permissions: [] });
    for (const actor of [actors.person, actors.member, actors.operator])
      await expect(
        queries(actor).getFloorPlanDocument(row.id),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("does not memoize permission changes between independent reads", async () => {
    const row = await plan();
    const read = queries();
    await expect(read.getFloorPlanDocument(row.id)).resolves.toBeDefined();
    await database.db
      .update(floors)
      .set({ access: "closed" })
      .where(eq(floors.id, actors.floorId));
    await expect(read.getFloorPlanDocument(row.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
  it("uses two stages and four statements independently of additional floors and grants", async () => {
    const row = await plan();
    meter.start();
    await queries().getFloorPlanDocument(row.id);
    const before = meter.stop();
    expect(before.perStage).toEqual([1, 3]);
    await database.db.insert(floors).values(
      Array.from({ length: 12 }, (_, index) => ({
        branchId: actors.branchId,
        name: `추가 ${index}`,
        level: index + 20,
      })),
    );
    await database.db.insert(accessGrants).values({
      targetType: "floor",
      targetId: actors.floorId,
      teamId: actors.otherTeamId,
    });
    meter.start();
    await queries().getFloorPlanDocument(row.id);
    expect(meter.stop()).toEqual(before);
  });
  it("adds the published reference through the existing floor query without changing its budget", async () => {
    meter.start();
    const before = await bookingQueries().getFloorDay(
      actors.branchId,
      actors.floorId,
      bookingDate,
    );
    const budget = meter.stop();
    expect(before.floor.plan).toBeNull();
    const row = await plan();
    await database.db
      .update(floors)
      .set({ publishedPlanId: row.id })
      .where(eq(floors.id, actors.floorId));
    meter.start();
    const after = await bookingQueries().getFloorDay(
      actors.branchId,
      actors.floorId,
      bookingDate,
    );
    expect(meter.stop()).toEqual(budget);
    expect(after.floor.plan).toEqual({ id: row.id, version: 1 });
    expect(after.floors.find(({ id }) => id === actors.floorId)?.plan).toEqual(
      after.floor.plan,
    );
    expect(Object.keys(after.floor).sort()).toEqual([
      "id",
      "level",
      "name",
      "plan",
      "sortOrder",
    ]);
    expect(
      after.spaces.find(({ id }) => id === actors.restrictedSpaceId),
    ).toEqual({
      id: actors.restrictedSpaceId,
      kind: "restricted",
      type: "meeting_room",
    });
  });
  it.each(["draft", "archived", "other-floor"] as const)(
    "does not advertise an invalid current plan pointer (%s)",
    async (kind) => {
      const row = await plan(
        kind === "other-floor"
          ? { floorId: actors.otherFloorId }
          : { status: kind },
      );
      await database.db
        .update(floors)
        .set({ publishedPlanId: row.id })
        .where(eq(floors.id, actors.floorId));
      const data = await bookingQueries().getBranchFloors(actors.branchId);
      expect(
        data.floors.find(({ id }) => id === actors.floorId)?.plan,
      ).toBeNull();
    },
  );
  it("preserves next-day maintenance boundaries only for authorized spaces with no identity fields", async () => {
    await database.db.insert(spaceBlocks).values({
      spaceId: actors.publicSpaceId,
      during: {
        start: bookingRange("20:00", "21:00").start,
        end: new Date("2026-10-08T03:00:00.000Z"),
      },
      reason: "점검 이유 비공개",
      createdBy: actors.operator.userId,
    });
    const data = await bookingQueries().getFloorDay(
      actors.branchId,
      actors.floorId,
      bookingDate,
    );
    const space = data.spaces.find(({ id }) => id === actors.publicSpaceId);
    if (!space || space.kind !== "accessible")
      throw new Error("Expected the accessible space.");
    expect(space.planIntervals).toEqual([
      {
        start: "2026-10-07T11:00:00.000Z",
        end: "2026-10-08T03:00:00.000Z",
        kind: "maintenance",
      },
    ]);
    expect(space.intervals[0]?.end).toBe("2026-10-07T13:00:00.000Z");
    expect(JSON.stringify(space.planIntervals)).not.toMatch(
      /reason|createdBy|userId|teamId|점검 이유/,
    );
  });
  it("does not mutate the stored public document during projection", async () => {
    const row = await plan();
    await queries().getFloorPlanDocument(row.id);
    const [stored] = await database.db
      .select({
        document: floorPlans.document,
        background: floorPlans.backgroundImage,
      })
      .from(floorPlans)
      .where(eq(floorPlans.id, row.id));
    expect(stored?.document).toHaveProperty("background");
    expect(stored?.document.seats[0]).toHaveProperty(
      "label",
      "비공개 좌석 이름",
    );
    expect(stored?.background).toBe("private-background-key.webp");
    const raw = await database.db.execute(
      sql`select count(*)::int as count from floor_plans`,
    );
    expect(raw.rows[0]?.count).toBe(1);
  });
});

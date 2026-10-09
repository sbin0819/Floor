import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createPlanEditorActions } from "@/features/floor-plan/editor-action-factory";
import { createPlanEditorQueries } from "@/features/floor-plan/editor-query-factory";
import { createFloorPlanQueries } from "@/features/floor-plan/query-factory";
import { createBookingQueries } from "@/features/bookings/query-factory";
import { ActionError } from "@/lib/actions/result";
import type { Session } from "@/lib/auth/types";
import * as adminDal from "@/lib/dal/admin";
import * as editorDal from "@/lib/dal/floor-plan-editor";
import * as schema from "@/lib/db/schema";
import {
  accessGrants,
  bookings,
  branchStaff,
  floorPlans,
  floors,
  roleSettings,
  spaces,
  users,
} from "@/lib/db/schema";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";
import {
  bookingDate,
  bookingNow,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

describe("floor-plan draft editor", () => {
  let database: TestDatabase;
  let fixture: BookingActors;
  let meter: ReturnType<typeof createQueryMeter>;
  const queries: string[] = [];
  const logError = vi.fn();
  beforeAll(async () => {
    database = await createTestDatabase();
    database.db = drizzle({
      client: database.client,
      schema,
      logger: { logQuery: (query) => queries.push(query) },
    });
    meter = createQueryMeter(database.client);
  });
  afterAll(async () => {
    meter.restore();
    await database.client.close();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    fixture = await seedBookingActors(database);
    queries.length = 0;
  });
  function document(): FloorPlanDocument {
    return {
      schema: 1,
      unit: "mm",
      bounds: { w: 30000, h: 20000 },
      walls: [],
      openings: [],
      spaces: [],
      seats: [],
      fixtures: [],
    };
  }
  function shape(
    spaceId = fixture.publicSpaceId,
    id = "room",
  ): FloorPlanDocument["spaces"][number] {
    return {
      id,
      spaceId,
      polygon: [
        [0, 0],
        [4000, 0],
        [4000, 4000],
        [0, 4000],
      ],
      label: { at: [2000, 2000] },
    };
  }
  function actions(
    session: Session | null = fixture.operator,
    now = bookingNow,
  ) {
    return createPlanEditorActions({
      database: database.db,
      getSession: async () => session,
      now: () => now,
      logError,
    });
  }
  function input(overrides: Record<string, unknown> = {}) {
    return {
      floorId: fixture.floorId,
      basePlanId: null,
      revision: null,
      document: document(),
      ...overrides,
    };
  }
  function readers(session = fixture.operator) {
    return createPlanEditorQueries({
      database: database.db,
      requireSession: async () => session,
    });
  }
  function read(overrides = {}, session = fixture.operator) {
    return readers(session).getPlanEditor({
      branchId: fixture.branchId,
      floorId: fixture.floorId,
      ...overrides,
    });
  }
  async function plan(overrides: Partial<typeof floorPlans.$inferInsert> = {}) {
    const [row] = await database.db
      .insert(floorPlans)
      .values({
        floorId: fixture.floorId,
        version: 1,
        status: "published",
        document: document(),
        createdBy: fixture.operator.userId,
        createdAt: bookingNow,
        publishedAt: bookingNow,
        backgroundImage: "private-background.webp",
        ...overrides,
      })
      .returning();
    if (!row) throw new Error("Missing fixture plan.");
    if (row.status === "published")
      await database.db
        .update(floors)
        .set({ publishedPlanId: row.id })
        .where(eq(floors.id, row.floorId));
    return row;
  }
  function allPlans() {
    return database.db.select().from(floorPlans).orderBy(floorPlans.version);
  }

  it("50. defaults legacy plans to revision zero with nullable editor metadata and rejects a negative revision", async () => {
    const before = await plan();
    expect(before).toMatchObject({
      revision: 0,
      updatedAt: null,
      updatedBy: null,
    });
    await expect(
      database.db
        .update(floorPlans)
        .set({ revision: -1 })
        .where(eq(floorPlans.id, before.id)),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint: "floor_plans_revision_nonnegative" },
    });
    expect(await allPlans()).toEqual([before]);
  });
  it("reads published-seat future counts once without counting draft-only, ended or cancelled bookings or adding SQL", async () => {
    const doc = document();
    doc.seats.push({
      id: "published-seat",
      spaceId: fixture.deskId,
      at: [1000, 1000],
      size: [1000, 500],
      rotation: 0,
    });
    await plan({ document: doc });
    await plan({
      version: 2,
      status: "draft",
      document: {
        ...doc,
        seats: [
          ...doc.seats,
          {
            id: "draft-seat",
            spaceId: fixture.otherDeskId,
            at: [3000, 1000],
            size: [1000, 500],
            rotation: 0,
          },
        ],
      },
    });
    await insertFixtureBooking(database, fixture, { spaceId: fixture.deskId });
    await insertFixtureBooking(database, fixture, {
      spaceId: fixture.deskId,
      during: {
        start: new Date(bookingNow.getTime() - 3600000),
        end: new Date(bookingNow.getTime() - 600000),
      },
    });
    await insertFixtureBooking(database, fixture, {
      spaceId: fixture.deskId,
      status: "cancelled",
      cancelledAt: bookingNow,
    });
    await insertFixtureBooking(database, fixture, {
      spaceId: fixture.otherDeskId,
    });
    const now = vi.fn(() => bookingNow);
    meter.start();
    const data = await createPlanEditorQueries({
      database: database.db,
      requireSession: async () => fixture.operator,
      now,
    }).getPlanEditor({ branchId: fixture.branchId, floorId: fixture.floorId });
    expect(meter.stop().perStage).toEqual([4, 2]);
    expect(now).toHaveBeenCalledOnce();
    expect(
      data.spaces.find((row) => row.id === fixture.deskId)?.futureBookingCount,
    ).toBe(1);
    expect(
      data.spaces.find((row) => row.id === fixture.otherDeskId)
        ?.futureBookingCount,
    ).toBe(0);
    expect(
      data.spaces
        .filter((row) => row.type !== "desk")
        .every((row) => row.futureBookingCount === 0),
    ).toBe(true);
  });
  it("50. keeps updated_by nullable and restricts deleting its referenced user", async () => {
    const userId = crypto.randomUUID();
    await database.db.insert(users).values({
      id: userId,
      name: "편집한 사람",
      email: "editor@example.test",
    });
    const row = await plan({ updatedBy: userId });
    await expect(
      database.db.delete(users).where(eq(users.id, userId)),
    ).rejects.toMatchObject({
      cause: {
        code: "23001",
        constraint: "floor_plans_updated_by_users_id_fk",
      },
    });
    await expect(
      database.db
        .update(floorPlans)
        .set({ updatedBy: crypto.randomUUID() })
        .where(eq(floorPlans.id, row.id)),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    expect(await allPlans()).toEqual([row]);
  });
  it("reads an empty floor editor in two stages without creating a draft", async () => {
    meter.start();
    const result = await read();
    expect(meter.stop().perStage).toEqual([4, 2]);
    expect(result).toMatchObject({
      branch: { id: fixture.branchId, name: "강남점", timezone: "Asia/Seoul" },
      floor: {
        id: fixture.floorId,
        name: "7F",
        access: "everyone",
        allowedTeamIds: [],
      },
      draft: null,
      published: null,
      canManageSpaces: true,
    });
    expect(result.spaces.map(({ id }) => id)).toContain(fixture.deskId);
    expect(result.spaces.find(({ id }) => id === fixture.deskId)).toMatchObject(
      { parentId: fixture.deskAreaId, type: "desk", archived: false },
    );
    expect(result.spaces.map(({ id }) => id)).not.toContain(
      fixture.archivedSpaceId,
    );
    expect(await allPlans()).toEqual([]);
  });
  it("returns draft and current published source together but no background key, author IDs, or old versions", async () => {
    const published = await plan();
    await plan({
      version: 2,
      status: "archived",
      backgroundImage: "old-private.webp",
    });
    const changed = {
      ...document(),
      bounds: { w: 40000, h: 20000 },
      background: {
        transform: [1, 0, 0, 1, 0, 0] as [
          number,
          number,
          number,
          number,
          number,
          number,
        ],
        opacity: 0.35,
      },
    };
    const draft = await plan({
      version: 3,
      status: "draft",
      revision: 4,
      document: changed,
      publishedAt: null,
      updatedAt: bookingNow,
      updatedBy: fixture.stranger.userId,
    });
    await database.db
      .update(users)
      .set({ name: "바뀐 편집자 이름" })
      .where(eq(users.id, fixture.stranger.userId));
    const result = await read();
    expect(result.published).toEqual({
      planId: published.id,
      version: 1,
      document: published.document,
    });
    expect(result.draft).toEqual({
      planId: draft.id,
      version: 3,
      revision: 4,
      document: changed,
      updatedAt: bookingNow.toISOString(),
      updatedByName: "바뀐 편집자 이름",
    });
    expect(Object.keys(result).sort()).toEqual([
      "adminFilesEnabled",
      "branch",
      "canManageSpaces",
      "draft",
      "floor",
      "published",
      "spaces",
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /private\.webp|private-background|createdBy|updatedBy"|email|bookingRules/,
    );
  });
  it("reads the exact floor and space grants plus referenced archived rows without correlation leaks", async () => {
    await plan({
      document: { ...document(), spaces: [shape(fixture.archivedSpaceId)] },
    });
    await database.db
      .update(floors)
      .set({ access: "teams" })
      .where(eq(floors.id, fixture.floorId));
    await database.db.insert(accessGrants).values({
      targetType: "floor",
      targetId: fixture.floorId,
      teamId: fixture.otherTeamId,
    });
    const result = await read();
    expect(result.floor.allowedTeamIds).toEqual([fixture.otherTeamId]);
    expect(
      result.spaces.find(({ id }) => id === fixture.restrictedSpaceId)
        ?.allowedTeamIds,
    ).toEqual([fixture.teamId]);
    expect(
      result.spaces.find(({ id }) => id === fixture.publicSpaceId)
        ?.allowedTeamIds,
    ).toEqual([]);
    expect(
      result.spaces.find(({ id }) => id === fixture.archivedSpaceId),
    ).toMatchObject({ archived: true, name: "보관한 공간" });
  });
  it("masks every unnecessary field of another floor referenced by a document at the SQL projection", async () => {
    await database.db
      .update(spaces)
      .set({
        name: "타 지점 비밀 공간",
        capacity: 73,
        parentId: fixture.otherDeskId,
        amenities: ["private-equipment"],
        access: "teams",
        archivedAt: bookingNow,
      })
      .where(eq(spaces.id, fixture.otherSpaceId));
    await database.db.insert(accessGrants).values({
      targetType: "space",
      targetId: fixture.otherSpaceId,
      teamId: fixture.otherTeamId,
    });
    await plan({
      document: {
        ...document(),
        spaces: [shape(fixture.otherSpaceId.toUpperCase())],
      },
    });
    const expected = {
      id: fixture.otherSpaceId,
      floorId: fixture.otherFloorId,
      parentId: null,
      type: "meeting_room",
      name: "다른 층의 공간",
      futureBookingCount: 0,
      capacity: null,
      bookable: false,
      amenities: [],
      archived: false,
      access: null,
      allowedTeamIds: [],
    };
    const raw = await editorDal.listPlanEditorSpaces(
      fixture.floorId,
      fixture.operator.userId,
      database.db,
    );
    expect(raw.find(({ id }) => id === fixture.otherSpaceId)).toEqual(expected);
    expect(
      (await read()).spaces.find(({ id }) => id === fixture.otherSpaceId),
    ).toEqual(expected);
    expect(JSON.stringify(raw)).not.toMatch(/타 지점 비밀|private-equipment/);
  });
  it("does not return any unrelated archived or foreign space just because some document has references", async () => {
    await plan({
      document: { ...document(), spaces: [shape(fixture.otherSpaceId)] },
    });
    const result = await read();
    expect(result.spaces.map(({ id }) => id)).toContain(fixture.otherSpaceId);
    expect(result.spaces.map(({ id }) => id)).not.toContain(
      fixture.archivedSpaceId,
    );
    expect(result.spaces.map(({ id }) => id)).not.toContain(
      fixture.restrictedFloorSpaceId,
    );
  });
  it("keeps editor query stages fixed with many active spaces and archived versions", async () => {
    await plan();
    await database.db.insert(spaces).values(
      Array.from({ length: 50 }, (_, index) => ({
        floorId: fixture.floorId,
        type: "meeting_room" as const,
        name: `추가 공간 ${index}`,
        capacity: 4,
      })),
    );
    await database.db.insert(floorPlans).values(
      Array.from({ length: 20 }, (_, index) => ({
        floorId: fixture.floorId,
        version: index + 2,
        status: "archived" as const,
        document: document(),
        createdBy: fixture.operator.userId,
      })),
    );
    meter.start();
    const result = await read();
    expect(meter.stop().perStage).toEqual([4, 2]);
    expect(result.spaces.length).toBeGreaterThan(50);
    expect(result.published?.version).toBe(1);
  });
  it("returns a small sorted admin list in [4, 1] and retains floors without plans", async () => {
    const published = await plan();
    const draft = await plan({
      version: 2,
      status: "draft",
      publishedAt: null,
      updatedAt: bookingNow,
      updatedBy: fixture.operator.userId,
    });
    meter.start();
    const result = await readers().getAdminPlans(fixture.branchId);
    expect(meter.stop().perStage).toEqual([4, 1]);
    expect(result).toEqual({
      branch: { id: fixture.branchId, name: "강남점", timezone: "Asia/Seoul" },
      floors: [
        {
          id: fixture.floorId,
          name: "7F",
          published: {
            planId: published.id,
            version: 1,
            publishedAt: bookingNow.toISOString(),
          },
          draft: {
            planId: draft.id,
            version: 2,
            updatedAt: bookingNow.toISOString(),
            updatedByName: fixture.operator.name,
          },
        },
        {
          id: fixture.restrictedFloorId,
          name: "8F",
          published: null,
          draft: null,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /document|background|revision|createdBy|updatedBy"/,
    );
  });
  it("allows plan-only editors and derives canManageSpaces independently", async () => {
    await database.db.insert(roleSettings).values({
      branchId: fixture.branchId,
      role: "operator",
      permissions: ["plan.edit"],
    });
    expect((await read()).canManageSpaces).toBe(false);
    expect(await actions().saveFloorPlanDraft(input())).toMatchObject({
      ok: true,
    });
    expect(
      (await readers().getAdminPlans(fixture.branchId)).floors,
    ).toHaveLength(2);
  });
  it("uses current role settings on every request and refuses plan.edit removal", async () => {
    await read();
    await database.db.insert(roleSettings).values({
      branchId: fixture.branchId,
      role: "operator",
      permissions: ["space.manage"],
    });
    await expect(read()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      readers().getAdminPlans(fixture.branchId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await actions().saveFloorPlanDraft(input())).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(await allPlans()).toEqual([]);
  });
  it.each(["person", "admin", "otherOperator"] as const)(
    "conceals editor, list and saving from %s",
    async (actor) => {
      await expect(read({}, fixture[actor])).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(
        readers(fixture[actor]).getAdminPlans(fixture.branchId),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await actions(fixture[actor]).saveFloorPlanDraft(input())).toEqual(
        { ok: false, code: "NOT_FOUND" },
      );
    },
  );
  it("requires the URL branch to match the actual floor and rejects invalid IDs", async () => {
    for (const value of [
      { floorId: fixture.otherFloorId },
      { branchId: fixture.otherBranchId },
      { floorId: crypto.randomUUID() },
      { floorId: "invalid" },
      { branchId: "invalid" },
    ]) {
      await expect(read(value)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    await expect(
      readers().getAdminPlans(fixture.otherBranchId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(readers().getAdminPlans("invalid")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(
      (
        await read({
          floorId: fixture.floorId.toUpperCase(),
          branchId: fixture.branchId.toUpperCase(),
        })
      ).floor.id,
    ).toBe(fixture.floorId);
  });
  it("authenticates before schema checks or database work", async () => {
    const requireSession = vi.fn(async () => {
      throw new ActionError("UNAUTHENTICATED");
    });
    const query = createPlanEditorQueries({
      database: database.db,
      requireSession,
    });
    meter.start();
    await expect(
      query.getPlanEditor({ branchId: "invalid", floorId: "invalid" }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(query.getAdminPlans("invalid")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(await actions(null).saveFloorPlanDraft(null)).toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    expect(meter.stop().statements).toBe(0);
  });
  it.each([
    { revision: -1 },
    { revision: 0.5 },
    { revision: 2147483647 },
    { floorId: "invalid" },
    { basePlanId: "invalid" },
    { createdBy: "spoofed" },
    { document: { schema: 1 } },
  ])("rejects invalid save input without SQL: %j", async (change) => {
    meter.start();
    expect(await actions().saveFloorPlanDraft(input(change))).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect(meter.stop().statements).toBe(0);
  });
  it("rejects a document over 900 KiB without SQL", async () => {
    const doc = document();
    doc.fixtures.push({
      id: "fixture",
      kind: "core",
      polygon: [
        [0, 0],
        [1000, 0],
        [1000, 1000],
      ],
      label: "가".repeat(310000),
    });
    meter.start();
    expect(
      await actions().saveFloorPlanDraft(input({ document: doc })),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(meter.stop().statements).toBe(0);
  });
  it("first save creates only a draft at version 1 revision 1 with the submitted document", async () => {
    const result = await actions().saveFloorPlanDraft(
      input({ floorId: fixture.floorId.toUpperCase() }),
    );
    expect(result).toEqual({
      ok: true,
      data: {
        planId: expect.any(String),
        version: 1,
        revision: 1,
        savedAt: bookingNow.toISOString(),
      },
    });
    const [row] = await allPlans();
    expect(row).toMatchObject({
      document: document(),
      status: "draft",
      createdBy: fixture.operator.userId,
      updatedBy: fixture.operator.userId,
      createdAt: bookingNow,
      updatedAt: bookingNow,
      revision: 1,
      backgroundImage: null,
      publishedAt: null,
    });
    expect(
      (
        await database.db
          .select()
          .from(floors)
          .where(eq(floors.id, fixture.floorId))
      )[0]?.publishedPlanId,
    ).toBeNull();
  });
  it("uses max archived version +1 and copies the current published background without changing any old row", async () => {
    const published = await plan();
    const archived = await plan({ version: 7, status: "archived" });
    const beforeBooking = await insertFixtureBooking(database, fixture);
    const changed = { ...document(), spaces: [shape()] };
    expect(
      await actions().saveFloorPlanDraft(
        input({ basePlanId: published.id.toUpperCase(), document: changed }),
      ),
    ).toMatchObject({ ok: true, data: { version: 8, revision: 1 } });
    const rows = await allPlans();
    expect(rows.slice(0, 2)).toEqual([published, archived]);
    expect(rows[2]).toMatchObject({
      backgroundImage: published.backgroundImage,
      document: changed,
      status: "draft",
    });
    expect(await database.db.select().from(bookings)).toEqual([beforeBooking]);
    expect(
      (
        await database.db
          .select()
          .from(floors)
          .where(eq(floors.id, fixture.floorId))
      )[0]?.publishedPlanId,
    ).toBe(published.id);
  });
  it("increments the existing draft without locking the floor and does not change its creator or version", async () => {
    const original = await plan({
      status: "draft",
      revision: 3,
      updatedAt: bookingNow,
      updatedBy: fixture.stranger.userId,
      createdBy: fixture.stranger.userId,
    });
    queries.length = 0;
    const now = new Date(bookingNow.getTime() + 5000);
    const changed = { ...document(), bounds: { w: 40000, h: 25000 } };
    expect(
      await actions(fixture.operator, now).saveFloorPlanDraft(
        input({ revision: 3, document: changed }),
      ),
    ).toEqual({
      ok: true,
      data: {
        planId: original.id,
        version: original.version,
        revision: 4,
        savedAt: now.toISOString(),
      },
    });
    const locks = queries.filter((query) =>
      /\bfor (?:update|share|no key update|key share)\b/i.test(query),
    );
    expect(locks).toHaveLength(1);
    expect(locks[0]).toMatch(/from "floor_plans".*for update/i);
    expect(
      queries.find((query) => /^update "floor_plans"/i.test(query)),
    ).toMatch(/"status" = .*"revision" = .*returning/i);
    expect((await allPlans())[0]).toMatchObject({
      id: original.id,
      version: 1,
      revision: 4,
      createdBy: fixture.stranger.userId,
      updatedBy: fixture.operator.userId,
      document: changed,
      updatedAt: now,
      backgroundImage: original.backgroundImage,
    });
  });
  it("allows a schema-valid draft with overlap, unknown space references, and missing shapes", async () => {
    const doc = {
      ...document(),
      spaces: [shape(), shape(crypto.randomUUID(), "overlap")],
    };
    expect(
      await actions().saveFloorPlanDraft(input({ document: doc })),
    ).toMatchObject({ ok: true });
    expect((await allPlans())[0]?.document).toEqual(doc);
  });
  it.each([null, 0, 2])(
    "rejects revision %s when another editor already saved revision 1",
    async (revision) => {
      const draft = await plan({ status: "draft", revision: 1 });
      expect(await actions().saveFloorPlanDraft(input({ revision }))).toEqual({
        ok: false,
        code: "STALE",
      });
      expect(await allPlans()).toEqual([draft]);
    },
  );
  it("rejects an old draft revision when no draft remains and rejects a changed published base", async () => {
    const published = await plan();
    expect(
      await actions().saveFloorPlanDraft(
        input({ basePlanId: published.id, revision: 2 }),
      ),
    ).toEqual({ ok: false, code: "STALE" });
    expect(await actions().saveFloorPlanDraft(input())).toEqual({
      ok: false,
      code: "STALE",
    });
    expect(await allPlans()).toEqual([published]);
  });
  it("rejects a stale source generation even if a new draft reuses its revision", async () => {
    const old = await plan({ status: "archived", version: 1 });
    const published = await plan({ version: 2 });
    const draft = await plan({ version: 3, status: "draft", revision: 1 });
    expect(
      await actions().saveFloorPlanDraft(
        input({ basePlanId: old.id, revision: 1 }),
      ),
    ).toEqual({ ok: false, code: "STALE" });
    expect(await allPlans()).toEqual([old, published, draft]);
  });
  it("rechecks for a competing first draft after obtaining the floor lock", async () => {
    const original = adminDal.lockAdminFloor;
    vi.spyOn(adminDal, "lockAdminFloor").mockImplementation(
      async (floorId, mode, db) => {
        const floor = await original(floorId, mode, db);
        if (!db) throw new Error("Expected transaction.");
        await db.insert(floorPlans).values({
          floorId,
          version: 1,
          status: "draft",
          document: document(),
          createdBy: fixture.stranger.userId,
          revision: 1,
        });
        return floor;
      },
    );
    expect(await actions().saveFloorPlanDraft(input())).toEqual({
      ok: false,
      code: "STALE",
    });
    expect(await allPlans()).toEqual([]);
    const locks = queries.filter((query) => /for update/i.test(query));
    expect(locks).toHaveLength(3);
    expect(locks[0]).toContain('from "floor_plans"');
    expect(locks[1]).toContain('from "floors"');
    expect(locks[2]).toContain('from "floor_plans"');
  });
  it.each(["membership", "permission"] as const)(
    "rechecks %s after locking an existing draft",
    async (change) => {
      const draft = await plan({ status: "draft", revision: 1 });
      const original = editorDal.lockFloorPlanDraft;
      vi.spyOn(editorDal, "lockFloorPlanDraft").mockImplementation(
        async (floorId, tx) => {
          const row = await original(floorId, tx);
          if (change === "membership")
            await tx
              .delete(branchStaff)
              .where(
                and(
                  eq(branchStaff.branchId, fixture.branchId),
                  eq(branchStaff.userId, fixture.operator.userId),
                ),
              );
          else
            await tx.insert(roleSettings).values({
              branchId: fixture.branchId,
              role: "operator",
              permissions: [],
            });
          return row;
        },
      );
      expect(
        await actions().saveFloorPlanDraft(input({ revision: 1 })),
      ).toEqual({
        ok: false,
        code: change === "membership" ? "NOT_FOUND" : "FORBIDDEN",
      });
      expect(await allPlans()).toEqual([draft]);
    },
  );
  it.each(["membership", "permission"] as const)(
    "rechecks %s after locking the floor for a first draft",
    async (change) => {
      const original = adminDal.lockAdminFloor;
      vi.spyOn(adminDal, "lockAdminFloor").mockImplementation(
        async (floorId, mode, tx) => {
          const row = await original(floorId, mode, tx);
          if (!tx) throw new Error("Expected transaction.");
          if (change === "membership")
            await tx
              .delete(branchStaff)
              .where(
                and(
                  eq(branchStaff.branchId, fixture.branchId),
                  eq(branchStaff.userId, fixture.operator.userId),
                ),
              );
          else
            await tx.insert(roleSettings).values({
              branchId: fixture.branchId,
              role: "operator",
              permissions: [],
            });
          return row;
        },
      );
      expect(await actions().saveFloorPlanDraft(input())).toEqual({
        ok: false,
        code: change === "membership" ? "NOT_FOUND" : "FORBIDDEN",
      });
      expect(await allPlans()).toEqual([]);
    },
  );
  it("rolls back inserted drafts when a later step fails and does not leak the cause", async () => {
    const original = editorDal.insertFloorPlanDraft;
    vi.spyOn(editorDal, "insertFloorPlanDraft").mockImplementation(
      async (...args) => {
        await original(...args);
        throw new Error("private failure");
      },
    );
    expect(await actions().saveFloorPlanDraft(input())).toEqual({
      ok: false,
      code: "INTERNAL",
    });
    expect(await allPlans()).toEqual([]);
    expect(logError).toHaveBeenCalledOnce();
  });
  it("rolls back changed documents and revision metadata on a late update failure", async () => {
    const draft = await plan({ status: "draft", revision: 1 });
    const original = editorDal.updateFloorPlanDraft;
    vi.spyOn(editorDal, "updateFloorPlanDraft").mockImplementation(
      async (...args) => {
        await original(...args);
        throw new Error("private failure");
      },
    );
    expect(await actions().saveFloorPlanDraft(input({ revision: 1 }))).toEqual({
      ok: false,
      code: "INTERNAL",
    });
    expect(await allPlans()).toEqual([draft]);
  });
  it("returns STALE when the conditional update no longer matches", async () => {
    const draft = await plan({ status: "draft", revision: 1 });
    vi.spyOn(editorDal, "updateFloorPlanDraft").mockResolvedValue(null);
    expect(await actions().saveFloorPlanDraft(input({ revision: 1 }))).toEqual({
      ok: false,
      code: "STALE",
    });
    expect(await allPlans()).toEqual([draft]);
  });
  it("keeps new drafts invisible to the member GET and floor day metadata", async () => {
    const published = await plan({
      document: { ...document(), spaces: [shape()] },
    });
    const result = await actions().saveFloorPlanDraft(
      input({
        basePlanId: published.id,
        document: {
          ...document(),
          fixtures: [
            {
              id: "private-draft",
              kind: "core",
              polygon: [
                [0, 0],
                [1000, 0],
                [1000, 1000],
              ],
              label: "운영자 초안",
            },
          ],
        },
      }),
    );
    if (!result.ok) throw new Error(result.code);
    const member = createFloorPlanQueries({
      database: database.db,
      requireSession: async () => fixture.person,
    });
    await expect(
      member.getFloorPlanDocument(result.data.planId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await member.getFloorPlanDocument(published.id)).toEqual(
      published.document,
    );
    const floor = await createBookingQueries({
      database: database.db,
      requireSession: async () => fixture.person,
      now: () => bookingNow,
    }).getFloorDay(fixture.branchId, fixture.floorId, bookingDate);
    expect(floor.floor.plan).toEqual({
      id: published.id,
      version: published.version,
    });
    expect(JSON.stringify(floor)).not.toContain("운영자 초안");
  });
});

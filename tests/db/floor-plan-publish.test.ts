import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
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
import { createPlanPublishActions } from "@/features/floor-plan/publish-action-factory";
import { createPlanPublishQueries } from "@/features/floor-plan/publish-query-factory";
import { createPlanEditorQueries } from "@/features/floor-plan/editor-query-factory";
import { createFloorPlanQueries } from "@/features/floor-plan/query-factory";
import { createDeskBookingAction } from "@/features/bookings/create-desk-booking-factory";
import { createDeskParts } from "@/features/bookings/desk-parts";
import { createAdminActions } from "@/features/admin/manage-factory";
import { createBookingQueries } from "@/features/bookings/query-factory";
import type { Session } from "@/lib/auth/types";
import { ActionError } from "@/lib/actions/result";
import * as adminDal from "@/lib/dal/admin";
import * as publishDal from "@/lib/dal/floor-plan-publish";
import * as schema from "@/lib/db/schema";
import {
  bookings,
  branchStaff,
  floorPlans,
  floors,
  roleSettings,
  spaces,
  users,
  branches,
  accessGrants,
} from "@/lib/db/schema";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";
import { loadSeedData } from "@/lib/seed/data";
import {
  bookingNow,
  bookingDate,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

describe("floor plan publication and restoration", () => {
  let database: TestDatabase;
  let actor: BookingActors;
  let meter: ReturnType<typeof createQueryMeter>;
  const statements: string[] = [];
  const publisher = { publish: vi.fn(async () => {}) };
  const logError = vi.fn();
  beforeAll(async () => {
    database = await createTestDatabase();
    database.db = drizzle({
      client: database.client,
      schema,
      logger: {
        logQuery(query) {
          statements.push(query);
        },
      },
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
    actor = await seedBookingActors(database);
    await database.db
      .update(spaces)
      .set({ archivedAt: bookingNow })
      .where(
        and(
          eq(spaces.floorId, actor.floorId),
          notInArray(spaces.id, [
            actor.deskAreaId,
            actor.deskId,
            actor.otherDeskId,
          ]),
        ),
      );
    statements.length = 0;
  });
  function document(): FloorPlanDocument {
    return {
      schema: 1,
      unit: "mm",
      bounds: { w: 20000, h: 20000 },
      walls: [],
      openings: [],
      fixtures: [],
      spaces: [
        {
          id: "area",
          spaceId: actor.deskAreaId,
          polygon: [
            [0, 0],
            [20000, 0],
            [20000, 20000],
            [0, 20000],
          ],
          label: { at: [1000, 1000] },
        },
      ],
      seats: [actor.deskId, actor.otherDeskId].map((id, index) => ({
        id: `seat-${index}`,
        spaceId: id,
        at: [2000 + index * 4000, 3000],
        size: [1400, 700],
        rotation: 0,
      })),
    };
  }
  function actions(
    session: Session | null = actor.operator,
    now = () => bookingNow,
  ) {
    return createPlanPublishActions({
      database: database.db,
      getSession: async () => session,
      now,
      publisher,
      logError,
    });
  }
  function queries(session = actor.operator) {
    return createPlanPublishQueries({
      database: database.db,
      requireSession: async () => session,
      now: () => bookingNow,
    });
  }
  async function draft(doc = document(), version = 2) {
    const [row] = await database.db
      .insert(floorPlans)
      .values({
        floorId: actor.floorId,
        version,
        revision: 1,
        document: doc,
        createdBy: actor.operator.userId,
        backgroundImage: "protected.webp",
      })
      .returning();
    if (!row) throw new Error("Missing draft.");
    return {
      floorId: actor.floorId,
      expectedDraftId: row.id,
      revision: row.revision,
    };
  }
  async function published(doc = document(), version = 1) {
    const [row] = await database.db
      .insert(floorPlans)
      .values({
        floorId: actor.floorId,
        version,
        status: "published",
        document: doc,
        createdBy: actor.operator.userId,
        publishedAt: bookingNow,
        backgroundImage: "old.webp",
      })
      .returning();
    if (!row) throw new Error("Missing plan.");
    await database.db
      .update(floors)
      .set({ publishedPlanId: row.id })
      .where(eq(floors.id, actor.floorId));
    return row;
  }
  async function snapshot() {
    return {
      spaces: await database.db.select().from(spaces).orderBy(spaces.id),
      plans: await database.db.select().from(floorPlans).orderBy(floorPlans.id),
      floors: await database.db.select().from(floors).orderBy(floors.id),
      bookings: await database.db.select().from(bookings).orderBy(bookings.id),
    };
  }
  function addSeat(doc: FloorPlanDocument, name = "A-25") {
    const id = crypto.randomUUID();
    doc.seats.push({
      id: `new-${name}`,
      spaceId: id,
      at: [10000, 3000],
      size: [1400, 700],
      rotation: 0,
      label: name,
    });
    return id;
  }
  async function expectBlocked(
    input: Awaited<ReturnType<typeof draft>>,
    code: string,
  ) {
    const before = await snapshot();
    expect(await actions().publishFloorPlan(input)).toMatchObject({
      ok: false,
      code: "PLAN_INVALID",
      issues: expect.arrayContaining([expect.objectContaining({ code })]),
    });
    expect(await snapshot()).toEqual(before);
    expect(publisher.publish).not.toHaveBeenCalled();
  }
  it("publishes exactly once, switches the immutable plan pointer and preserves original creator/background", async () => {
    const old = await published();
    const doc = document();
    const id = addSeat(doc);
    const input = await draft(doc);
    const result = await actions().publishFloorPlan(input);
    expect(result).toEqual({
      ok: true,
      data: {
        planId: input.expectedDraftId,
        version: 2,
        publishedAt: bookingNow.toISOString(),
        seats: { created: 1, renamed: 0, archived: 0 },
      },
    });
    const [seat] = await database.db
      .select()
      .from(spaces)
      .where(eq(spaces.id, id));
    expect(seat).toMatchObject({
      floorId: actor.floorId,
      parentId: actor.deskAreaId,
      name: "A-25",
      type: "desk",
      capacity: 1,
      bookable: true,
      access: null,
      amenities: [],
      bookingRules: {},
      archivedAt: null,
    });
    const plans = await database.db
      .select()
      .from(floorPlans)
      .orderBy(floorPlans.version);
    expect(plans[0]).toMatchObject({ id: old.id, status: "archived" });
    expect(plans[1]).toMatchObject({
      status: "published",
      updatedBy: actor.operator.userId,
      createdBy: actor.operator.userId,
      updatedAt: bookingNow,
      backgroundImage: "protected.webp",
    });
    expect(
      (
        await database.db
          .select()
          .from(floors)
          .where(eq(floors.id, actor.floorId))
      )[0]?.publishedPlanId,
    ).toBe(input.expectedDraftId);
    expect(publisher.publish).toHaveBeenCalledExactlyOnceWith(
      `floor:${actor.floorId}`,
      { type: "plan.published", floorId: actor.floorId, version: 2 },
    );
    expect(await actions().publishFloorPlan(input)).toEqual({
      ok: false,
      code: "STALE",
    });
  });
  it("rejects missing shapes without any writes", async () => {
    const doc = document();
    doc.spaces = [];
    await expectBlocked(await draft(doc), "SHAPE_MISSING");
  });
  it("rejects a referenced archived desk without reviving it", async () => {
    await database.db
      .update(spaces)
      .set({ archivedAt: bookingNow })
      .where(eq(spaces.id, actor.deskId));
    await expectBlocked(await draft(), "SEAT_ARCHIVED");
  });
  it("keeps the final seat name namespace unique against a room", async () => {
    const doc = document();
    doc.seats[0]!.label = "데스크 구역";
    await expectBlocked(await draft(doc), "SEAT_LABEL_DUPLICATE");
  });
  it("blocks removing an ongoing booking and preview exposes no title/email/IDs", async () => {
    await insertFixtureBooking(database, actor, {
      spaceId: actor.deskId,
      title: "private title",
    });
    const doc = document();
    doc.seats.shift();
    const input = await draft(doc);
    const result = await queries().previewPublishFloorPlan({
      ...input,
      branchId: actor.branchId,
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        blockingBookings: [
          {
            seatName: "좌석 1",
            date: bookingDate,
            part: null,
            timeRange: "12:00–13:00",
            bookerName: actor.person.name,
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain("private title");
    expect(JSON.stringify(result)).not.toContain(actor.person.email);
    expect(JSON.stringify(result)).not.toContain(actor.person.userId);
    await expectBlocked(input, "SEAT_REMOVED_WITH_BOOKINGS");
  });
  it("returns the same geometry and booking issues as preview while writing nothing", async () => {
    await insertFixtureBooking(database, actor, { spaceId: actor.deskId });
    const doc = document();
    doc.seats.shift();
    doc.spaces[0]!.label.at = [0, 0];
    const input = await draft(doc);
    const before = await snapshot();
    const preview = await queries().previewPublishFloorPlan({
      ...input,
      branchId: actor.branchId,
    });
    const result = await actions().publishFloorPlan(input);
    expect(preview.ok).toBe(true);
    expect(result.ok).toBe(false);
    if (!preview.ok || result.ok)
      throw new Error("Expected validation result.");
    expect(result.issues).toEqual(preview.data.issues);
    expect(result.issues?.map((issue) => issue.code)).toEqual([
      "LABEL_OUTSIDE",
      "SEAT_REMOVED_WITH_BOOKINGS",
    ]);
    expect(await snapshot()).toEqual(before);
  });
  it("redacts booker name in SQL when plan.edit remains but manage_all is disabled", async () => {
    await database.db.insert(roleSettings).values({
      branchId: actor.branchId,
      role: "operator",
      permissions: ["plan.edit"],
    });
    await insertFixtureBooking(database, actor, { spaceId: actor.deskId });
    const doc = document();
    doc.seats.shift();
    const input = await draft(doc);
    expect(
      await queries().previewPublishFloorPlan({
        ...input,
        branchId: actor.branchId,
      }),
    ).toMatchObject({
      ok: true,
      data: { blockingBookings: [{ bookerName: null }] },
    });
    expect(
      statements.some((query) =>
        /case when \$\d+ then "users"\."name" else null end/.test(query),
      ),
    ).toBe(true);
  });
  it.each(["ended", "cancelled"])(
    "ignores %s booking when archiving",
    async (kind) => {
      await insertFixtureBooking(database, actor, {
        spaceId: actor.deskId,
        ...(kind === "ended"
          ? {
              during: {
                start: new Date(bookingNow.getTime() - 3600000),
                end: bookingNow,
              },
            }
          : { status: "cancelled", cancelledAt: bookingNow }),
      });
      const doc = document();
      doc.seats.shift();
      expect(await actions().publishFloorPlan(await draft(doc))).toMatchObject({
        ok: true,
        data: { seats: { archived: 1 } },
      });
    },
  );
  it("blocks the area itself on first seating but not child seat bookings", async () => {
    await database.db
      .update(spaces)
      .set({ archivedAt: bookingNow })
      .where(inArray(spaces.id, [actor.deskId, actor.otherDeskId]));
    const doc = document();
    doc.seats = [];
    addSeat(doc);
    await insertFixtureBooking(database, actor, { spaceId: actor.deskAreaId });
    await expectBlocked(await draft(doc), "AREA_HAS_BOOKINGS");
  });
  it("also blocks a legacy bookable occupied area", async () => {
    await database.db
      .update(spaces)
      .set({ bookable: true })
      .where(eq(spaces.id, actor.deskAreaId));
    await insertFixtureBooking(database, actor, { spaceId: actor.deskAreaId });
    await expectBlocked(await draft(), "AREA_HAS_BOOKINGS");
  });
  it("does not confuse a child booking with an area booking and clears legacy bookable", async () => {
    await database.db
      .update(spaces)
      .set({ bookable: true })
      .where(eq(spaces.id, actor.deskAreaId));
    await insertFixtureBooking(database, actor, { spaceId: actor.deskId });
    expect(await actions().publishFloorPlan(await draft())).toMatchObject({
      ok: true,
    });
    expect(
      (
        await database.db
          .select()
          .from(spaces)
          .where(eq(spaces.id, actor.deskAreaId))
      )[0]?.bookable,
    ).toBe(false);
  });
  it.each(["swap", "archive-reuse", "rename-reuse"])(
    "supports %s without transient name collisions",
    async (kind) => {
      const doc = document();
      if (kind === "swap") {
        doc.seats[0]!.label = "좌석 2";
        doc.seats[1]!.label = "좌석 1";
      } else if (kind === "archive-reuse") {
        doc.seats.shift();
        addSeat(doc, "좌석 1");
      } else {
        doc.seats[0]!.label = "A-30";
        addSeat(doc, "좌석 1");
      }
      const input = await draft(doc);
      statements.length = 0;
      expect(await actions().publishFloorPlan(input)).toMatchObject({
        ok: true,
      });
      const writes = statements.filter(
        (query) =>
          query.startsWith('update "spaces"') ||
          query.startsWith('insert into "spaces"'),
      );
      if (kind !== "archive-reuse") expect(writes[0]).toContain("'~' ||");
      else expect(writes[0]).toContain('"archived_at"');
      const rows = await database.db
        .select()
        .from(spaces)
        .where(
          and(
            eq(spaces.floorId, actor.floorId),
            sql`${spaces.archivedAt} is null`,
          ),
        );
      expect(new Set(rows.map((row) => row.name.toLowerCase())).size).toBe(
        rows.length,
      );
      expect(rows.some((row) => row.name.startsWith("~"))).toBe(false);
    },
  );
  it("preserves existing seat settings while renaming", async () => {
    await database.db
      .update(spaces)
      .set({
        capacity: 4,
        amenities: ["monitor"],
        bookingRules: { maxMinutesPerBooking: 60 },
        access: "everyone",
      })
      .where(eq(spaces.id, actor.deskId));
    const doc = document();
    doc.seats[0]!.label = "새 이름";
    expect(await actions().publishFloorPlan(await draft(doc))).toMatchObject({
      ok: true,
    });
    expect(
      (
        await database.db
          .select()
          .from(spaces)
          .where(eq(spaces.id, actor.deskId))
      )[0],
    ).toMatchObject({
      name: "새 이름",
      capacity: 4,
      amenities: ["monitor"],
      bookingRules: { maxMinutesPerBooking: 60 },
      access: "everyone",
    });
  });
  it("bulk-renames many desks with two name UPDATE statements rather than N writes", async () => {
    const doc = document();
    const rows = Array.from({ length: 40 }, (_, index) => ({
      id: crypto.randomUUID(),
      floorId: actor.floorId,
      parentId: actor.deskAreaId,
      type: "desk" as const,
      name: `bulk-${index}`,
    }));
    await database.db.insert(spaces).values(rows);
    doc.seats.push(
      ...rows.map((row, index) => ({
        id: `bulk-${index}`,
        spaceId: row.id,
        label: `changed-${index}`,
        at: [
          1000 + (index % 10) * 1800,
          6000 + Math.floor(index / 10) * 1600,
        ] as [number, number],
        size: [1000, 700] as [number, number],
        rotation: 0,
      })),
    );
    const input = await draft(doc);
    statements.length = 0;
    expect(await actions().publishFloorPlan(input)).toMatchObject({
      ok: true,
      data: { seats: { renamed: 40 } },
    });
    const nameUpdates = statements.filter(
      (query) =>
        query.startsWith('update "spaces" set ') && /"name" =/.test(query),
    );
    expect(nameUpdates).toHaveLength(2);
    expect(nameUpdates[1]).toContain("from (values");
  });
  it("locks floor then draft then all active spaces then changed spaces then bookings, and reads clock after locks", async () => {
    const doc = document();
    doc.seats.shift();
    const input = await draft(doc);
    statements.length = 0;
    const now = vi.fn(() => {
      expect(statements.at(-1)).toContain('from "bookings"');
      expect(statements.at(-1)).toContain("for update");
      return bookingNow;
    });
    expect(
      await actions(actor.operator, now).publishFloorPlan(input),
    ).toMatchObject({ ok: true });
    const locks = statements.filter((query) =>
      /for (update|share)/.test(query),
    );
    expect(locks[0]).toMatch(/from "floors".*for update/);
    expect(locks[1]).toMatch(/from "floor_plans".*for update/);
    expect(locks[2]).toMatch(
      /from "spaces".*order by "spaces"\."id" asc for share/,
    );
    expect(locks[3]).toMatch(
      /from "spaces".*order by "spaces"\."id" asc for update/,
    );
    expect(locks[4]).toMatch(
      /from "bookings".*order by "bookings"\."id" asc for update/,
    );
    expect(now).toHaveBeenCalledOnce();
  });
  it("rolls back seat changes, previous status and pointer when final publication returns no row", async () => {
    await published();
    const doc = document();
    doc.seats[0]!.label = "새 이름";
    const input = await draft(doc);
    const before = await snapshot();
    const original = publishDal.publishPlanRecord;
    vi.spyOn(publishDal, "publishPlanRecord").mockImplementationOnce(
      async (value, db) => {
        await original(value, db);
        return null;
      },
    );
    expect(await actions().publishFloorPlan(input)).toEqual({
      ok: false,
      code: "STALE",
    });
    expect(await snapshot()).toEqual(before);
    expect(publisher.publish).not.toHaveBeenCalled();
  });
  it("maps the exact floor-name 23505 to safe PLAN_INVALID and rolls back", async () => {
    const input = await draft();
    const before = await snapshot();
    vi.spyOn(publishDal, "writePublishedSeats").mockRejectedValueOnce({
      code: "23505",
      constraint: "spaces_floor_name_unique",
      detail: "SECRET NAME",
    });
    const result = await actions().publishFloorPlan(input);
    expect(result).toMatchObject({
      ok: false,
      code: "PLAN_INVALID",
      issues: [{ code: "SEAT_LABEL_DUPLICATE" }],
    });
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(await snapshot()).toEqual(before);
  });
  it("keeps a committed success even when publisher and logger both throw", async () => {
    publisher.publish.mockRejectedValueOnce(new Error("secret"));
    logError.mockImplementationOnce(() => {
      throw new Error("logger");
    });
    expect(await actions().publishFloorPlan(await draft())).toMatchObject({
      ok: true,
    });
    expect(publisher.publish).toHaveBeenCalledOnce();
    expect(logError).toHaveBeenCalledExactlyOnceWith(
      "Plan publication notification failed.",
    );
  });
  it("checks session before malformed inputs and rejects foreign operator/permission denial", async () => {
    expect(await actions(null).publishFloorPlan({})).toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    expect(await actions().publishFloorPlan({})).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
    });
    const input = await draft();
    expect(await actions(actor.otherOperator).publishFloorPlan(input)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    await database.db
      .insert(roleSettings)
      .values({ branchId: actor.branchId, role: "operator", permissions: [] });
    expect(await actions().publishFloorPlan(input)).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
  });
  it("rechecks operator assignment after the floor lock", async () => {
    const input = await draft();
    const original = adminDal.lockAdminFloor;
    vi.spyOn(adminDal, "lockAdminFloor").mockImplementationOnce(
      async (id, mode, tx) => {
        const row = await original(id, mode, tx);
        await tx!
          .delete(branchStaff)
          .where(eq(branchStaff.userId, actor.operator.userId));
        return row;
      },
    );
    expect(await actions().publishFloorPlan(input)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(publisher.publish).not.toHaveBeenCalled();
  });
  it("rejects wrong draft ID even when revision matches a later draft generation", async () => {
    const old = await draft();
    expect(await actions().publishFloorPlan(old)).toMatchObject({ ok: true });
    const next = await draft(document(), 3);
    expect(next.revision).toBe(old.revision);
    const before = await snapshot();
    expect(await actions().publishFloorPlan(old)).toEqual({
      ok: false,
      code: "STALE",
    });
    expect(await snapshot()).toEqual(before);
  });
  it("preview and version reads independently guard sessions, malformed params, foreign branch and permissions", async () => {
    const input = await draft();
    const unauthenticated = createPlanPublishQueries({
      database: database.db,
      requireSession: async () => {
        throw new ActionError("UNAUTHENTICATED");
      },
    });
    expect(
      await unauthenticated.previewPublishFloorPlan({
        ...input,
        branchId: "invalid",
      }),
    ).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    await expect(
      unauthenticated.getPlanVersions({
        floorId: "invalid",
        branchId: "invalid",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(
      await queries().previewPublishFloorPlan({
        ...input,
        branchId: "invalid",
      }),
    ).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(
      await queries(actor.otherOperator).previewPublishFloorPlan({
        ...input,
        branchId: actor.branchId,
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    await expect(
      queries().getPlanVersions({
        floorId: actor.floorId,
        branchId: actor.otherBranchId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await database.db
      .insert(roleSettings)
      .values({ branchId: actor.branchId, role: "operator", permissions: [] });
    expect(
      await queries().previewPublishFloorPlan({
        ...input,
        branchId: actor.branchId,
      }),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
    await expect(
      queries().getPlanVersions({
        floorId: actor.floorId,
        branchId: actor.branchId,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("preview rejects a stale draft generation or revision without exposing its document", async () => {
    const input = await draft();
    expect(
      await queries().previewPublishFloorPlan({
        ...input,
        branchId: actor.branchId,
        expectedDraftId: crypto.randomUUID(),
      }),
    ).toEqual({ ok: false, code: "STALE" });
    expect(
      await queries().previewPublishFloorPlan({
        ...input,
        branchId: actor.branchId,
        revision: 0,
      }),
    ).toEqual({ ok: false, code: "STALE" });
  });
  it("booking first blocks publication, publication first makes the archived seat unbookable", async () => {
    const book = createDeskBookingAction({
      database: database.db,
      getSession: async () => actor.person,
      now: () => bookingNow,
      publisher,
      logError,
    });
    const input = {
      deskId: actor.deskId,
      date: bookingDate,
      part: "pm",
      teamId: null,
    };
    expect(await book(input)).toMatchObject({ ok: true });
    publisher.publish.mockClear();
    const doc = document();
    doc.seats.shift();
    const value = await draft(doc);
    await expectBlocked(value, "SEAT_REMOVED_WITH_BOOKINGS");
    await database.db
      .update(bookings)
      .set({ status: "cancelled", cancelledAt: bookingNow })
      .where(eq(bookings.spaceId, actor.deskId));
    expect(await actions().publishFloorPlan(value)).toMatchObject({ ok: true });
    expect(await book(input)).toEqual({ ok: false, code: "NOT_FOUND" });
  });
  it("keeps preview [4,3], versions [4,1] and editor [4,2] with data and correct published-seat future counts", async () => {
    await published();
    await insertFixtureBooking(database, actor, { spaceId: actor.deskId });
    await insertFixtureBooking(database, actor, {
      spaceId: actor.otherDeskId,
      during: { start: new Date(bookingNow.getTime() - 1000), end: bookingNow },
    });
    const input = await draft();
    meter.start();
    const preview = await queries().previewPublishFloorPlan({
      ...input,
      branchId: actor.branchId,
    });
    expect(meter.stop().perStage).toEqual([4, 3]);
    expect(preview).toMatchObject({ ok: true, data: { changedShapes: 0 } });
    meter.start();
    const versions = await queries().getPlanVersions({
      floorId: actor.floorId,
      branchId: actor.branchId,
    });
    expect(meter.stop().perStage).toEqual([4, 1]);
    expect(versions).toHaveLength(1);
    const now = vi.fn(() => bookingNow);
    meter.start();
    const editor = await createPlanEditorQueries({
      database: database.db,
      requireSession: async () => actor.operator,
      now,
    }).getPlanEditor({ branchId: actor.branchId, floorId: actor.floorId });
    expect(meter.stop().perStage).toEqual([4, 2]);
    expect(now).toHaveBeenCalledOnce();
    expect(
      editor.spaces.find((space) => space.id === actor.deskId)
        ?.futureBookingCount,
    ).toBe(1);
    expect(
      editor.spaces.find((space) => space.id === actor.otherDeskId)
        ?.futureBookingCount,
    ).toBe(0);
  });
  it("member GET removes seat labels and background for both newly published and archived plans", async () => {
    const doc = document();
    doc.seats[0]!.label = "좌석 1";
    doc.background = { transform: [1, 0, 0, 1, 0, 0], opacity: 0.5 };
    const old = await published(doc);
    const input = await draft(doc);
    expect(await actions().publishFloorPlan(input)).toMatchObject({ ok: true });
    const reader = createFloorPlanQueries({
      database: database.db,
      requireSession: async () => actor.person,
    });
    for (const id of [old.id, input.expectedDraftId]) {
      const read = await reader.getFloorPlanDocument(id);
      expect(read.background).toBeUndefined();
      expect(read.seats.every((seat) => seat.label === undefined)).toBe(true);
    }
  });
  it("does not count seats when only another floor incorrectly points to this plan", async () => {
    const old = await published();
    await database.db
      .update(floors)
      .set({ publishedPlanId: null })
      .where(eq(floors.id, actor.floorId));
    await database.db
      .update(floors)
      .set({ publishedPlanId: old.id })
      .where(eq(floors.id, actor.otherFloorId));
    await insertFixtureBooking(database, actor, { spaceId: actor.deskId });
    const editor = await createPlanEditorQueries({
      database: database.db,
      requireSession: async () => actor.operator,
      now: () => bookingNow,
    }).getPlanEditor({ branchId: actor.branchId, floorId: actor.floorId });
    expect(editor.published).toBeNull();
    expect(
      editor.spaces.find((seat) => seat.id === actor.deskId)
        ?.futureBookingCount,
    ).toBe(0);
  });
  it("restores an archived version into a new draft with new UUIDs for archived seats and preserved source", async () => {
    const old = await published();
    const doc = document();
    doc.seats.shift();
    const input = await draft(doc);
    expect(await actions().publishFloorPlan(input)).toMatchObject({ ok: true });
    const result = await actions().restorePlanVersion({
      floorId: actor.floorId,
      version: 1,
      expectedDraftId: null,
      revision: null,
      basePlanId: input.expectedDraftId,
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        floorId: actor.floorId,
        basePlanId: input.expectedDraftId,
        draft: { version: 3, revision: 1 },
        savedAt: bookingNow.toISOString(),
      },
    });
    if (!result.ok) throw new Error("Restore failed");
    expect(result.data.document.seats[0]).toMatchObject({
      id: "seat-0",
      label: "좌석 1",
    });
    expect(result.data.document.seats[0]!.spaceId).not.toBe(actor.deskId);
    expect(
      (
        await database.db
          .select()
          .from(floorPlans)
          .where(eq(floorPlans.id, old.id))
      )[0]?.document,
    ).toEqual(old.document);
    expect(
      (
        await database.db
          .select()
          .from(floorPlans)
          .where(eq(floorPlans.id, result.data.draft.planId))
      )[0]?.backgroundImage,
    ).toBe("old.webp");
    expect(
      (
        await database.db
          .select()
          .from(spaces)
          .where(eq(spaces.id, actor.deskId))
      )[0]?.archivedAt,
    ).toEqual(bookingNow);
  });
  it("overwrites only a matching draft and increases revision while copying the selected background", async () => {
    const old = await published();
    const input = await draft();
    const result = await actions().restorePlanVersion({
      floorId: actor.floorId,
      version: 1,
      expectedDraftId: input.expectedDraftId,
      revision: 1,
      basePlanId: old.id,
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        draft: { planId: input.expectedDraftId, version: 2, revision: 2 },
      },
    });
    expect(
      (
        await database.db
          .select()
          .from(floorPlans)
          .where(eq(floorPlans.id, input.expectedDraftId))
      )[0]?.backgroundImage,
    ).toBe("old.webp");
  });
  it("rolls back a restored draft when its conditional update is lost", async () => {
    const old = await published();
    const input = await draft();
    const before = await snapshot();
    const replace = publishDal.replaceDraftVersion;
    vi.spyOn(publishDal, "replaceDraftVersion").mockImplementationOnce(
      async (value, db) => {
        await replace(value, db);
        return null;
      },
    );
    expect(
      await actions().restorePlanVersion({
        floorId: actor.floorId,
        version: 1,
        expectedDraftId: input.expectedDraftId,
        revision: 1,
        basePlanId: old.id,
      }),
    ).toEqual({ ok: false, code: "STALE" });
    expect(await snapshot()).toEqual(before);
    expect(publisher.publish).not.toHaveBeenCalled();
  });
  it("never restores draft/nonexistent versions and independently authenticates restore", async () => {
    const input = await draft();
    const value = {
      floorId: actor.floorId,
      version: 2,
      expectedDraftId: input.expectedDraftId,
      revision: 1,
      basePlanId: null,
    };
    expect(await actions(null).restorePlanVersion({})).toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    expect(
      await actions(actor.otherOperator).restorePlanVersion(value),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await actions().restorePlanVersion(value)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(
      await actions().restorePlanVersion({ ...value, version: 99 }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
  });
  it("restoration rejects a no-draft ABA even if another writer already published and removed the new draft", async () => {
    const old = await published();
    const input = await draft();
    await actions().publishFloorPlan(input);
    expect(
      await actions().restorePlanVersion({
        floorId: actor.floorId,
        version: 1,
        expectedDraftId: null,
        revision: null,
        basePlanId: old.id,
      }),
    ).toEqual({ ok: false, code: "STALE" });
  });
  it.each(["draft", "revision", "base"])(
    "restoration rejects stale %s without changing anything",
    async (kind) => {
      const old = await published();
      const input = await draft();
      const before = await snapshot();
      expect(
        await actions().restorePlanVersion({
          floorId: actor.floorId,
          version: 1,
          expectedDraftId:
            kind === "draft" ? crypto.randomUUID() : input.expectedDraftId,
          revision: kind === "revision" ? 0 : 1,
          basePlanId: kind === "base" ? null : old.id,
        }),
      ).toEqual({ ok: false, code: "STALE" });
      expect(await snapshot()).toEqual(before);
    },
  );
  it("does not remap or disclose a foreign-floor archived seat", async () => {
    const foreign = crypto.randomUUID();
    await database.db.insert(spaces).values({
      id: foreign,
      floorId: actor.otherFloorId,
      parentId: actor.otherSpaceId,
      type: "desk",
      name: "SECRET FOREIGN",
      archivedAt: bookingNow,
    });
    const doc = document();
    doc.seats[0]!.spaceId = foreign;
    const old = await published(doc);
    const result = await actions().restorePlanVersion({
      floorId: actor.floorId,
      version: 1,
      expectedDraftId: null,
      revision: null,
      basePlanId: old.id,
    });
    expect(result).toMatchObject({ ok: true });
    expect(JSON.stringify(result)).not.toContain("SECRET FOREIGN");
    if (result.ok) expect(result.data.document.seats[0]!.spaceId).toBe(foreign);
  });
  it("rejects a transformed restoration exceeding the document limit without overwriting source/draft", async () => {
    const doc = document();
    doc.fixtures.push({
      id: "large",
      kind: "storage",
      polygon: [
        [0, 0],
        [1000, 0],
        [1000, 1000],
        [0, 1000],
      ],
      label: "",
    });
    doc.fixtures[0]!.label = "x".repeat(
      900 * 1024 - new TextEncoder().encode(JSON.stringify(doc)).length - 5,
    );
    const old = await published(doc);
    await database.db
      .update(spaces)
      .set({ archivedAt: bookingNow })
      .where(eq(spaces.id, actor.deskId));
    const before = await snapshot();
    expect(
      await actions().restorePlanVersion({
        floorId: actor.floorId,
        version: 1,
        expectedDraftId: null,
        revision: null,
        basePlanId: old.id,
      }),
    ).toEqual({ ok: false, code: "PLAN_INVALID" });
    expect(await snapshot()).toEqual(before);
  });
  it("lists publisher names with legacy creator fallback, latest name, no documents/actor IDs", async () => {
    await published();
    const input = await draft();
    await actions().publishFloorPlan(input);
    await database.db
      .update(users)
      .set({ name: "새 운영자 이름" })
      .where(eq(users.id, actor.operator.userId));
    const versions = await queries().getPlanVersions({
      branchId: actor.branchId,
      floorId: actor.floorId,
    });
    expect(
      versions.map((row) => [row.version, row.status, row.publishedByName]),
    ).toEqual([
      [2, "published", "새 운영자 이름"],
      [1, "archived", "새 운영자 이름"],
    ]);
    expect(Object.keys(versions[0]!).sort()).toEqual(
      ["planId", "version", "status", "publishedAt", "publishedByName"].sort(),
    );
  });
  it.each(["snapshot", "legacy-long"])(
    "restores %s names without invalid drafts or truncation",
    async (kind) => {
      const doc = document();
      if (kind === "snapshot") doc.seats[0]!.label = "A-01";
      const old = await published(doc);
      await database.db
        .update(spaces)
        .set({
          name: kind === "snapshot" ? "A-30" : "가".repeat(21),
          archivedAt: bookingNow,
        })
        .where(eq(spaces.id, actor.deskId));
      const before = old.document;
      const result = await actions().restorePlanVersion({
        floorId: actor.floorId,
        version: 1,
        expectedDraftId: null,
        revision: null,
        basePlanId: old.id,
      });
      expect(result).toMatchObject({ ok: true });
      if (!result.ok) throw new Error("Missing restore.");
      expect(result.data.document.seats[0]!.spaceId).not.toBe(actor.deskId);
      expect(result.data.document.seats[0]!.label).toBe(
        kind === "snapshot" ? "A-01" : undefined,
      );
      expect(
        (
          await database.db
            .select()
            .from(floorPlans)
            .where(eq(floorPlans.id, old.id))
        )[0]?.document,
      ).toEqual(before);
      if (kind === "legacy-long")
        expect(
          await actions().publishFloorPlan({
            floorId: actor.floorId,
            expectedDraftId: result.data.draft.planId,
            revision: result.data.draft.revision,
          }),
        ).toMatchObject({
          ok: false,
          code: "PLAN_INVALID",
          issues: expect.arrayContaining([
            expect.objectContaining({ code: "SEAT_LABEL_MISSING" }),
          ]),
        });
    },
  );
  it("7F publishes A-25 after rejecting removal of a reserved seat, and member floor lookup/booking use the new version", async () => {
    const seed = loadSeedData();
    const source = seed.floorPlans[0]!;
    const floor = seed.floors.find((row) => row.id === source.floorId)!;
    const branch = seed.branches.find((row) => row.id === floor.branchId)!;
    await database.db.insert(branches).values(branch);
    await database.db.insert(floors).values(floor);
    await database.db
      .insert(spaces)
      .values(seed.spaces.filter((row) => row.floorId === floor.id));
    await database.db.insert(accessGrants).values(
      seed.spaces
        .filter((row) => row.floorId === floor.id && row.access === "teams")
        .map((row) => ({
          targetType: "space" as const,
          targetId: row.id,
          teamId: actor.teamId,
        })),
    );
    await database.db
      .insert(branchStaff)
      .values({ branchId: branch.id, userId: actor.operator.userId });
    actor = { ...actor, branchId: branch.id, floorId: floor.id };
    const old = await published(source.document);
    const doc = structuredClone(source.document);
    const removed = doc.seats.shift()!;
    const afternoon = createDeskParts({
      date: bookingDate,
      timeZone: branch.timezone,
      openHours: branch.openHours,
    }).find((part) => part.part === "pm")!;
    await insertFixtureBooking(database, actor, {
      spaceId: removed.spaceId,
      during: {
        start: new Date(afternoon.start),
        end: new Date(afternoon.end),
      },
    });
    const input = await draft(doc);
    const preview = await queries().previewPublishFloorPlan({
      ...input,
      branchId: branch.id,
    });
    expect(preview).toMatchObject({
      ok: true,
      data: { blockingBookings: [{ seatName: "A-01", part: "pm" }] },
    });
    await expectBlocked(input, "SEAT_REMOVED_WITH_BOOKINGS");
    doc.seats.unshift(removed);
    const first = doc.seats[0]!;
    const id = crypto.randomUUID();
    doc.seats.push({
      ...first,
      id: "seat-A25",
      spaceId: id,
      label: "A-25",
      at: [first.at[0], first.at[1] + 7200],
    });
    await database.db
      .update(floorPlans)
      .set({ document: doc })
      .where(eq(floorPlans.id, input.expectedDraftId));
    expect(await actions().publishFloorPlan(input)).toMatchObject({
      ok: true,
      data: { seats: { created: 1, archived: 0 } },
    });
    const floorData = await createBookingQueries({
      database: database.db,
      requireSession: async () => actor.person,
      now: () => bookingNow,
    }).getFloorDay(branch.id, floor.id, bookingDate);
    expect(floorData.floor.plan).toEqual({
      id: input.expectedDraftId,
      version: old.version + 1,
    });
    const book = createDeskBookingAction({
      database: database.db,
      getSession: async () => actor.stranger,
      now: () => bookingNow,
      publisher,
      logError,
    });
    expect(
      await book({ deskId: id, date: bookingDate, part: "pm", teamId: null }),
    ).toMatchObject({ ok: true });
  });
  it("creates and restores administrative spaces with floor SHARE before the space write", async () => {
    const admin = createAdminActions({
      database: database.db,
      getSession: async () => actor.operator,
      now: () => bookingNow,
      publisher,
      logError,
    });
    statements.length = 0;
    expect(
      await admin.createSpace({
        floorId: actor.floorId,
        type: "meeting_room",
        name: "새 공간",
        capacity: 3,
        bookable: true,
        amenities: [],
      }),
    ).toMatchObject({ ok: true });
    expect(
      statements.findIndex((query) => /from "floors".*for share/.test(query)),
    ).toBeLessThan(
      statements.findIndex((query) => query.startsWith('insert into "spaces"')),
    );
    statements.length = 0;
    expect(
      await admin.restoreSpace({ spaceId: actor.archivedSpaceId }),
    ).toMatchObject({ ok: true });
    const locks = statements.filter((query) =>
      /for (share|update)/.test(query),
    );
    expect(locks[0]).toMatch(/from "floors".*for share/);
    expect(locks[1]).toMatch(/from "spaces".*for update/);
  });
});

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
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
import { createAdminActions } from "@/features/admin/manage-factory";
import type { AdminDependencies } from "@/features/admin/action-factory";
import { createBookingActions } from "@/features/bookings/create-booking-factory";
import { createCancelBookingAction } from "@/features/bookings/cancel-booking-factory";
import { createBookingQueries } from "@/features/bookings/query-factory";
import type { Session } from "@/lib/auth/types";
import * as adminDal from "@/lib/dal/admin";
import * as schema from "@/lib/db/schema";
import {
  bookings,
  branches,
  branchStaff,
  floors,
  roleSettings,
  spaces,
} from "@/lib/db/schema";
import { defaultPermissions } from "@/lib/permissions/defaults";
import { createMemoryRealtime } from "@/lib/realtime/memory";
import {
  bookingInput,
  bookingNow,
  bookingRange,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

const openHours = {
  mon: { open: "09:00", close: "22:00" },
  tue: null,
  wed: { open: "09:00", close: "22:00" },
  thu: null,
  fri: null,
  sat: null,
  sun: null,
};

describe("operator branch, floor and space actions", () => {
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
  afterEach(() => {
    vi.restoreAllMocks();
  });
  function actions(
    session: Session | null = fixture.operator,
    overrides: AdminDependencies = {},
  ) {
    return createAdminActions({
      database: database.db,
      getSession: async () => session,
      now: () => bookingNow,
      logError: vi.fn(),
      ...overrides,
    });
  }
  const createSpaceInput = () => ({
    floorId: fixture.floorId,
    type: "meeting_room",
    name: "새 회의실",
    capacity: 5,
    bookable: true,
    amenities: ["monitor"],
  });
  const updateSpaceInput = () => ({
    spaceId: fixture.publicSpaceId,
    name: "고친 회의실",
    capacity: 6,
    bookable: true,
    amenities: ["whiteboard"],
  });
  const branchInput = () => ({
    branchId: fixture.branchId,
    name: "새 지점",
    address: "  ",
    openHours,
  });

  it("updates branch details with all seven weekdays and preserves the timezone", async () => {
    expect(await actions().updateBranch(branchInput())).toEqual({
      ok: true,
      data: { branchId: fixture.branchId },
    });
    const [branch] = await database.db
      .select()
      .from(branches)
      .where(eq(branches.id, fixture.branchId));
    expect(branch).toMatchObject({
      name: "새 지점",
      address: null,
      openHours,
      timezone: "Asia/Seoul",
    });
  });

  it("creates floors at max+1, starts an empty branch at zero, and updates floor metadata", async () => {
    const created = await actions().createFloor({
      branchId: fixture.branchId,
      level: 6,
      name: "  6F  ",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("Expected floor.");
    const [floor] = await database.db
      .select()
      .from(floors)
      .where(eq(floors.id, created.data.floorId));
    expect(floor).toMatchObject({ level: 6, name: "6F", sortOrder: 3 });
    expect(
      await actions().updateFloor({
        floorId: floor!.id,
        level: 5,
        name: "5F",
        sortOrder: 8,
      }),
    ).toEqual({ ok: true, data: { floorId: floor!.id } });
    const [updated] = await database.db
      .select()
      .from(floors)
      .where(eq(floors.id, floor!.id));
    expect(updated).toMatchObject({
      level: 5,
      name: "5F",
      sortOrder: 8,
      branchId: fixture.branchId,
    });
    const [empty] = await database.db
      .insert(branches)
      .values({ name: "빈 운영 지점" })
      .returning();
    await database.db
      .insert(branchStaff)
      .values({ branchId: empty!.id, userId: fixture.operator.userId });
    expect(
      (
        await actions().createFloor({
          branchId: empty!.id,
          level: 1,
          name: "1F",
        })
      ).ok,
    ).toBe(true);
    const [first] = await database.db
      .select()
      .from(floors)
      .where(eq(floors.branchId, empty!.id));
    expect(first?.sortOrder).toBe(0);
  });

  it("creates a space that immediately appears in member queries and accepts a reservation", async () => {
    const created = await actions().createSpace(createSpaceInput());
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("Expected space.");
    const [space] = await database.db
      .select()
      .from(spaces)
      .where(eq(spaces.id, created.data.spaceId));
    expect(space).toMatchObject({
      name: "새 회의실",
      floorId: fixture.floorId,
      type: "meeting_room",
      capacity: 5,
      bookable: true,
      access: null,
      parentId: null,
      bookingRules: {},
    });
    const query = createBookingQueries({
      database: database.db,
      requireSession: async () => fixture.person,
      now: () => bookingNow,
    });
    expect(
      (await query.getFloorDay(fixture.branchId, fixture.floorId)).spaces,
    ).toContainEqual(
      expect.objectContaining({ id: created.data.spaceId, name: "새 회의실" }),
    );
    const booking = createBookingActions({
      database: database.db,
      getSession: async () => fixture.person,
      now: () => bookingNow,
      logError: vi.fn(),
    });
    expect(
      (
        await booking.createBooking(
          bookingInput(fixture, { spaceId: created.data.spaceId }),
        )
      ).ok,
    ).toBe(true);
  });

  it("updates a space and publishes the committed value once", async () => {
    const realtime = createMemoryRealtime();
    const listener = vi.fn();
    realtime.subscribe(`floor:${fixture.floorId}`, listener);
    const publish = vi.fn(async (channel, event) => {
      const [row] = await database.db
        .select()
        .from(spaces)
        .where(eq(spaces.id, fixture.publicSpaceId));
      expect(row?.name).toBe("고친 회의실");
      await realtime.publish(channel, event);
    }) satisfies NonNullable<AdminDependencies["publisher"]>["publish"];
    expect(
      await actions(fixture.operator, { publisher: { publish } }).updateSpace(
        updateSpaceInput(),
      ),
    ).toEqual({ ok: true, data: { spaceId: fixture.publicSpaceId } });
    expect(publish).toHaveBeenCalledExactlyOnceWith(
      `floor:${fixture.floorId}`,
      { type: "space.status_changed", spaceId: fixture.publicSpaceId },
    );
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it.each(["person", "otherOperator", "unauthenticated", "disabled"] as const)(
    "protects every management action from %s",
    async (kind) => {
      if (kind === "disabled")
        await database.db
          .insert(roleSettings)
          .values({
            branchId: fixture.branchId,
            role: "operator",
            permissions: defaultPermissions.operator.filter(
              (permission) => permission !== "space.manage",
            ),
          });
      const current = actions(
        kind === "unauthenticated"
          ? null
          : kind === "disabled"
            ? fixture.operator
            : fixture[kind],
      );
      const calls = [
        () => current.updateBranch(branchInput()),
        () =>
          current.createFloor({
            branchId: fixture.branchId,
            level: 6,
            name: "6F",
          }),
        () =>
          current.updateFloor({
            floorId: fixture.floorId,
            level: 7,
            name: "7F",
            sortOrder: 1,
          }),
        () => current.createSpace(createSpaceInput()),
        () => current.updateSpace(updateSpaceInput()),
        () => current.archiveSpace({ spaceId: fixture.publicSpaceId }),
        () => current.restoreSpace({ spaceId: fixture.archivedSpaceId }),
      ];
      for (const call of calls)
        expect(await call()).toEqual({
          ok: false,
          code:
            kind === "unauthenticated"
              ? "UNAUTHENTICATED"
              : kind === "disabled"
                ? "FORBIDDEN"
                : "NOT_FOUND",
        });
    },
  );

  it("does not allow a general user to become an operator through a permission override", async () => {
    await database.db
      .insert(roleSettings)
      .values({
        branchId: fixture.branchId,
        role: "user",
        permissions: ["space.manage", "plan.edit"],
      });
    expect(
      await actions(fixture.person).updateSpace(updateSpaceInput()),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it.each([
    "type",
    "floorId",
    "access",
    "archivedAt",
    "parentId",
    "bookingRules",
  ])("rejects forbidden updateSpace key %s", async (key) => {
    expect(
      await actions().updateSpace({ ...updateSpaceInput(), [key]: "forged" }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it.each([
    ["zero capacity", { capacity: 0 }],
    ["missing capacity", { capacity: null }],
    ["invalid amenity", { amenities: ["unlisted"] }],
    ["desk type", { type: "desk" }],
    ["blank name", { name: "  " }],
    ["extra access", { access: "everyone" }],
  ])("rejects invalid space input: %s", async (_, extra) => {
    expect(
      await actions().createSpace({ ...createSpaceInput(), ...extra }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("rejects missing capacity on update based on the stored room type", async () => {
    expect(
      await actions().updateSpace({ ...updateSpaceInput(), capacity: null }),
    ).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      fieldErrors: { capacity: expect.any(Array) },
    });
  });

  it.each(["lounge", "desk_area"] as const)(
    "forces %s bookable off on both create and update",
    async (type) => {
      const result = await actions().createSpace({
        ...createSpaceInput(),
        type,
        name: `${type} 새 공간`,
        capacity: type === "lounge" ? null : 10,
        bookable: true,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected space.");
      expect(
        await actions().updateSpace({
          ...updateSpaceInput(),
          spaceId: result.data.spaceId,
          bookable: true,
          capacity: type === "lounge" ? null : 10,
        }),
      ).toMatchObject({ ok: true });
      const [space] = await database.db
        .select()
        .from(spaces)
        .where(eq(spaces.id, result.data.spaceId));
      expect(space?.bookable).toBe(false);
    },
  );

  it.each(["updateSpace", "archiveSpace", "restoreSpace"] as const)(
    "hides desk rows from %s",
    async (action) => {
      expect(
        await actions()[action]({
          ...(action === "updateSpace" ? updateSpaceInput() : {}),
          spaceId: fixture.deskId,
        }),
      ).toEqual({ ok: false, code: "NOT_FOUND" });
    },
  );

  it("maps duplicate floor levels and case-insensitive space names to their input fields", async () => {
    expect(
      await actions().createFloor({
        branchId: fixture.branchId,
        level: 0,
        name: "0F",
      }),
    ).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      fieldErrors: { level: expect.any(Array) },
    });
    expect(
      await actions().createFloor({
        branchId: fixture.branchId,
        level: 7,
        name: "중복",
      }),
    ).toEqual({
      ok: false,
      code: "INVALID_INPUT",
      fieldErrors: { level: ["이미 있는 층이에요"] },
    });
    expect(
      await actions().updateFloor({
        floorId: fixture.restrictedFloorId,
        level: 7,
        name: "7F",
        sortOrder: 2,
      }),
    ).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      fieldErrors: { level: expect.any(Array) },
    });
    expect(
      (
        await actions().createSpace({
          ...createSpaceInput(),
          name: "Room Alpha",
        })
      ).ok,
    ).toBe(true);
    expect(
      await actions().createSpace({
        ...createSpaceInput(),
        name: "rOOM aLPHA",
      }),
    ).toEqual({
      ok: false,
      code: "INVALID_INPUT",
      fieldErrors: { name: ["이 층에 같은 이름의 공간이 있어요"] },
    });
    expect(
      await actions().updateSpace({
        ...updateSpaceInput(),
        name: "ROOM ALPHA",
      }),
    ).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      fieldErrors: { name: expect.any(Array) },
    });
  });

  it("rejects automatic floor ordering beyond 999 without inserting a floor", async () => {
    await database.db
      .update(floors)
      .set({ sortOrder: 999 })
      .where(eq(floors.id, fixture.floorId));
    expect(
      await actions().createFloor({
        branchId: fixture.branchId,
        level: 6,
        name: "6F",
      }),
    ).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      fieldErrors: { sortOrder: expect.any(Array) },
    });
    expect(
      await database.db
        .select()
        .from(floors)
        .where(eq(floors.branchId, fixture.branchId)),
    ).toHaveLength(2);
  });

  it.each([
    { wed: { open: "18:00", close: "09:00" } },
    { wed: { open: "09:15", close: "18:00" } },
    { wed: { open: "09:00", close: "24:30" } },
  ])("rejects invalid hours %j", async (hours) => {
    expect(
      await actions().updateBranch({
        ...branchInput(),
        openHours: { ...openHours, ...hours },
      }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });
  it("requires all seven weekdays and rejects timezone changes", async () => {
    expect(
      await actions().updateBranch({ ...branchInput(), openHours: {} }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(
      await actions().updateBranch({ ...branchInput(), timezone: "UTC" }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it.each(["ongoing", "future"])(
    "blocks archive and disabling booking when %s confirmed reservations exist",
    async (kind) => {
      await insertFixtureBooking(database, fixture, {
        during:
          kind === "future" ? bookingRange("14:00", "15:00") : bookingRange(),
      });
      const publish = vi.fn();
      const current = actions(fixture.operator, { publisher: { publish } });
      expect(
        await current.archiveSpace({ spaceId: fixture.publicSpaceId }),
      ).toEqual({ ok: false, code: "SPACE_IN_USE" });
      expect(
        await current.updateSpace({ ...updateSpaceInput(), bookable: false }),
      ).toEqual({ ok: false, code: "SPACE_IN_USE" });
      const [space] = await database.db
        .select()
        .from(spaces)
        .where(eq(spaces.id, fixture.publicSpaceId));
      expect(space).toMatchObject({
        archivedAt: null,
        bookable: true,
        name: "회의실 B",
      });
      expect(publish).not.toHaveBeenCalled();
    },
  );

  it("archives after a real cancellation, disappears from member queries and restores idempotently", async () => {
    const booking = await insertFixtureBooking(database, fixture);
    const cancel = createCancelBookingAction({
      database: database.db,
      getSession: async () => fixture.person,
      now: () => bookingNow,
      logError: vi.fn(),
    });
    expect((await cancel({ bookingId: booking.id })).ok).toBe(true);
    const publish = vi.fn();
    const current = actions(fixture.operator, { publisher: { publish } });
    expect(
      await current.archiveSpace({ spaceId: fixture.publicSpaceId }),
    ).toEqual({ ok: true, data: { spaceId: fixture.publicSpaceId } });
    expect(
      (await current.archiveSpace({ spaceId: fixture.publicSpaceId })).ok,
    ).toBe(true);
    expect(publish).toHaveBeenCalledTimes(1);
    const [archived] = await database.db
      .select()
      .from(spaces)
      .where(eq(spaces.id, fixture.publicSpaceId));
    expect(archived?.archivedAt).toEqual(bookingNow);
    const queries = createBookingQueries({
      database: database.db,
      requireSession: async () => fixture.person,
      now: () => bookingNow,
    });
    expect(
      (
        await queries.getFloorDay(fixture.branchId, fixture.floorId)
      ).spaces.some(({ id }) => id === fixture.publicSpaceId),
    ).toBe(false);
    const bookingActions = createBookingActions({
      database: database.db,
      getSession: async () => fixture.person,
      now: () => bookingNow,
      logError: vi.fn(),
    });
    expect(await bookingActions.createBooking(bookingInput(fixture))).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(
      (await current.restoreSpace({ spaceId: fixture.publicSpaceId })).ok,
    ).toBe(true);
    expect(
      (await current.restoreSpace({ spaceId: fixture.publicSpaceId })).ok,
    ).toBe(true);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(
      (
        await queries.getFloorDay(fixture.branchId, fixture.floorId)
      ).spaces.some(({ id }) => id === fixture.publicSpaceId),
    ).toBe(true);
    expect(await database.db.select().from(bookings)).toHaveLength(1);
  });

  it("allows archive when only ended reservations exist", async () => {
    await insertFixtureBooking(database, fixture, {
      during: bookingRange("10:00", "11:00"),
    });
    expect(
      (await actions().archiveSpace({ spaceId: fixture.publicSpaceId })).ok,
    ).toBe(true);
  });

  it("rejects restoration if an active space has reused its name", async () => {
    await actions().archiveSpace({ spaceId: fixture.publicSpaceId });
    expect(
      (await actions().createSpace({ ...createSpaceInput(), name: "회의실 B" }))
        .ok,
    ).toBe(true);
    expect(
      await actions().restoreSpace({ spaceId: fixture.publicSpaceId }),
    ).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      fieldErrors: { name: expect.any(Array) },
    });
  });

  it("applies shorter hours to new reservations without changing existing ones", async () => {
    const booking = await insertFixtureBooking(database, fixture);
    expect(
      (
        await actions().updateBranch({
          ...branchInput(),
          openHours: { ...openHours, wed: { open: "14:00", close: "18:00" } },
        })
      ).ok,
    ).toBe(true);
    const book = createBookingActions({
      database: database.db,
      getSession: async () => fixture.person,
      now: () => bookingNow,
      logError: vi.fn(),
    });
    expect(
      await book.createBooking(
        bookingInput(fixture, { spaceId: fixture.secondSpaceId }),
      ),
    ).toEqual({ ok: false, code: "OUTSIDE_HOURS" });
    expect(await database.db.select().from(bookings)).toEqual([booking]);
  });

  it.each(["updateSpace", "archiveSpace", "restoreSpace"] as const)(
    "keeps %s committed when publication fails",
    async (method) => {
      const logError = vi.fn();
      const current = actions(fixture.operator, {
        publisher: {
          publish: vi
            .fn()
            .mockRejectedValue(new Error("private transport failure")),
        },
        logError,
      });
      const input =
        method === "updateSpace"
          ? updateSpaceInput()
          : {
              spaceId:
                method === "restoreSpace"
                  ? fixture.archivedSpaceId
                  : fixture.publicSpaceId,
            };
      expect((await current[method](input)).ok).toBe(true);
      expect(logError).toHaveBeenCalledExactlyOnceWith(
        "Space update notification failed.",
      );
      const [row] = await database.db
        .select()
        .from(spaces)
        .where(eq(spaces.id, input.spaceId));
      if (method === "updateSpace") expect(row?.name).toBe("고친 회의실");
      else
        expect(row?.archivedAt).toEqual(
          method === "archiveSpace" ? bookingNow : null,
        );
    },
  );

  it("rolls back a failed transactional space update and does not publish", async () => {
    const original = adminDal.updateSpaceRecord;
    vi.spyOn(adminDal, "updateSpaceRecord").mockImplementationOnce(
      async (input, tx) => {
        await original(input, tx);
        throw new Error("synthetic storage failure");
      },
    );
    const publish = vi.fn();
    expect(
      await actions(fixture.operator, { publisher: { publish } }).updateSpace(
        updateSpaceInput(),
      ),
    ).toEqual({ ok: false, code: "INTERNAL" });
    const [row] = await database.db
      .select()
      .from(spaces)
      .where(eq(spaces.id, fixture.publicSpaceId));
    expect(row?.name).toBe("회의실 B");
    expect(publish).not.toHaveBeenCalled();
  });

  it.each(["archiveSpace", "updateSpace"] as const)(
    "locks the space before counting unfinished bookings and changing state in %s",
    async (method) => {
      const statements: string[] = [];
      const logged = drizzle({
        client: database.client,
        schema,
        logger: {
          logQuery(query) {
            statements.push(query);
          },
        },
      });
      const current = actions(fixture.operator, { database: logged });
      expect(
        (
          await current[method](
            method === "updateSpace"
              ? { ...updateSpaceInput(), bookable: false }
              : { spaceId: fixture.publicSpaceId },
          )
        ).ok,
      ).toBe(true);
      const lock = statements.findIndex((query) =>
        /from "spaces".*for update/u.test(query),
      );
      const count = statements.findIndex(
        (query) =>
          query.includes("count(*)") && query.includes('from "bookings"'),
      );
      const update = statements.findIndex((query) =>
        query.startsWith('update "spaces"'),
      );
      expect(lock).toBeGreaterThanOrEqual(0);
      expect(count).toBeGreaterThan(lock);
      expect(update).toBeGreaterThan(count);
    },
  );
});

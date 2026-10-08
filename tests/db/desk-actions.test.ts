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
import { createDeskBookingAction } from "@/features/bookings/create-desk-booking-factory";
import { createBookingActions } from "@/features/bookings/create-booking-factory";
import { createCancelBookingAction } from "@/features/bookings/cancel-booking-factory";
import type { BookingDependencies } from "@/features/bookings/action-factory";
import { createDeskParts } from "@/features/bookings/desk-parts";
import type { Session } from "@/lib/auth/types";
import * as bookingDal from "@/lib/dal/bookings";
import * as deskDal from "@/lib/dal/desks";
import * as schema from "@/lib/db/schema";
import {
  accessGrants,
  bookings,
  branches,
  spaceBlocks,
  spaces,
  users,
} from "@/lib/db/schema";
import { addDays } from "@/lib/time/zoned";
import {
  bookingInput,
  bookingNow,
  bookingRange,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("desk reservation actions", () => {
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
  const options = (
    session: Session | null = fixture.person,
    overrides: BookingDependencies = {},
  ): BookingDependencies => ({
    database: database.db,
    getSession: async () => session,
    now: () => bookingNow,
    logError: vi.fn(),
    ...overrides,
  });
  const input = (extra = {}) => ({
    deskId: fixture.deskId,
    date: "2026-10-07",
    part: "am",
    teamId: null,
    ...extra,
  });
  const action = (
    session: Session | null = fixture.person,
    overrides: BookingDependencies = {},
  ) => createDeskBookingAction(options(session, overrides));

  it.each(["am", "pm", "day"])(
    "creates %s using the full half-day range and null time-only fields",
    async (part) => {
      const publish = vi.fn();
      const result = await action(fixture.person, { publisher: { publish } })(
        input({ part }),
      );
      expect(result).toEqual({
        ok: true,
        data: { bookingId: expect.any(String) },
      });
      const [row] = await database.db.select().from(bookings);
      const expected = createDeskParts({
        date: "2026-10-07",
        timeZone: "Asia/Seoul",
        openHours: {},
      }).find((value) => value.part === part)!;
      expect(row).toMatchObject({
        spaceId: fixture.deskId,
        title: null,
        attendeeCount: null,
        userId: fixture.person.userId,
        during: {
          start: new Date(expected.start),
          end: new Date(expected.end),
        },
      });
      expect(publish).toHaveBeenCalledWith(`floor:${fixture.floorId}`, {
        type: "booking.changed",
        spaceId: fixture.deskAreaId,
      });
      expect(
        (
          await database.db
            .select()
            .from(users)
            .where(eq(users.id, fixture.person.userId))
        )[0]?.defaultBranchId,
      ).toBe(fixture.branchId);
    },
  );
  it("accepts the morning part after its start and keeps its original start", async () => {
    expect(
      (
        await action(fixture.person, {
          now: () => new Date("2026-10-07T11:00:00+09:00"),
        })(input())
      ).ok,
    ).toBe(true);
    expect(
      (await database.db.select().from(bookings))[0]?.during.start,
    ).toEqual(new Date("2026-10-07T09:00:00+09:00"));
  });
  it("checks session before malformed input and rejects forged fields", async () => {
    expect(await action(null)({})).toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    for (const extra of [
      { title: "제목" },
      { attendeeCount: 1 },
      { userId: fixture.stranger.userId },
      { date: "2026-02-30" },
      { part: "night" },
    ])
      expect(await action()(input(extra))).toMatchObject({
        ok: false,
        code: "INVALID_INPUT",
      });
  });
  it.each([
    "non-seat",
    "archived-seat",
    "archived-area",
    "bookable-area",
    "wrong-floor",
    "no-parent",
  ])("hides invalid targets: %s", async (kind) => {
    if (kind === "non-seat")
      expect(await action()(input({ deskId: fixture.publicSpaceId }))).toEqual({
        ok: false,
        code: "NOT_FOUND",
      });
    else {
      if (kind === "archived-seat")
        await database.db
          .update(spaces)
          .set({ archivedAt: bookingNow })
          .where(eq(spaces.id, fixture.deskId));
      if (kind === "archived-area")
        await database.db
          .update(spaces)
          .set({ archivedAt: bookingNow })
          .where(eq(spaces.id, fixture.deskAreaId));
      if (kind === "bookable-area")
        await database.db
          .update(spaces)
          .set({ bookable: true })
          .where(eq(spaces.id, fixture.deskAreaId));
      if (kind === "wrong-floor")
        await database.db
          .update(spaces)
          .set({ floorId: fixture.otherFloorId })
          .where(eq(spaces.id, fixture.deskId));
      if (kind === "no-parent")
        await database.db
          .update(spaces)
          .set({ parentId: null })
          .where(eq(spaces.id, fixture.deskId));
      expect(await action()(input())).toEqual({ ok: false, code: "NOT_FOUND" });
    }
  });
  it("rejects unbookable seats after access, independently of the seat access flag", async () => {
    await database.db
      .update(spaces)
      .set({ bookable: false, access: "closed" })
      .where(eq(spaces.id, fixture.deskId));
    expect(await action()(input())).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
    await database.db
      .update(spaces)
      .set({ access: "closed" })
      .where(eq(spaces.id, fixture.deskAreaId));
    expect(await action()(input())).toEqual({ ok: false, code: "FORBIDDEN" });
  });
  it.each([null, "everyone", "teams", "closed"] as const)(
    "uses area grants for team booking, ignoring seat access %s",
    async (access) => {
      await database.db
        .update(spaces)
        .set({ access: "teams" })
        .where(eq(spaces.id, fixture.deskAreaId));
      await database.db
        .update(spaces)
        .set({ access })
        .where(eq(spaces.id, fixture.deskId));
      await database.db
        .insert(accessGrants)
        .values({
          targetType: "space",
          targetId: fixture.deskAreaId,
          teamId: fixture.teamId,
        });
      expect(await action(fixture.member)(input())).toEqual({
        ok: false,
        code: "FORBIDDEN",
      });
      expect(
        (await action(fixture.member)(input({ teamId: fixture.teamId }))).ok,
      ).toBe(true);
    },
  );
  it("enforces date-window, closure, absent-part and elapsed-part errors in order", async () => {
    expect(await action()(input({ date: addDays("2026-10-07", 61) }))).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect(await action()(input({ date: "2026-10-06" }))).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect(await action()(input({ date: "2026-10-11" }))).toEqual({
      ok: false,
      code: "OUTSIDE_HOURS",
    });
    await database.db
      .update(branches)
      .set({ openHours: { wed: { open: "14:00", close: "20:00" } } })
      .where(eq(branches.id, fixture.branchId));
    expect(await action()(input())).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
    for (const part of ["am", "day"])
      expect(
        await action(fixture.person, {
          now: () => new Date("2026-10-07T13:00:00+09:00"),
        })(input({ part })),
      ).toEqual({ ok: false, code: "INVALID_INPUT" });
  });
  it("applies days-ahead but not minute limits, leaving meeting-room quota intact", async () => {
    expect(await action()(input({ date: "2026-10-15" }))).toEqual({
      ok: false,
      code: "LIMIT_EXCEEDED",
      message: "days_ahead",
    });
    expect((await action()(input({ part: "day" }))).ok).toBe(true);
    expect(
      (
        await createBookingActions(options()).createBooking(
          bookingInput(fixture, {
            start: "2026-10-07T13:00:00+09:00",
            end: "2026-10-07T15:00:00+09:00",
          }),
        )
      ).ok,
    ).toBe(true);
  });
  it("allows adjacent different seats but blocks overlapping personal and team seats", async () => {
    expect(
      (await action(fixture.member)(input({ teamId: fixture.teamId }))).ok,
    ).toBe(true);
    expect(
      await action(fixture.member)(
        input({ deskId: fixture.otherDeskId, part: "day" }),
      ),
    ).toEqual({
      ok: false,
      code: "LIMIT_EXCEEDED",
      message: "desk_per_person",
    });
    expect(
      (
        await action(fixture.member)(
          input({ deskId: fixture.otherDeskId, part: "pm" }),
        )
      ).ok,
    ).toBe(true);
  });
  it.each(["seat", "area"])("rejects %s maintenance", async (kind) => {
    await database.db
      .insert(spaceBlocks)
      .values({
        spaceId: kind === "seat" ? fixture.deskId : fixture.deskAreaId,
        during: bookingRange("09:00", "13:00"),
        createdBy: fixture.operator.userId,
      });
    expect(await action()(input())).toEqual({
      ok: false,
      code: "SPACE_BLOCKED",
    });
  });
  it("preserves EXCLUDE as the same-seat final conflict check", async () => {
    await insertFixtureBooking(database, fixture, {
      spaceId: fixture.deskId,
      userId: fixture.stranger.userId,
      during: bookingRange("09:00", "13:00"),
    });
    expect(await action()(input())).toEqual({
      ok: false,
      code: "BOOKING_CONFLICT",
    });
    expect(await database.db.select().from(bookings)).toHaveLength(1);
  });
  it("rechecks another same-user desk committed before the user lock", async () => {
    const original = deskDal.lockDeskBookingActor;
    vi.spyOn(deskDal, "lockDeskBookingActor").mockImplementationOnce(
      async (actor, transaction) => {
        await transaction
          .insert(bookings)
          .values({
            spaceId: fixture.otherDeskId,
            userId: actor.userId,
            during: bookingRange("09:00", "13:00"),
          });
        return original(actor, transaction);
      },
    );
    expect(await action()(input())).toEqual({
      ok: false,
      code: "LIMIT_EXCEEDED",
      message: "desk_per_person",
    });
    expect(await database.db.select().from(bookings)).toHaveLength(0);
  });
  it("rechecks a seat becoming unbookable at the seat lock", async () => {
    const original = bookingDal.lockSpaceForBooking;
    vi.spyOn(bookingDal, "lockSpaceForBooking").mockImplementation(
      async (id, transaction) => {
        if (id === fixture.deskId)
          await transaction
            .update(spaces)
            .set({ bookable: false })
            .where(eq(spaces.id, id));
        return original(id, transaction);
      },
    );
    expect(await action()(input())).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
  });
  it("observes a same-seat competing reservation at the seat lock", async () => {
    const original = bookingDal.lockSpaceForBooking;
    vi.spyOn(bookingDal, "lockSpaceForBooking").mockImplementation(
      async (id, transaction) => {
        if (id === fixture.deskId)
          await transaction
            .insert(bookings)
            .values({
              spaceId: id,
              userId: fixture.stranger.userId,
              during: bookingRange("09:00", "13:00"),
            });
        return original(id, transaction);
      },
    );
    expect(await action()(input())).toEqual({
      ok: false,
      code: "BOOKING_CONFLICT",
    });
  });
  it("locks floor, area, desk, user UPDATE, then team UPDATE", async () => {
    const statements: { query: string; params: unknown[] }[] = [];
    const db = drizzle({
      client: database.client,
      schema,
      logger: {
        logQuery(query, params) {
          statements.push({ query, params });
        },
      },
    });
    expect(
      (
        await action(fixture.member, { database: db })(
          input({ teamId: fixture.teamId }),
        )
      ).ok,
    ).toBe(true);
    const locks = statements.filter(({ query }) =>
      /for (?:share|update)/u.test(query),
    );
    expect(locks.map(({ params }) => params[0])).toEqual([
      fixture.floorId,
      fixture.deskAreaId,
      fixture.deskId,
      fixture.member.userId,
      fixture.teamId,
    ]);
    expect(
      locks.map(({ query }) => query.match(/for (share|update)/u)?.[1]),
    ).toEqual(["share", "share", "share", "update", "update"]);
  });
  it("cancels using parent access and emits the parent, then allows a new owner", async () => {
    const created = await action()(input());
    if (!created.ok) throw new Error("Expected desk booking");
    await database.db
      .update(spaces)
      .set({ access: "closed" })
      .where(eq(spaces.id, fixture.deskId));
    const publish = vi.fn();
    expect(
      (
        await createCancelBookingAction(
          options(fixture.person, { publisher: { publish } }),
        )({ bookingId: created.data.bookingId })
      ).ok,
    ).toBe(true);
    expect(publish).toHaveBeenCalledWith(`floor:${fixture.floorId}`, {
      type: "booking.changed",
      spaceId: fixture.deskAreaId,
    });
    expect((await action(fixture.stranger)(input())).ok).toBe(true);
  });
  it("hides private-area bookings from an unrelated canceller and permits operator/team admin", async () => {
    await database.db
      .update(spaces)
      .set({ access: "teams" })
      .where(eq(spaces.id, fixture.deskAreaId));
    await database.db
      .insert(accessGrants)
      .values({
        targetType: "space",
        targetId: fixture.deskAreaId,
        teamId: fixture.teamId,
      });
    const create = async () => {
      const result = await action(fixture.member)(
        input({ teamId: fixture.teamId }),
      );
      if (!result.ok) throw new Error("Expected desk booking");
      return result.data;
    };
    const first = await create();
    expect(
      await createCancelBookingAction(options(fixture.stranger))(first),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(
      (await createCancelBookingAction(options(fixture.operator))(first)).ok,
    ).toBe(true);
    expect(
      (await createCancelBookingAction(options(fixture.admin))(await create()))
        .ok,
    ).toBe(true);
  });
  it("retains a saved booking after publication failure and rolls back a failed insert", async () => {
    const logError = vi.fn();
    expect(
      (
        await action(fixture.person, {
          logError,
          publisher: {
            publish: vi.fn().mockRejectedValue(new Error("private")),
          },
        })(input())
      ).ok,
    ).toBe(true);
    expect(logError).toHaveBeenCalledWith(
      "Booking realtime publication failed.",
    );
    vi.spyOn(bookingDal, "insertBooking").mockRejectedValueOnce(
      new Error("private"),
    );
    expect(
      await action(fixture.stranger)(input({ deskId: fixture.otherDeskId })),
    ).toEqual({ ok: false, code: "INTERNAL" });
    expect(await database.db.select().from(bookings)).toHaveLength(1);
    expect(
      (
        await database.db
          .select()
          .from(users)
          .where(eq(users.id, fixture.stranger.userId))
      )[0]?.defaultBranchId,
    ).toBeNull();
  });
});

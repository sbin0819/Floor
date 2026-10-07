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
import { createBookingActions } from "@/features/bookings/create-booking-factory";
import type { BookingDependencies } from "@/features/bookings/action-factory";
import type { Session } from "@/lib/auth/types";
import * as bookingDal from "@/lib/dal/bookings";
import {
  accessGrants,
  bookings,
  roleSettings,
  spaceBlocks,
  spaces,
  users,
} from "@/lib/db/schema";
import { defaultPermissions } from "@/lib/permissions/defaults";
import { createMemoryRealtime } from "@/lib/realtime/memory";
import {
  bookingInput,
  bookingInstant,
  bookingNow,
  bookingRange,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("booking creation and default branch actions", () => {
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
    session: Session | null = fixture.person,
    overrides: BookingDependencies = {},
  ) {
    return createBookingActions({
      database: database.db,
      getSession: async () => session,
      now: () => bookingNow,
      logError: vi.fn(),
      ...overrides,
    });
  }

  it("commits a personal reservation using the session owner before publishing exactly once", async () => {
    const realtime = createMemoryRealtime();
    const listener = vi.fn();
    realtime.subscribe(`floor:${fixture.floorId}`, listener);
    const publish = vi.fn(async (channel, event) => {
      const rows = await database.db.select().from(bookings);
      expect(rows).toHaveLength(1);
      await realtime.publish(channel, event);
    }) satisfies NonNullable<BookingDependencies["publisher"]>["publish"];
    const result = await actions(fixture.person, {
      publisher: { publish },
    }).createBooking(bookingInput(fixture, { title: "  기획 회의  " }));
    expect(result).toEqual({
      ok: true,
      data: { bookingId: expect.any(String) },
    });
    expect(await database.db.select().from(bookings)).toMatchObject([
      {
        userId: fixture.person.userId,
        teamId: null,
        title: "기획 회의",
        during: bookingRange(),
        createdAt: bookingNow,
      },
    ]);
    expect(publish).toHaveBeenCalledExactlyOnceWith(
      `floor:${fixture.floorId}`,
      { type: "booking.changed", spaceId: fixture.publicSpaceId },
    );
    expect(listener).toHaveBeenCalledExactlyOnceWith({
      type: "booking.changed",
      spaceId: fixture.publicSpaceId,
    });
  });

  it("books a permitted team-only room under the selected team and session user", async () => {
    const result = await actions(fixture.member).createBooking(
      bookingInput(fixture, {
        spaceId: fixture.restrictedSpaceId,
        teamId: fixture.teamId,
        title: "  ",
      }),
    );
    expect(result.ok).toBe(true);
    expect(await database.db.select().from(bookings)).toMatchObject([
      {
        userId: fixture.member.userId,
        teamId: fixture.teamId,
        spaceId: fixture.restrictedSpaceId,
        title: null,
      },
    ]);
  });

  it("checks the session before invalid input", async () => {
    expect(await actions(null).createBooking({})).toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
    });
  });
  it.each([
    ["bad UUID", { spaceId: "not-a-uuid" }],
    ["offset-free ISO", { start: "2026-10-07T12:00:00" }],
    ["forged owner", { userId: "client-chosen-owner" }],
    ["long title", { title: "가".repeat(61) }],
  ])("rejects malformed input: %s", async (_, extra) => {
    expect(
      await actions().createBooking({ ...bookingInput(fixture), ...extra }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await database.db.select().from(bookings)).toHaveLength(0);
  });
  it.each([
    ["quarter-hour", "12:15", "13:00", "2026-10-07"],
    ["reversed", "13:00", "12:00", "2026-10-07"],
    ["zero duration", "12:00", "12:00", "2026-10-07"],
    ["past slot", "11:30", "12:00", "2026-10-07"],
  ])("rejects invalid booking time: %s", async (_, start, end, date) => {
    expect(
      await actions().createBooking(
        bookingInput(fixture, {
          start: bookingInstant(start, date),
          end: bookingInstant(end, date),
        }),
      ),
    ).toEqual({ ok: false, code: "INVALID_INPUT" });
  });
  it("rejects seconds and a midnight-crossing reservation", async () => {
    expect(
      await actions().createBooking(
        bookingInput(fixture, { start: "2026-10-07T12:00:01+09:00" }),
      ),
    ).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(
      await actions().createBooking(
        bookingInput(fixture, {
          start: bookingInstant("21:00"),
          end: bookingInstant("01:00", "2026-10-08"),
        }),
      ),
    ).toEqual({ ok: false, code: "INVALID_INPUT" });
  });
  it.each(["missing", "archived"])(
    "returns NOT_FOUND for %s space",
    async (kind) => {
      const spaceId =
        kind === "missing" ? crypto.randomUUID() : fixture.archivedSpaceId;
      expect(
        await actions().createBooking(bookingInput(fixture, { spaceId })),
      ).toEqual({ ok: false, code: "NOT_FOUND" });
    },
  );
  it.each(["desk", "unbookable"])(
    "rejects a %s space after access checks",
    async (kind) => {
      expect(
        await actions().createBooking(
          bookingInput(fixture, {
            spaceId: kind === "desk" ? fixture.deskId : fixture.deskAreaId,
          }),
        ),
      ).toEqual({ ok: false, code: "INVALID_INPUT" });
    },
  );
  it("returns FORBIDDEN before past-time errors for an inaccessible space", async () => {
    expect(
      await actions().createBooking(
        bookingInput(fixture, {
          spaceId: fixture.restrictedSpaceId,
          start: bookingInstant("10:00"),
          end: bookingInstant("11:00"),
        }),
      ),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
  });
  it.each([
    "personal restricted",
    "wrong allowed team",
    "not my team",
    "closed",
    "inaccessible floor",
  ])("rejects unauthorized booking mode: %s", async (kind) => {
    const session =
      kind === "not my team" || kind === "inaccessible floor"
        ? fixture.person
        : fixture.member;
    const input = bookingInput(fixture, {
      spaceId:
        kind === "closed"
          ? fixture.closedSpaceId
          : kind === "inaccessible floor"
            ? fixture.restrictedFloorSpaceId
            : fixture.restrictedSpaceId,
      teamId:
        kind === "wrong allowed team"
          ? fixture.otherTeamId
          : kind === "not my team"
            ? fixture.teamId
            : null,
    });
    expect(await actions(session).createBooking(input)).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
  });
  it("requires the selected team to be in the intersection of floor and space grants", async () => {
    await database.db
      .update(spaces)
      .set({ access: "teams" })
      .where(eq(spaces.id, fixture.restrictedFloorSpaceId));
    await database.db
      .insert(accessGrants)
      .values({
        targetType: "space",
        targetId: fixture.restrictedFloorSpaceId,
        teamId: fixture.otherTeamId,
      });
    for (const teamId of [fixture.teamId, fixture.otherTeamId]) {
      expect(
        await actions(fixture.member).createBooking(
          bookingInput(fixture, {
            spaceId: fixture.restrictedFloorSpaceId,
            teamId,
          }),
        ),
      ).toEqual({ ok: false, code: "FORBIDDEN" });
    }
  });
  it.each(["floor.view", "booking.own", "booking.team"] as const)(
    "honors disabled permission %s",
    async (permission) => {
      const teamBooking = permission === "booking.team";
      const role = teamBooking ? "team_member" : "user";
      await database.db.insert(roleSettings).values({
        branchId: fixture.branchId,
        role,
        permissions: defaultPermissions[role].filter(
          (key) => key !== permission,
        ),
      });
      expect(
        await actions(
          teamBooking ? fixture.member : fixture.person,
        ).createBooking(
          bookingInput(fixture, {
            teamId: teamBooking ? fixture.teamId : null,
          }),
        ),
      ).toEqual({ ok: false, code: "FORBIDDEN" });
    },
  );
  it.each([
    ["outside operating hours", "22:00", "23:00", "2026-10-07"],
    ["closed Sunday", "12:00", "13:00", "2026-10-11"],
  ])("returns OUTSIDE_HOURS for %s", async (_, start, end, date) => {
    expect(
      await actions().createBooking(
        bookingInput(fixture, {
          start: bookingInstant(start, date),
          end: bookingInstant(end, date),
        }),
      ),
    ).toEqual({ ok: false, code: "OUTSIDE_HOURS" });
  });
  it.each([
    ["per_booking", "12:00", "14:30", "2026-10-07"],
    ["days_ahead", "12:00", "13:00", "2026-10-15"],
  ])("reports exact quota reason %s", async (reason, start, end, date) => {
    expect(
      await actions().createBooking(
        bookingInput(fixture, {
          start: bookingInstant(start, date),
          end: bookingInstant(end, date),
        }),
      ),
    ).toEqual({ ok: false, code: "LIMIT_EXCEEDED", message: reason });
  });
  it("allows two adjacent hours, rejects the next half hour, then releases cancelled usage", async () => {
    const action = actions().createBooking;
    const first = await action(bookingInput(fixture));
    expect(first.ok).toBe(true);
    expect(
      (
        await action(
          bookingInput(fixture, {
            start: bookingInstant("13:00"),
            end: bookingInstant("14:00"),
          }),
        )
      ).ok,
    ).toBe(true);
    const third = bookingInput(fixture, {
      start: bookingInstant("14:00"),
      end: bookingInstant("14:30"),
    });
    expect(await action(third)).toEqual({
      ok: false,
      code: "LIMIT_EXCEEDED",
      message: "per_day",
    });
    if (!first.ok) throw new Error("Expected first booking.");
    await database.db
      .update(bookings)
      .set({
        status: "cancelled",
        cancelledAt: bookingNow,
        cancelledBy: fixture.person.userId,
      })
      .where(eq(bookings.id, first.data.bookingId));
    expect((await action(third)).ok).toBe(true);
  });
  it("does not count another branch, date, person or team in a personal quota", async () => {
    await insertFixtureBooking(database, fixture, {
      spaceId: fixture.otherSpaceId,
      during: bookingRange("12:00", "14:00"),
    });
    await insertFixtureBooking(database, fixture, {
      during: bookingRange("12:00", "14:00", "2026-10-06"),
    });
    await insertFixtureBooking(database, fixture, {
      spaceId: fixture.secondSpaceId,
      userId: fixture.stranger.userId,
      during: bookingRange("12:00", "14:00"),
    });
    await insertFixtureBooking(database, fixture, {
      spaceId: fixture.restrictedSpaceId,
      teamId: fixture.teamId,
      during: bookingRange("12:00", "14:00"),
    });
    expect(
      (
        await actions().createBooking(
          bookingInput(fixture, { end: bookingInstant("14:00") }),
        )
      ).ok,
    ).toBe(true);
  });
  it("aggregates team quota across different members", async () => {
    const input = bookingInput(fixture, {
      teamId: fixture.teamId,
      end: bookingInstant("16:00"),
    });
    expect((await actions(fixture.member).createBooking(input)).ok).toBe(true);
    expect(
      (
        await actions(fixture.admin).createBooking({
          ...input,
          spaceId: fixture.secondSpaceId,
        })
      ).ok,
    ).toBe(true);
    expect(
      await actions(fixture.admin).createBooking({
        ...input,
        start: bookingInstant("16:00"),
        end: bookingInstant("16:30"),
      }),
    ).toEqual({ ok: false, code: "LIMIT_EXCEEDED", message: "per_day" });
  });
  it("lets the local operator use a restricted room personally without default quotas", async () => {
    expect(
      await actions(fixture.operator).createBooking(
        bookingInput(fixture, {
          spaceId: fixture.restrictedSpaceId,
          start: bookingInstant("09:00", "2026-11-01"),
          end: bookingInstant("22:00", "2026-11-01"),
        }),
      ),
    ).toEqual({ ok: false, code: "OUTSIDE_HOURS" });
    expect(
      (
        await actions(fixture.operator).createBooking(
          bookingInput(fixture, {
            spaceId: fixture.restrictedSpaceId,
            start: bookingInstant("09:00", "2026-11-02"),
            end: bookingInstant("22:00", "2026-11-02"),
          }),
        )
      ).ok,
    ).toBe(true);
  });
  it("applies role_settings limits per key without losing defaults", async () => {
    await database.db.insert(roleSettings).values({
      branchId: fixture.branchId,
      role: "user",
      permissions: [...defaultPermissions.user],
      limits: { maxMinutesPerBooking: 30 },
    });
    expect(await actions().createBooking(bookingInput(fixture))).toEqual({
      ok: false,
      code: "LIMIT_EXCEEDED",
      message: "per_booking",
    });
    expect(
      (
        await actions().createBooking(
          bookingInput(fixture, { end: bookingInstant("12:30") }),
        )
      ).ok,
    ).toBe(true);
  });
  it("rejects maintenance overlap without publishing or inserting", async () => {
    await database.db.insert(spaceBlocks).values({
      spaceId: fixture.publicSpaceId,
      during: bookingRange(),
      createdBy: fixture.operator.userId,
    });
    const publish = vi.fn();
    expect(
      await actions(fixture.person, { publisher: { publish } }).createBooking(
        bookingInput(fixture),
      ),
    ).toEqual({ ok: false, code: "SPACE_BLOCKED" });
    expect(await database.db.select().from(bookings)).toHaveLength(0);
    expect(publish).not.toHaveBeenCalled();
  });
  it("checks quota before maintenance and maintenance before database overlap", async () => {
    await insertFixtureBooking(database, fixture, {
      userId: fixture.stranger.userId,
    });
    await database.db
      .insert(spaceBlocks)
      .values({
        spaceId: fixture.publicSpaceId,
        during: bookingRange(),
        createdBy: fixture.operator.userId,
      });
    expect(
      await actions().createBooking(
        bookingInput(fixture, { end: bookingInstant("14:30") }),
      ),
    ).toEqual({ ok: false, code: "LIMIT_EXCEEDED", message: "per_booking" });
    expect(await actions().createBooking(bookingInput(fixture))).toEqual({
      ok: false,
      code: "SPACE_BLOCKED",
    });
    expect(await database.db.select().from(bookings)).toHaveLength(1);
  });
  it("maps the real EXCLUDE violation to BOOKING_CONFLICT and keeps one row", async () => {
    const publish = vi.fn();
    const action = actions(fixture.person, {
      publisher: { publish },
    }).createBooking;
    expect((await action(bookingInput(fixture))).ok).toBe(true);
    expect(await action(bookingInput(fixture))).toEqual({
      ok: false,
      code: "BOOKING_CONFLICT",
    });
    expect(await database.db.select().from(bookings)).toHaveLength(1);
    expect(publish).toHaveBeenCalledTimes(1);
  });
  it.each(["archived", "unbookable"])(
    "rechecks the %s flag after locking the space",
    async (kind) => {
      const original = bookingDal.lockSpaceForBooking;
      vi.spyOn(bookingDal, "lockSpaceForBooking").mockImplementationOnce(
        async (spaceId, transaction) => {
          await transaction
            .update(spaces)
            .set(
              kind === "archived"
                ? { archivedAt: bookingNow }
                : { bookable: false },
            )
            .where(eq(spaces.id, spaceId));
          return original(spaceId, transaction);
        },
      );
      expect(await actions().createBooking(bookingInput(fixture))).toEqual({
        ok: false,
        code: kind === "archived" ? "NOT_FOUND" : "INVALID_INPUT",
      });
      expect(await database.db.select().from(bookings)).toHaveLength(0);
    },
  );
  it("rechecks current access inside the transaction before inserting", async () => {
    const original = bookingDal.lockSpaceForBooking;
    vi.spyOn(bookingDal, "lockSpaceForBooking").mockImplementationOnce(
      async (spaceId, transaction) => {
        await transaction
          .update(spaces)
          .set({ access: "closed" })
          .where(eq(spaces.id, spaceId));
        return original(spaceId, transaction);
      },
    );
    expect(await actions().createBooking(bookingInput(fixture))).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(await database.db.select().from(bookings)).toHaveLength(0);
  });
  it("keeps a committed booking successful if realtime publication fails without leaking the exception", async () => {
    const logError = vi.fn();
    const publish = vi
      .fn()
      .mockRejectedValue(new Error("private transport secret"));
    expect(
      (
        await actions(fixture.person, {
          publisher: { publish },
          logError,
        }).createBooking(bookingInput(fixture))
      ).ok,
    ).toBe(true);
    expect(await database.db.select().from(bookings)).toHaveLength(1);
    expect(logError).toHaveBeenCalledExactlyOnceWith(
      "Booking realtime publication failed.",
    );
  });
  it("stores a real default branch, but rejects unknown branches and unauthenticated writes", async () => {
    expect(
      await actions().setDefaultBranch({ branchId: fixture.otherBranchId }),
    ).toEqual({ ok: true, data: { branchId: fixture.otherBranchId } });
    const [user] = await database.db
      .select()
      .from(users)
      .where(eq(users.id, fixture.person.userId));
    expect(user?.defaultBranchId).toBe(fixture.otherBranchId);
    expect(
      await actions().setDefaultBranch({ branchId: crypto.randomUUID() }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(
      await actions(null).setDefaultBranch({ branchId: fixture.branchId }),
    ).toEqual({ ok: false, code: "UNAUTHENTICATED" });
  });
});

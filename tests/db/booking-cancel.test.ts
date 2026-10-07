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
import { createCancelBookingAction } from "@/features/bookings/cancel-booking-factory";
import type { BookingDependencies } from "@/features/bookings/action-factory";
import type { Session } from "@/lib/auth/types";
import { accessGrants, bookings, roleSettings, spaces } from "@/lib/db/schema";
import { defaultPermissions } from "@/lib/permissions/defaults";
import { createMemoryRealtime } from "@/lib/realtime/memory";
import {
  bookingNow,
  bookingRange,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("booking cancellation action", () => {
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
  function cancel(
    session: Session | null = fixture.person,
    overrides: BookingDependencies = {},
  ) {
    return createCancelBookingAction({
      database: database.db,
      getSession: async () => session,
      now: () => bookingNow,
      logError: vi.fn(),
      ...overrides,
    });
  }

  it("cancels an ongoing own booking with exact injected audit values, keeps its row and publishes once", async () => {
    const row = await insertFixtureBooking(database, fixture);
    const realtime = createMemoryRealtime();
    const listener = vi.fn();
    realtime.subscribe(`floor:${fixture.floorId}`, listener);
    const action = cancel(fixture.person, { publisher: realtime });
    expect(await action({ bookingId: row.id })).toEqual({
      ok: true,
      data: { bookingId: row.id },
    });
    expect(await database.db.select().from(bookings)).toMatchObject([
      {
        id: row.id,
        status: "cancelled",
        cancelledAt: bookingNow,
        cancelledBy: fixture.person.userId,
        during: row.during,
      },
    ]);
    expect(listener).toHaveBeenCalledExactlyOnceWith({
      type: "booking.changed",
      spaceId: fixture.publicSpaceId,
    });
    expect(await action({ bookingId: row.id })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    "lets the author cancel even after booking.own is disabled (team=%s)",
    async (teamBooking) => {
      const author = teamBooking ? fixture.member : fixture.person;
      const row = await insertFixtureBooking(database, fixture, {
        userId: author.userId,
        teamId: teamBooking ? fixture.teamId : null,
      });
      await database.db
        .insert(roleSettings)
        .values({ branchId: fixture.branchId, role: "user", permissions: [] });
      expect(await cancel(author)({ bookingId: row.id })).toEqual({
        ok: true,
        data: { bookingId: row.id },
      });
    },
  );

  it("lets the author cancel after the space becomes inaccessible", async () => {
    const row = await insertFixtureBooking(database, fixture);
    await database.db
      .update(spaces)
      .set({ access: "closed" })
      .where(eq(spaces.id, fixture.publicSpaceId));
    expect(await cancel()({ bookingId: row.id })).toEqual({
      ok: true,
      data: { bookingId: row.id },
    });
  });

  it("lets a team admin cancel the team's booking after its space access grant is removed", async () => {
    const row = await insertFixtureBooking(database, fixture, {
      spaceId: fixture.restrictedSpaceId,
      userId: fixture.member.userId,
      teamId: fixture.teamId,
    });
    await database.db
      .delete(accessGrants)
      .where(eq(accessGrants.targetId, fixture.restrictedSpaceId));
    expect(await cancel(fixture.admin)({ bookingId: row.id })).toEqual({
      ok: true,
      data: { bookingId: row.id },
    });
    const [actual] = await database.db
      .select()
      .from(bookings)
      .where(eq(bookings.id, row.id));
    expect(actual?.cancelledBy).toBe(fixture.admin.userId);
    expect(actual?.cancelledAt).toEqual(bookingNow);
  });

  it("rejects a normal team member cancelling another member's team booking", async () => {
    const row = await insertFixtureBooking(database, fixture, {
      userId: fixture.admin.userId,
      teamId: fixture.teamId,
    });
    expect(await cancel(fixture.member)({ bookingId: row.id })).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
  });

  it("does not promote ordinary members to team admins through a permission override", async () => {
    const row = await insertFixtureBooking(database, fixture, {
      userId: fixture.admin.userId,
      teamId: fixture.teamId,
    });
    await database.db.insert(roleSettings).values({
      branchId: fixture.branchId,
      role: "team_member",
      permissions: [...defaultPermissions.team_member, "booking.manage_team"],
    });
    expect(await cancel(fixture.member)({ bookingId: row.id })).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    const [actual] = await database.db
      .select()
      .from(bookings)
      .where(eq(bookings.id, row.id));
    expect(actual?.status).toBe("confirmed");
  });

  it("does not let a different team's admin cancel a visible team booking", async () => {
    const row = await insertFixtureBooking(database, fixture, {
      userId: fixture.member.userId,
      teamId: fixture.teamId,
    });
    expect(await cancel(fixture.otherMember)({ bookingId: row.id })).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
  });

  it("honors a disabled booking.manage_team permission for team admins", async () => {
    const row = await insertFixtureBooking(database, fixture, {
      userId: fixture.member.userId,
      teamId: fixture.teamId,
    });
    await database.db.insert(roleSettings).values({
      branchId: fixture.branchId,
      role: "team_admin",
      permissions: defaultPermissions.team_admin.filter(
        (key) => key !== "booking.manage_team",
      ),
    });
    expect(await cancel(fixture.admin)({ bookingId: row.id })).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
  });

  it("lets the actual branch operator cancel a stranger's restricted booking", async () => {
    const row = await insertFixtureBooking(database, fixture, {
      spaceId: fixture.restrictedSpaceId,
      userId: fixture.member.userId,
      teamId: fixture.teamId,
    });
    expect(await cancel(fixture.operator)({ bookingId: row.id })).toEqual({
      ok: true,
      data: { bookingId: row.id },
    });
    const [actual] = await database.db
      .select()
      .from(bookings)
      .where(eq(bookings.id, row.id));
    expect(actual?.cancelledBy).toBe(fixture.operator.userId);
  });

  it("honors a disabled booking.manage_all operator permission", async () => {
    const row = await insertFixtureBooking(database, fixture);
    await database.db.insert(roleSettings).values({
      branchId: fixture.branchId,
      role: "operator",
      permissions: defaultPermissions.operator.filter(
        (key) => key !== "booking.manage_all",
      ),
    });
    expect(await cancel(fixture.operator)({ bookingId: row.id })).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
  });

  it.each([false, true])(
    "treats another branch's operator as an ordinary viewer (restricted=%s)",
    async (restricted) => {
      const row = await insertFixtureBooking(database, fixture, {
        spaceId: restricted ? fixture.restrictedSpaceId : fixture.publicSpaceId,
      });
      expect(
        await cancel(fixture.otherOperator)({ bookingId: row.id }),
      ).toEqual({ ok: false, code: restricted ? "NOT_FOUND" : "FORBIDDEN" });
    },
  );

  it.each(["missing", "ended", "cancelled", "invisible"])(
    "returns NOT_FOUND for a %s booking",
    async (kind) => {
      const row =
        kind === "missing"
          ? { id: crypto.randomUUID() }
          : await insertFixtureBooking(database, fixture, {
              ...(kind === "ended"
                ? { during: bookingRange("11:00", "12:00") }
                : {}),
              ...(kind === "cancelled"
                ? {
                    status: "cancelled",
                    cancelledAt: bookingNow,
                    cancelledBy: fixture.person.userId,
                  }
                : {}),
              ...(kind === "invisible"
                ? {
                    spaceId: fixture.restrictedSpaceId,
                    userId: fixture.member.userId,
                  }
                : {}),
            });
      const publish = vi.fn();
      expect(
        await cancel(fixture.person, { publisher: { publish } })({
          bookingId: row.id,
        }),
      ).toEqual({ ok: false, code: "NOT_FOUND" });
      expect(publish).not.toHaveBeenCalled();
    },
  );

  it("treats an exact end instant as ended", async () => {
    const row = await insertFixtureBooking(database, fixture, {
      during: {
        start: new Date(bookingNow.getTime() - 30 * 60_000),
        end: bookingNow,
      },
    });
    expect(await cancel()({ bookingId: row.id })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
  });

  it("requires a session before validating input and rejects forged audit fields", async () => {
    expect(await cancel(null)({})).toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    const row = await insertFixtureBooking(database, fixture);
    expect(
      await cancel()({
        bookingId: row.id,
        cancelledBy: fixture.operator.userId,
      }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("retains a committed cancellation when realtime fails and logs only a fixed message", async () => {
    const row = await insertFixtureBooking(database, fixture);
    const logError = vi.fn();
    expect(
      await cancel(fixture.person, {
        publisher: {
          publish: vi
            .fn()
            .mockRejectedValue(new Error("secret publisher error")),
        },
        logError,
      })({ bookingId: row.id }),
    ).toEqual({ ok: true, data: { bookingId: row.id } });
    const [actual] = await database.db
      .select()
      .from(bookings)
      .where(eq(bookings.id, row.id));
    expect(actual?.status).toBe("cancelled");
    expect(logError).toHaveBeenCalledExactlyOnceWith(
      "Booking realtime publication failed.",
    );
  });
});

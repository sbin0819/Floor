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
import { createBookingActions } from "@/features/bookings/create-booking-factory";
import { createLeaveBookingAction } from "@/features/bookings/leave-booking-factory";
import type { BookingDependencies } from "@/features/bookings/action-factory";
import type { Session } from "@/lib/auth/types";
import * as participantDal from "@/lib/dal/booking-participants";
import * as bookingDal from "@/lib/dal/bookings";
import * as schema from "@/lib/db/schema";
import {
  bookingParticipants,
  bookings,
  chatRooms,
  spaces,
  users,
} from "@/lib/db/schema";
import { bookingDayRange } from "@/features/bookings/rules";
import {
  bookingInput,
  bookingNow,
  bookingDate,
  bookingRange,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("booking participants and leave action", () => {
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
  afterEach(() => vi.restoreAllMocks());
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
  const create = (
    session: Session | null = fixture.person,
    overrides: BookingDependencies = {},
  ) => createBookingActions(options(session, overrides)).createBooking;
  const leave = (
    session: Session | null = fixture.stranger,
    overrides: BookingDependencies = {},
  ) => createLeaveBookingAction(options(session, overrides));
  const external = () => ({
    userId: fixture.stranger.userId,
    email: fixture.stranger.email,
  });
  const input = (participants = [external()]) => ({
    ...bookingInput(fixture),
    participants,
  });
  async function guests(count: number) {
    const rows = Array.from({ length: count }, (_, i) => ({
      id: crypto.randomUUID(),
      email: `guest${i}@example.test`,
      name: `손님 ${i}`,
      emailVerified: true,
    }));
    await database.db.insert(users).values(rows);
    return rows.map(({ id, email }) => ({ userId: id, email }));
  }
  async function participantBooking(
    overrides: Partial<typeof bookings.$inferInsert> = {},
  ) {
    const booked = await insertFixtureBooking(database, fixture, {
      attendeeCount: 4,
      ...overrides,
    });
    await database.db
      .insert(bookingParticipants)
      .values({ bookingId: booked.id, userId: fixture.stranger.userId });
    return booked;
  }
  const recordedDatabase = () => {
    const statements: { query: string; params: unknown[] }[] = [];
    return {
      statements,
      db: drizzle({
        client: database.client,
        schema,
        logger: {
          logQuery(query, params) {
            statements.push({ query, params });
          },
        },
      }),
    };
  };

  it("inserts participants once, returns no identity/email, and publishes after commit once", async () => {
    const publish = vi.fn(async () => {
      expect(await database.db.select().from(bookingParticipants)).toHaveLength(
        1,
      );
    });
    const result = await create(fixture.person, { publisher: { publish } })(
      input([external(), external()]),
    );
    expect(result).toEqual({
      ok: true,
      data: { bookingId: expect.any(String) },
    });
    expect(await database.db.select().from(bookingParticipants)).toEqual([
      {
        bookingId: result.ok ? result.data.bookingId : "",
        userId: fixture.stranger.userId,
        createdAt: bookingNow,
      },
    ]);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain(fixture.stranger.email);
  });

  it("normalizes UUID/email case and applies the 20-person limit after ID deduplication", async () => {
    const entry = {
      userId: fixture.stranger.userId.toUpperCase(),
      email: fixture.stranger.email.toUpperCase(),
    };
    expect(
      (await create()(input(Array.from({ length: 21 }, () => entry)))).ok,
    ).toBe(true);
    expect(await database.db.select().from(bookingParticipants)).toHaveLength(
      1,
    );
  });

  it.each(["owner", "missing", "unverified", "no-email", "wrong-email"])(
    "rejects %s with a generic participant field error and no writes",
    async (kind) => {
      let row: { userId: string; email?: string } = external();
      if (kind === "owner") row = { userId: fixture.person.userId };
      if (kind === "missing")
        row = { userId: crypto.randomUUID(), email: "unknown@example.test" };
      if (kind === "unverified")
        await database.db
          .update(users)
          .set({ emailVerified: false })
          .where(eq(users.id, row.userId));
      if (kind === "no-email") row = { userId: row.userId };
      if (kind === "wrong-email") row.email = "wrong@example.test";
      const result = await create()({
        ...bookingInput(fixture),
        participants: [row],
      });
      expect(result).toEqual({
        ok: false,
        code: "INVALID_INPUT",
        fieldErrors: { participants: [expect.any(String)] },
      });
      expect(await database.db.select().from(bookings)).toEqual([]);
      expect(await database.db.select().from(bookingParticipants)).toEqual([]);
      expect(JSON.stringify(result)).not.toContain(row.userId);
    },
  );

  it("accepts a shared-team participant without an email and not unrelated users", async () => {
    const rows = await participantDal.getParticipantEligibility(
      fixture.member.userId,
      [fixture.admin.userId, fixture.stranger.userId],
      database.db,
    );
    expect(rows.find(({ id }) => id === fixture.admin.userId)?.sharesTeam).toBe(
      true,
    );
    expect(
      rows.find(({ id }) => id === fixture.stranger.userId)?.sharesTeam,
    ).toBe(false);
    expect(
      (
        await create(fixture.member)({
          ...bookingInput(fixture),
          participants: [{ userId: fixture.admin.userId }],
        })
      ).ok,
    ).toBe(true);
  });

  it("rejects an explicit owner invitation before the capacity-one check", async () => {
    await database.db
      .update(spaces)
      .set({ capacity: 1 })
      .where(eq(spaces.id, fixture.publicSpaceId));
    const eligibility = vi.spyOn(participantDal, "getParticipantEligibility");
    expect(
      await create()({
        ...bookingInput(fixture),
        participants: [{ userId: fixture.person.userId }],
      }),
    ).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      fieldErrors: { participants: [expect.any(String)] },
    });
    expect(eligibility).not.toHaveBeenCalled();
    expect(await database.db.select().from(bookings)).toEqual([]);
  });

  it.each([5, 6])("enforces external guest count %s", async (count) => {
    const participants = await guests(count);
    const result = await create()({
      ...bookingInput(fixture, { spaceId: fixture.secondSpaceId }),
      participants,
    });
    expect(result.ok).toBe(count === 5);
    if (count === 6)
      expect(result).toMatchObject({
        code: "INVALID_INPUT",
        fieldErrors: { participants: [expect.any(String)] },
      });
  });

  it("rejects 21 distinct participants before database target reads", async () => {
    const lookup = vi.spyOn(participantDal, "getParticipantEligibility");
    expect(
      await create()({
        ...bookingInput(fixture),
        participants: Array.from({ length: 21 }, () => ({
          userId: crypto.randomUUID(),
        })),
      }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each([3, 4])(
    "counts the owner against capacity with %s participants",
    async (count) => {
      const result = await create()(input(await guests(count)));
      expect(result.ok).toBe(count === 3);
      if (count === 4)
        expect(result).toEqual({
          ok: false,
          code: "OVER_CAPACITY",
          message: "participants",
        });
    },
  );

  it("rejects an attendee count smaller than owner plus participants", async () => {
    expect(
      await create()({ ...input(await guests(2)), attendeeCount: 2 }),
    ).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      fieldErrors: { attendeeCount: [expect.any(String)] },
    });
  });

  it("rechecks reduced capacity after the space lock", async () => {
    const original = bookingDal.lockSpaceForBooking;
    vi.spyOn(bookingDal, "lockSpaceForBooking").mockImplementationOnce(
      async (id, db) => {
        await db.update(spaces).set({ capacity: 1 }).where(eq(spaces.id, id));
        return original(id, db);
      },
    );
    expect(await create()(input())).toEqual({
      ok: false,
      code: "OVER_CAPACITY",
      message: "participants",
    });
    expect(await database.db.select().from(bookings)).toEqual([]);
  });

  it("rechecks participant eligibility after sorted user locks", async () => {
    const original = participantDal.lockParticipantBookingActor;
    vi.spyOn(
      participantDal,
      "lockParticipantBookingActor",
    ).mockImplementationOnce(async (actor, db) => {
      await db
        .update(users)
        .set({ emailVerified: false })
        .where(eq(users.id, fixture.stranger.userId));
      return original(actor, db);
    });
    expect(await create()(input())).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      fieldErrors: { participants: [expect.any(String)] },
    });
  });

  it("returns the generic participant error when an invitee disappears before the user lock", async () => {
    const original = participantDal.lockParticipantBookingActor;
    vi.spyOn(
      participantDal,
      "lockParticipantBookingActor",
    ).mockImplementationOnce(async (actor, db) => {
      await db.delete(users).where(eq(users.id, fixture.stranger.userId));
      return original(actor, db);
    });
    expect(await create()(input())).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      fieldErrors: { participants: [expect.any(String)] },
    });
    expect(await database.db.select().from(bookings)).toEqual([]);
  });

  it("does not require a guest to have access to the reserved private room", async () => {
    expect(
      (
        await create(fixture.member)({
          ...input(),
          spaceId: fixture.restrictedSpaceId,
          teamId: fixture.teamId,
        })
      ).ok,
    ).toBe(true);
  });

  it("rolls participants back on EXCLUDE conflicts and late write failures", async () => {
    await insertFixtureBooking(database, fixture, {
      userId: fixture.stranger.userId,
    });
    expect(await create()(input())).toEqual({
      ok: false,
      code: "BOOKING_CONFLICT",
    });
    expect(await database.db.select().from(bookingParticipants)).toEqual([]);
    const original = participantDal.insertBookingParticipants;
    vi.spyOn(
      participantDal,
      "insertBookingParticipants",
    ).mockImplementationOnce(async (...args) => {
      await original(...args);
      throw new Error("private participant failure");
    });
    expect(
      await create()({ ...input(), spaceId: fixture.secondSpaceId }),
    ).toEqual({ ok: false, code: "INTERNAL" });
    expect(await database.db.select().from(bookings)).toHaveLength(1);
    expect(await database.db.select().from(bookingParticipants)).toEqual([]);
  });

  it("preserves the no-participant SQL path for omitted and empty arrays", async () => {
    const eligible = vi.spyOn(participantDal, "getParticipantEligibility");
    const locks = vi.spyOn(participantDal, "lockParticipantBookingActor");
    const original = vi.spyOn(bookingDal, "lockBookingActor");
    const first = recordedDatabase();
    expect(
      (
        await create(fixture.person, { database: first.db })(
          bookingInput(fixture),
        )
      ).ok,
    ).toBe(true);
    const second = recordedDatabase();
    expect(
      (
        await create(fixture.person, { database: second.db })({
          ...bookingInput(fixture, { spaceId: fixture.secondSpaceId }),
          participants: [],
        })
      ).ok,
    ).toBe(true);
    expect(first.statements.map(({ query }) => query)).toEqual(
      second.statements.map(({ query }) => query),
    );
    expect(eligible).not.toHaveBeenCalled();
    expect(locks).not.toHaveBeenCalled();
    expect(original).toHaveBeenCalledTimes(2);
  });

  it.each([null, "team"])(
    "locks users in UUID order with final strengths before the %s actor",
    async (mode) => {
      const record = recordedDatabase();
      const owner = fixture.member;
      const participants = [
        { userId: fixture.admin.userId },
        { userId: fixture.stranger.userId, email: fixture.stranger.email },
      ];
      expect(
        (
          await create(owner, { database: record.db })({
            ...bookingInput(fixture),
            teamId: mode ? fixture.teamId : null,
            participants,
          })
        ).ok,
      ).toBe(true);
      const locks = record.statements.filter(({ query }) =>
        /for (?:share|update|key share)/u.test(query),
      );
      const ids = [
        owner.userId,
        fixture.admin.userId,
        fixture.stranger.userId,
      ].sort();
      expect(locks.map(({ params }) => params[0])).toEqual([
        fixture.floorId,
        fixture.publicSpaceId,
        ...ids,
        ...(mode ? [fixture.teamId] : []),
        (await database.db.select({ id: chatRooms.id }).from(chatRooms))[0]!.id,
      ]);
      expect(locks.at(-1)?.query).toMatch(/from "chat_rooms".*for update/);
      for (const lock of locks.slice(2, 5))
        expect(lock.query).toContain(
          lock.params[0] === owner.userId && !mode
            ? "for update"
            : "for key share",
        );
    },
  );

  it("deduplicates repeated user locks to the strongest request without upgrading", async () => {
    const record = recordedDatabase();
    await record.db.transaction(async (tx) => {
      expect(
        await participantDal.lockBookingUsers(
          [
            { userId: fixture.person.userId, strength: "key share" },
            { userId: fixture.stranger.userId, strength: "key share" },
            { userId: fixture.person.userId.toUpperCase(), strength: "update" },
          ],
          tx,
        ),
      ).toBe(true);
    });
    const locks = record.statements.filter(({ query }) =>
      /for (?:update|key share)/u.test(query),
    );
    expect(locks).toHaveLength(2);
    expect(locks.map(({ params }) => params[0])).toEqual(
      [fixture.person.userId, fixture.stranger.userId].sort(),
    );
    expect(
      locks.find(({ params }) => params[0] === fixture.person.userId)?.query,
    ).toContain("for update");
  });

  it("completes reciprocal invitations using the same sorted user lock order", async () => {
    const record = recordedDatabase();
    const results = await Promise.all([
      create(fixture.person, { database: record.db })(input()),
      create(fixture.stranger, { database: record.db })({
        ...bookingInput(fixture, { spaceId: fixture.secondSpaceId }),
        participants: [
          { userId: fixture.person.userId, email: fixture.person.email },
        ],
      }),
    ]);
    expect(results.every(({ ok }) => ok)).toBe(true);
    const locks = record.statements.filter(({ query }) =>
      /from "users".*for (?:update|key share)/u.test(query),
    );
    expect(locks.map(({ params }) => params[0])).toEqual([
      ...[fixture.person.userId, fixture.stranger.userId].sort(),
      ...[fixture.person.userId, fixture.stranger.userId].sort(),
    ]);
  });

  it("leaves a booking once with no attendee-count change or quota charge", async () => {
    const booked = await participantBooking();
    expect(
      await bookingDal.sumBookedMinutes(
        {
          branchId: fixture.branchId,
          during: bookingDayRange(bookingDate, "Asia/Seoul"),
          actor: { userId: fixture.stranger.userId },
        },
        database.db,
      ),
    ).toBe(0);
    const publish = vi.fn(async () => {
      expect(await database.db.select().from(bookingParticipants)).toEqual([]);
    });
    expect(
      await leave(fixture.stranger, { publisher: { publish } })({
        bookingId: booked.id,
      }),
    ).toEqual({ ok: true, data: { bookingId: booked.id } });
    expect(await leave()({ bookingId: booked.id })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect((await database.db.select().from(bookings))[0]?.attendeeCount).toBe(
      4,
    );
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it.each(["owner", "outsider", "ended", "cancelled", "missing"])(
    "does not leave a %s booking",
    async (kind) => {
      const booked = await participantBooking(
        kind === "ended"
          ? { during: bookingRange("10:00", "11:00") }
          : kind === "cancelled"
            ? { status: "cancelled", cancelledAt: bookingNow }
            : {},
      );
      const session =
        kind === "owner"
          ? fixture.person
          : kind === "outsider"
            ? fixture.operator
            : fixture.stranger;
      expect(
        await leave(session)({
          bookingId: kind === "missing" ? crypto.randomUUID() : booked.id,
        }),
      ).toEqual({ ok: false, code: "NOT_FOUND" });
      expect(await database.db.select().from(bookingParticipants)).toHaveLength(
        1,
      );
    },
  );

  it("checks authentication before leave input and rejects forged ownership", async () => {
    expect(await leave(null)({})).toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    expect(
      await leave()({
        bookingId: crypto.randomUUID(),
        userId: fixture.person.userId,
      }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("locks sorted caller/owner users before the booking, and deletes conditionally", async () => {
    const booked = await participantBooking();
    const record = recordedDatabase();
    expect(
      (
        await leave(fixture.stranger, { database: record.db })({
          bookingId: booked.id,
        })
      ).ok,
    ).toBe(true);
    const locks = record.statements.filter(({ query }) =>
      /for (?:update|key share)/u.test(query),
    );
    expect(locks.map(({ params }) => params[0])).toEqual([
      ...[fixture.person.userId, fixture.stranger.userId].sort(),
      booked.id,
      booked.id,
    ]);
    expect(
      locks.map(({ query }) => query.match(/for (update|key share)/u)?.[1]),
    ).toEqual(["key share", "key share", "update", "update"]);
    expect(locks.at(-1)?.query).toMatch(/from "chat_rooms".*for update/);
    const deletion = record.statements.find(({ query }) =>
      query.startsWith('delete from "booking_participants"'),
    );
    expect(deletion?.query).toContain("'confirmed'");
    expect(deletion?.query).toContain('upper("bookings"."during")');
  });

  it("rolls a failed leave back and keeps success after event publication fails", async () => {
    const booked = await participantBooking();
    const original = participantDal.deleteCurrentBookingParticipant;
    vi.spyOn(
      participantDal,
      "deleteCurrentBookingParticipant",
    ).mockImplementationOnce(async (...args) => {
      await original(...args);
      throw new Error("private leave failure");
    });
    expect(await leave()({ bookingId: booked.id })).toEqual({
      ok: false,
      code: "INTERNAL",
    });
    expect(await database.db.select().from(bookingParticipants)).toHaveLength(
      1,
    );
    expect(
      (
        await leave(fixture.stranger, {
          publisher: {
            publish: vi
              .fn()
              .mockRejectedValue(new Error("private event failure")),
          },
        })({ bookingId: booked.id })
      ).ok,
    ).toBe(true);
    expect(await database.db.select().from(bookingParticipants)).toEqual([]);
  });
});

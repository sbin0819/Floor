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
import { createCancelBookingAction } from "@/features/bookings/cancel-booking-factory";
import { createDeskBookingAction } from "@/features/bookings/create-desk-booking-factory";
import { createLeaveBookingAction } from "@/features/bookings/leave-booking-factory";
import type { BookingDependencies } from "@/features/bookings/action-factory";
import type { Session } from "@/lib/auth/types";
import * as notificationDal from "@/lib/dal/notifications";
import * as participantDal from "@/lib/dal/booking-participants";
import * as bookingDal from "@/lib/dal/bookings";
import * as schema from "@/lib/db/schema";
import { bookingParticipants, bookings, notifications } from "@/lib/db/schema";
import {
  bookingInput,
  bookingNow,
  bookingRange,
  bookingDate,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("atomic booking notifications and sorted recipient locks", () => {
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
    session: Session = fixture.person,
    overrides: BookingDependencies = {},
  ): BookingDependencies => ({
    database: database.db,
    getSession: async () => session,
    now: () => bookingNow,
    logError: vi.fn(),
    ...overrides,
  });
  const input = () => ({
    ...bookingInput(fixture, {
      start: "2026-10-07T13:30:00+09:00",
      end: "2026-10-07T14:30:00+09:00",
      title: "기획 회의",
    }),
    participants: [fixture.stranger, fixture.operator].map(
      ({ userId, email }) => ({ userId, email }),
    ),
  });
  async function create(overrides: BookingDependencies = {}) {
    const result = await createBookingActions(
      options(fixture.person, overrides),
    ).createBooking(input());
    if (!result.ok) throw new Error(`Expected booking: ${result.code}`);
    return result.data;
  }
  const rows = () => database.db.select().from(notifications);
  it("writes two invitations and twelve future reminders in one insert after the booking", async () => {
    const insert = vi.spyOn(notificationDal, "insertNotifications");
    const result = await create();
    expect(insert).toHaveBeenCalledTimes(1);
    expect(
      (await rows()).filter(({ type }) => type === "booking_invited"),
    ).toHaveLength(2);
    const reminders = (await rows()).filter(
      ({ type }) => type === "booking_reminder",
    );
    expect(reminders).toHaveLength(12);
    expect(
      reminders.every(
        ({ bookingId, actorId, expiresAt }) =>
          bookingId === result.bookingId &&
          actorId === null &&
          expiresAt?.toISOString() === "2026-10-07T05:30:00.000Z",
      ),
    ).toBe(true);
    for (const row of await rows()) {
      expect(row.data).not.toHaveProperty("email");
      expect(row.data).not.toHaveProperty("userId");
      expect(row.data).not.toHaveProperty("bookingId");
      expect(JSON.stringify(row.data)).not.toContain(fixture.person.userId);
      if (row.type === "booking_reminder")
        expect(row.data).not.toHaveProperty("title");
    }
  });
  it("writes three reminders per person for a booking fifteen minutes before start", async () => {
    const result = await createBookingActions(
      options(fixture.person, { now: () => new Date("2026-10-07T03:15:00Z") }),
    ).createBooking({
      ...input(),
      start: "2026-10-07T12:30:00+09:00",
      end: "2026-10-07T13:30:00+09:00",
    });
    expect(result.ok).toBe(true);
    expect(
      (await rows()).filter(({ type }) => type === "booking_reminder"),
    ).toHaveLength(9);
  });
  it("gives a lone owner reminders but not an invitation", async () => {
    expect(
      (
        await createBookingActions(options()).createBooking({
          ...input(),
          participants: [],
        })
      ).ok,
    ).toBe(true);
    expect(await rows()).toHaveLength(4);
    expect(
      (await rows()).every(
        ({ type, userId }) =>
          type === "booking_reminder" && userId === fixture.person.userId,
      ),
    ).toBe(true);
  });
  it("does not retain notifications for a conflict or a failed notification insert", async () => {
    await insertFixtureBooking(database, fixture, {
      during: bookingRange("13:30", "14:30"),
    });
    expect(
      await createBookingActions(options()).createBooking(input()),
    ).toEqual({ ok: false, code: "BOOKING_CONFLICT" });
    expect(await rows()).toEqual([]);
    const original = notificationDal.insertNotifications;
    vi.spyOn(notificationDal, "insertNotifications").mockImplementationOnce(
      async (...args) => {
        await original(...args);
        throw new Error("private notification error");
      },
    );
    expect(
      await createBookingActions(options()).createBooking({
        ...input(),
        spaceId: fixture.secondSpaceId,
      }),
    ).toEqual({ ok: false, code: "INTERNAL" });
    expect(await rows()).toEqual([]);
    expect(await database.db.select().from(bookingParticipants)).toEqual([]);
    expect(await database.db.select().from(bookings)).toHaveLength(1);
  });
  it.each(["owner", "operator"])(
    "cancels as %s, removes reminders and avoids notifying the actor",
    async (kind) => {
      const booking = await create();
      const actor = kind === "owner" ? fixture.person : fixture.operator;
      expect(
        (await createCancelBookingAction(options(actor))(booking)).ok,
      ).toBe(true);
      expect(
        (await rows()).filter(({ type }) => type === "booking_reminder"),
      ).toEqual([]);
      const cancelled = (await rows()).filter(
        ({ type }) => type === "booking_cancelled",
      );
      expect(cancelled).toHaveLength(2);
      expect(cancelled.some(({ userId }) => userId === actor.userId)).toBe(
        false,
      );
      expect(cancelled.map(({ userId }) => userId).sort()).toEqual(
        (kind === "owner"
          ? [fixture.stranger.userId, fixture.operator.userId]
          : [fixture.stranger.userId, fixture.person.userId]
        ).sort(),
      );
      expect(await database.db.select().from(bookingParticipants)).toHaveLength(
        2,
      );
    },
  );
  it("notifies an owner and both participants when a non-attending operator cancels", async () => {
    const result = await createBookingActions(options()).createBooking({
      ...input(),
      participants: [fixture.stranger, fixture.otherMember].map(
        ({ userId, email }) => ({ userId, email }),
      ),
    });
    if (!result.ok) throw new Error("Expected booking");
    expect(
      (await createCancelBookingAction(options(fixture.operator))(result.data))
        .ok,
    ).toBe(true);
    expect(
      (await rows()).filter(({ type }) => type === "booking_cancelled"),
    ).toHaveLength(3);
  });
  it("leaves only one guest's reminders and notifies the owner once", async () => {
    const booking = await create();
    expect(
      (await createLeaveBookingAction(options(fixture.stranger))(booking)).ok,
    ).toBe(true);
    const reminders = (await rows()).filter(
      ({ type }) => type === "booking_reminder",
    );
    expect(reminders).toHaveLength(8);
    expect(
      reminders.some(({ userId }) => userId === fixture.stranger.userId),
    ).toBe(false);
    const left = (await rows()).filter(
      ({ type }) => type === "participant_left",
    );
    expect(left).toMatchObject([
      {
        userId: fixture.person.userId,
        actorId: fixture.stranger.userId,
        expiresAt: null,
        data: { actorName: fixture.stranger.name },
      },
    ]);
  });
  it("writes no desk creation reminders and uses the area plus seat in operator cancellation", async () => {
    const result = await createDeskBookingAction(options())({
      deskId: fixture.deskId,
      date: bookingDate,
      part: "pm",
      teamId: null,
    });
    if (!result.ok) throw new Error("Expected desk");
    expect(await rows()).toEqual([]);
    expect(
      (await createCancelBookingAction(options(fixture.operator))(result.data))
        .ok,
    ).toBe(true);
    expect(await rows()).toMatchObject([
      {
        type: "booking_cancelled",
        userId: fixture.person.userId,
        data: { spaceName: "데스크 구역 좌석 1" },
      },
    ]);
    expect(await rows()).toHaveLength(1);
  });
  it("preserves the no-notification owner desk cancellation lock path", async () => {
    const result = await createDeskBookingAction(options())({
      deskId: fixture.deskId,
      date: bookingDate,
      part: "pm",
      teamId: null,
    });
    if (!result.ok) throw new Error("Expected desk");
    const existingLock = vi.spyOn(bookingDal, "lockBookingCanceller");
    const newLock = vi.spyOn(participantDal, "lockBookingUsers");
    const participants = vi.spyOn(participantDal, "listBookingParticipantIds");
    const insert = vi.spyOn(notificationDal, "insertNotifications");
    const remove = vi.spyOn(notificationDal, "deleteBookingReminders");
    expect((await createCancelBookingAction(options())(result.data)).ok).toBe(
      true,
    );
    expect(existingLock).toHaveBeenCalledTimes(1);
    for (const spy of [newLock, participants, insert, remove])
      expect(spy).not.toHaveBeenCalled();
  });
  it("locks all cancellation recipients in UUID order before locking the booking", async () => {
    const booking = await create();
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
        await createCancelBookingAction(
          options(fixture.operator, { database: db }),
        )(booking)
      ).ok,
    ).toBe(true);
    const locks = statements.filter(({ query }) =>
      /for (?:update|key share)/u.test(query),
    );
    expect(locks.map(({ params }) => params[0])).toEqual([
      ...[
        fixture.person.userId,
        fixture.operator.userId,
        fixture.stranger.userId,
      ].sort(),
      booking.bookingId,
    ]);
  });
  it("restarts the whole transaction if a latest participant was not locked and publishes once", async () => {
    const booking = await create();
    const original = participantDal.listBookingParticipantIds;
    vi.spyOn(participantDal, "listBookingParticipantIds")
      .mockResolvedValueOnce([])
      .mockImplementation(original);
    const transaction = vi.spyOn(database.db, "transaction");
    const publish = vi.fn();
    expect(
      (
        await createCancelBookingAction(
          options(fixture.person, { publisher: { publish } }),
        )(booking)
      ).ok,
    ).toBe(true);
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(
      (await rows()).filter(({ type }) => type === "booking_cancelled"),
    ).toHaveLength(2);
  });
  it("bounds repeated lock-set changes to three attempts with no partial cancellation", async () => {
    const booking = await create();
    const original = participantDal.listBookingParticipantIds;
    let reads = 0;
    vi.spyOn(participantDal, "listBookingParticipantIds").mockImplementation(
      async (...args) => (++reads % 2 ? [] : original(...args)),
    );
    const transaction = vi.spyOn(database.db, "transaction");
    const publish = vi.fn();
    expect(
      await createCancelBookingAction(
        options(fixture.person, { publisher: { publish } }),
      )(booking),
    ).toEqual({ ok: false, code: "INTERNAL" });
    expect(transaction).toHaveBeenCalledTimes(3);
    expect(publish).not.toHaveBeenCalled();
    expect((await database.db.select().from(bookings))[0]?.status).toBe(
      "confirmed",
    );
    expect(
      (await rows()).filter(({ type }) => type === "booking_reminder"),
    ).toHaveLength(12);
  });
  it("rolls back cancellation and leave when notification insertion fails", async () => {
    const booking = await create();
    const initial = await rows();
    vi.spyOn(notificationDal, "insertNotifications").mockRejectedValue(
      new Error("private insert error"),
    );
    expect(await createCancelBookingAction(options())(booking)).toEqual({
      ok: false,
      code: "INTERNAL",
    });
    expect(
      await createLeaveBookingAction(options(fixture.stranger))(booking),
    ).toEqual({ ok: false, code: "INTERNAL" });
    expect((await database.db.select().from(bookings))[0]?.status).toBe(
      "confirmed",
    );
    expect(await database.db.select().from(bookingParticipants)).toHaveLength(
      2,
    );
    expect(await rows()).toEqual(initial);
  });
  it("serializes reciprocal participant cancellations in the same user lock order", async () => {
    const first = await createBookingActions(options()).createBooking({
      ...input(),
      participants: [
        { userId: fixture.stranger.userId, email: fixture.stranger.email },
      ],
    });
    const second = await createBookingActions(
      options(fixture.stranger),
    ).createBooking({
      ...input(),
      spaceId: fixture.secondSpaceId,
      participants: [
        { userId: fixture.person.userId, email: fixture.person.email },
      ],
    });
    if (!first.ok || !second.ok) throw new Error("Expected two bookings");
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
    const results = await Promise.all([
      createCancelBookingAction(options(fixture.person, { database: db }))(
        first.data,
      ),
      createCancelBookingAction(options(fixture.stranger, { database: db }))(
        second.data,
      ),
    ]);
    expect(results.every(({ ok }) => ok)).toBe(true);
    const locks = statements.filter(({ query }) =>
      /from "users".*for key share/u.test(query),
    );
    expect(locks.map(({ params }) => params[0])).toEqual([
      ...[fixture.person.userId, fixture.stranger.userId].sort(),
      ...[fixture.person.userId, fixture.stranger.userId].sort(),
    ]);
    expect(
      (await rows()).filter(({ type }) => type === "booking_cancelled"),
    ).toHaveLength(2);
  });
  it("keeps the newly committed cancellation even if realtime publication fails", async () => {
    const booking = await create();
    expect(
      (
        await createCancelBookingAction(
          options(fixture.person, {
            publisher: {
              publish: vi.fn().mockRejectedValue(new Error("private event")),
            },
          }),
        )(booking)
      ).ok,
    ).toBe(true);
    expect(
      (await rows()).filter(({ type }) => type === "booking_cancelled"),
    ).toHaveLength(2);
    expect(
      (
        await database.db
          .select()
          .from(bookings)
          .where(eq(bookings.id, booking.bookingId))
      )[0]?.status,
    ).toBe("cancelled");
  });
});

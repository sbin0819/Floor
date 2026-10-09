import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import * as dbSchema from "@/lib/db/schema";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createAdminBookingQueries } from "@/features/admin/booking-query-factory";
import { createCancelBookingAsOperator } from "@/features/admin/booking-action-factory";
import { createBookingActions } from "@/features/bookings/create-booking-factory";
import { createBookingQueries } from "@/features/bookings/query-factory";
import { ActionError } from "@/lib/actions/result";
import type { Session } from "@/lib/auth/types";
import * as participantsDal from "@/lib/dal/booking-participants";
import * as meetingDal from "@/lib/dal/chat-meeting";
import {
  bookingParticipants,
  bookings,
  messages,
  notifications,
  roleSettings,
  users,
} from "@/lib/db/schema";
import { createTestDatabase, type TestDatabase } from "./helper";
import {
  bookingDate,
  bookingInstant,
  bookingNow,
  bookingRange,
  bookingInput,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createQueryMeter } from "./query-meter";

describe("operator booking list and cancellation", () => {
  let database: TestDatabase;
  let fixture: BookingActors;
  let meter: ReturnType<typeof createQueryMeter>;
  const publish = vi.fn(async () => {});
  const publishMany = vi.fn(async () => {});
  beforeAll(async () => {
    database = await createTestDatabase();
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
  });
  const deps = (session: Session = fixture.operator) => ({
    database: database.db,
    getSession: async () => session,
    requireSession: async () => session,
    now: () => bookingNow,
    publisher: { publish },
    chatPublisher: { publish, publishMany },
    livekit: null,
    logError: vi.fn(),
  });
  const read = (options = {}, session = fixture.operator) =>
    createAdminBookingQueries(deps(session)).getAdminBookings({
      branchId: fixture.branchId,
      date: bookingDate,
      ...options,
    });
  const cancel = (
    bookingId: string,
    overrides = {},
    session = fixture.operator,
  ) =>
    createCancelBookingAsOperator(deps(session))({
      bookingId,
      preset: "공간 점검",
      text: "냉방기 점검",
      ...overrides,
    });
  async function meeting() {
    const result = await createBookingActions(
      deps(fixture.person),
    ).createBooking({
      ...bookingInput(fixture),
      start: bookingInstant("13:00"),
      end: bookingInstant("14:00"),
      participants: [
        { userId: fixture.stranger.userId, email: fixture.stranger.email },
      ],
    });
    if (!result.ok) throw new Error(result.code);
    return result.data.bookingId;
  }
  it("normalizes uppercase booking IDs before the locked identity comparison", async () => {
    const booking = await insertFixtureBooking(database, fixture);
    expect(await cancel(booking.id.toUpperCase())).toEqual({
      ok: true,
      data: { bookingId: booking.id },
    });
  });
  it.each([
    { date: "0000-01-01", days: 1 as const },
    { date: "9999-12-31", days: 1 as const },
    { date: "9999-12-26", days: 7 as const },
  ])(
    "rejects date-window overflow without reading the database: %j",
    async (input) => {
      await expect(read(input)).rejects.toMatchObject({
        code: "INVALID_INPUT",
      });
      meter.start();
      await read(input).catch(() => null);
      expect(meter.stop().perStage).toEqual([]);
    },
  );
  it("rejects NUL in a search or cancellation reason before SQL", async () => {
    const booking = await insertFixtureBooking(database, fixture);
    meter.start();
    await expect(read({ q: "이름\0" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(await cancel(booking.id, { text: "이유\0" })).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      fieldErrors: { text: expect.any(Array) },
    });
    expect(meter.stop().perStage).toEqual([]);
  });
  it("reads only the authorized branch with participant counts and no email/meeting links", async () => {
    const booking = await insertFixtureBooking(database, fixture, {
      attendeeCount: 4,
    });
    await database.db
      .insert(bookingParticipants)
      .values({ bookingId: booking.id, userId: fixture.stranger.userId });
    await insertFixtureBooking(database, fixture, {
      spaceId: fixture.otherSpaceId,
    });
    const result = await read();
    expect(result.total).toBe(1);
    expect(result.rows[0]).toMatchObject({
      id: booking.id,
      attendeeCount: 4,
      participantCount: 1,
      canCancel: true,
      avatar: { photoUrl: null },
    });
    expect(JSON.stringify(result)).not.toMatch(/email|meetingRoom|authId/);
  });
  it("filters floor/type/status/day and does not leak a foreign floor", async () => {
    await insertFixtureBooking(database, fixture, {
      title: "프로젝트",
      status: "cancelled",
      cancelledAt: bookingNow,
    });
    const later = await insertFixtureBooking(database, fixture, {
      spaceId: fixture.restrictedFloorSpaceId,
      during: bookingRange("13:00", "14:00", "2026-10-08"),
    });
    expect((await read()).rows).toEqual([]);
    expect((await read({ status: "all" })).total).toBe(1);
    expect(
      (
        await read({
          days: 7,
          floorId: fixture.restrictedFloorId,
          type: "meeting_room",
        })
      ).rows.map(({ id }) => id),
    ).toEqual([later.id]);
    expect((await read({ days: 7, type: "seminar" })).total).toBe(0);
    await expect(read({ floorId: fixture.otherFloorId })).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
  });
  it("escapes search wildcards and normalizes name search", async () => {
    await insertFixtureBooking(database, fixture, { title: "100%_\\ 검토" });
    await insertFixtureBooking(database, fixture, {
      spaceId: fixture.secondSpaceId,
      title: "100XXX 검토",
    });
    expect((await read({ q: "%_\\" })).total).toBe(1);
    expect((await read({ q: "  김하은  " })).total).toBe(2);
    await expect(read({ q: "김" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });
  it("paginates at thirty without per-row SQL and labels desk periods", async () => {
    for (let i = 0; i < 35; i++)
      await insertFixtureBooking(database, fixture, {
        status: "cancelled",
        cancelledAt: bookingNow,
      });
    const seat = await insertFixtureBooking(database, fixture, {
      spaceId: fixture.deskId,
      during: bookingRange("13:00", "22:00"),
    });
    meter.start();
    const first = await read({ status: "all" });
    expect(meter.stop().perStage).toEqual([5, 2]);
    expect(first.total).toBe(36);
    expect(first.rows).toHaveLength(30);
    const second = await read({ status: "all", page: 2 });
    expect(second.rows).toHaveLength(6);
    expect(
      new Set([...first.rows, ...second.rows].map(({ id }) => id)).size,
    ).toBe(36);
    expect(
      [...first.rows, ...second.rows].find(({ id }) => id === seat.id),
    ).toMatchObject({ areaName: "데스크 구역", deskPart: "pm" });
  });
  it("requires session, branch staff, and current booking.manage_all", async () => {
    const row = await insertFixtureBooking(database, fixture);
    await expect(read({}, fixture.person)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(read({}, fixture.otherOperator)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await cancel(row.id, {}, fixture.otherOperator)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    await database.db.insert(roleSettings).values({
      branchId: fixture.branchId,
      role: "operator",
      permissions: [],
    });
    await expect(read()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await cancel(row.id)).toEqual({ ok: false, code: "FORBIDDEN" });
    const subject = createAdminBookingQueries({
      ...deps(),
      requireSession: async () => {
        throw new ActionError("UNAUTHENTICATED");
      },
    });
    await expect(
      subject.getAdminBookings({ branchId: "bad" }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
  it("stores reason, sends owner and guests notices, removes reminders and records a system message atomically", async () => {
    const id = await meeting();
    publish.mockClear();
    publishMany.mockClear();
    expect(await cancel(id)).toEqual({ ok: true, data: { bookingId: id } });
    const [row] = await database.db
      .select()
      .from(bookings)
      .where(eq(bookings.id, id));
    expect(row).toMatchObject({
      status: "cancelled",
      cancelledBy: fixture.operator.userId,
      cancelKind: "operator",
      cancelReason: "공간 점검 · 냉방기 점검",
    });
    const notices = await database.db
      .select()
      .from(notifications)
      .where(eq(notifications.bookingId, id));
    expect(notices.some(({ type }) => type === "booking_reminder")).toBe(false);
    expect(
      notices
        .filter(({ type }) => type === "booking_cancelled")
        .map(({ userId }) => userId)
        .sort(),
    ).toEqual([fixture.person.userId, fixture.stranger.userId].sort());
    const history = await database.db.select().from(messages);
    expect(history.at(-1)?.systemData).toMatchObject({
      type: "booking_cancelled",
      cancelKind: "operator",
      reason: "공간 점검 · 냉방기 점검",
    });
    expect(publish).toHaveBeenCalledWith(`floor:${fixture.floorId}`, {
      type: "booking.changed",
      spaceId: fixture.publicSpaceId,
    });
    const mine = await createBookingQueries(
      deps(fixture.person),
    ).getMyBookings();
    expect(mine.past.find((row) => row.id === id)).toMatchObject({
      cancelKind: "operator",
      cancelReason: "공간 점검 · 냉방기 점검",
    });
  });
  it("rejects repeated or ended cancellation with a fieldless stable state error", async () => {
    const row = await insertFixtureBooking(database, fixture);
    expect((await cancel(row.id)).ok).toBe(true);
    expect(await cancel(row.id)).toEqual({
      ok: false,
      code: "INVALID_INPUT",
      message: "not_cancellable",
    });
    const ended = await insertFixtureBooking(database, fixture, {
      during: bookingRange("09:00", "10:00"),
    });
    expect(await cancel(ended.id)).toEqual({
      ok: false,
      code: "INVALID_INPUT",
      message: "not_cancellable",
    });
  });
  it("rejects oversized reasons before writes and accepts a preset alone", async () => {
    const row = await insertFixtureBooking(database, fixture);
    expect(await cancel(row.id, { text: "가".repeat(193) })).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      fieldErrors: { text: expect.any(Array) },
    });
    expect((await cancel(row.id, { text: "" })).ok).toBe(true);
    expect(
      (
        await database.db.select().from(bookings).where(eq(bookings.id, row.id))
      )[0]?.cancelReason,
    ).toBe("공간 점검");
  });
  it("rechecks operator rights after acquiring the booking lock", async () => {
    const row = await insertFixtureBooking(database, fixture);
    const original = participantsDal.lockParticipantBooking;
    vi.spyOn(participantsDal, "lockParticipantBooking").mockImplementationOnce(
      async (id, tx) => {
        const locked = await original(id, tx);
        await tx.insert(roleSettings).values({
          branchId: fixture.branchId,
          role: "operator",
          permissions: [],
        });
        return locked;
      },
    );
    expect(await cancel(row.id)).toEqual({ ok: false, code: "FORBIDDEN" });
    expect((await database.db.select().from(bookings))[0]?.status).toBe(
      "confirmed",
    );
  });
  it("rolls cancellation and notices back if the meeting record fails", async () => {
    const id = await meeting();
    const notices = await database.db.select().from(notifications);
    vi.spyOn(meetingDal, "recordMeetingMessages").mockRejectedValueOnce(
      new Error("failure"),
    );
    publish.mockClear();
    publishMany.mockClear();
    expect(await cancel(id)).toEqual({ ok: false, code: "INTERNAL" });
    expect(
      (await database.db.select().from(bookings).where(eq(bookings.id, id)))[0]
        ?.status,
    ).toBe("confirmed");
    expect(await database.db.select().from(notifications)).toEqual(notices);
    expect(publish).not.toHaveBeenCalled();
    expect(publishMany).not.toHaveBeenCalled();
  });
  it("does not turn a committed cancellation into failure if publishers and logging fail", async () => {
    const id = await meeting();
    const action = createCancelBookingAsOperator({
      ...deps(),
      publisher: {
        publish: async () => {
          throw new Error("publish");
        },
      },
      chatPublisher: {
        publish,
        publishMany: async () => {
          throw new Error("publish");
        },
      },
      logError: () => {
        throw new Error("logger");
      },
    });
    expect(
      await action({ bookingId: id, preset: "운영 사정", text: "" }),
    ).toEqual({ ok: true, data: { bookingId: id } });
    expect(
      (await database.db.select().from(bookings).where(eq(bookings.id, id)))[0]
        ?.status,
    ).toBe("cancelled");
  });
  it("preserves users and a private desk emits only its parent area's change", async () => {
    const seat = await insertFixtureBooking(database, fixture, {
      spaceId: fixture.deskId,
    });
    expect((await cancel(seat.id)).ok).toBe(true);
    expect(publish).toHaveBeenCalledWith(`floor:${fixture.floorId}`, {
      type: "booking.changed",
      spaceId: fixture.deskAreaId,
    });
    expect((await database.db.select().from(users)).length).toBe(7);
    expect(await database.db.select().from(messages)).toHaveLength(0);
  });
  it("locks users in UUID order before the booking and meeting room, with a conditional write", async () => {
    const id = await meeting();
    const statements: { query: string; params: unknown[] }[] = [];
    const logged = drizzle({
      client: database.client,
      schema: dbSchema,
      logger: {
        logQuery(query, params) {
          statements.push({ query, params });
        },
      },
    });
    const action = createCancelBookingAsOperator({
      ...deps(),
      database: logged,
    });
    expect(
      (await action({ bookingId: id, preset: "운영 사정", text: "" })).ok,
    ).toBe(true);
    const userLocks = statements.filter(({ query }) =>
      /from "users".*for key share/.test(query),
    );
    expect(userLocks.map(({ params }) => params[0])).toEqual(
      [
        fixture.operator.userId,
        fixture.person.userId,
        fixture.stranger.userId,
      ].sort(),
    );
    const bookingLock = statements.findIndex(({ query }) =>
      /from "bookings".*for update/.test(query),
    );
    const roomLock = statements.findIndex(({ query }) =>
      /from "chat_rooms".*for update/.test(query),
    );
    expect(bookingLock).toBeGreaterThan(
      statements.findLastIndex(({ query }) =>
        /from "users".*for key share/.test(query),
      ),
    );
    expect(roomLock).toBeGreaterThan(bookingLock);
    const write = statements.find(({ query }) =>
      query.startsWith('update "bookings"'),
    )!;
    expect(write.query).toMatch(
      /"bookings"\."status" = .*upper\("bookings"\."during"\) > .*returning/,
    );
    expect(write.params).toContain("confirmed");
  });
  it("uses the current interval after a concurrent edit and retries an expanded guest lock set", async () => {
    const id = await meeting();
    const original = participantsDal.lockParticipantBooking;
    vi.spyOn(participantsDal, "lockParticipantBooking").mockImplementationOnce(
      async (bookingId, tx) => {
        const locked = await original(bookingId, tx);
        await tx
          .update(bookings)
          .set({ during: bookingRange("14:00", "15:00") })
          .where(eq(bookings.id, id));
        return locked;
      },
    );
    expect((await cancel(id)).ok).toBe(true);
    const notice = (await database.db.select().from(notifications)).find(
      ({ type }) => type === "booking_cancelled",
    );
    expect(notice?.data).toMatchObject({
      start: bookingRange("14:00", "15:00").start.toISOString(),
    });
    vi.restoreAllMocks();
    const next = await insertFixtureBooking(database, fixture, {
      spaceId: fixture.secondSpaceId,
      during: bookingRange("15:00", "16:00"),
    });
    const listOriginal = participantsDal.listBookingParticipantIds;
    let calls = 0;
    vi.spyOn(participantsDal, "listBookingParticipantIds").mockImplementation(
      async (...args) => {
        calls++;
        if (calls >= 2) return [fixture.stranger.userId];
        return listOriginal(...args);
      },
    );
    expect((await cancel(next.id)).ok).toBe(true);
    expect(calls).toBe(4);
  });
});

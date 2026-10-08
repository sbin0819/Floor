import { and, eq, inArray } from "drizzle-orm";
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
import { createLeaveBookingAction } from "@/features/bookings/leave-booking-factory";
import { createUpdateBookingAction } from "@/features/bookings/update-booking-factory";
import type { BookingDependencies } from "@/features/bookings/action-factory";
import type { Session } from "@/lib/auth/types";
import * as bookingDal from "@/lib/dal/bookings";
import * as participantDal from "@/lib/dal/booking-participants";
import * as updateDal from "@/lib/dal/booking-update";
import * as notificationDal from "@/lib/dal/notifications";
import * as schema from "@/lib/db/schema";
import {
  bookings,
  bookingParticipants,
  notifications,
  spaces,
  spaceBlocks,
  roleSettings,
  users,
  teamMembers,
} from "@/lib/db/schema";
import { defaultPermissions } from "@/lib/permissions/defaults";
import {
  bookingInstant,
  bookingInput,
  bookingNow,
  bookingRange,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

type Booking = typeof bookings.$inferSelect;
describe("atomic owner-only booking updates", () => {
  let database: TestDatabase;
  let fixture: BookingActors;
  const statements: { sql: string; params: unknown[] }[] = [];
  beforeAll(async () => {
    database = await createTestDatabase();
    database.db = drizzle({
      client: database.client,
      schema,
      logger: {
        logQuery(sql, params) {
          statements.push({ sql, params });
        },
      },
    });
  });
  afterAll(async () => {
    await database?.client.close();
  });
  beforeEach(async () => {
    fixture = await seedBookingActors(database);
    statements.length = 0;
  });
  afterEach(() => vi.restoreAllMocks());
  const options = (
    session: Session | null = fixture.person,
    extra: BookingDependencies = {},
  ): BookingDependencies => ({
    database: database.db,
    getSession: async () => session,
    now: () => bookingNow,
    logError: vi.fn(),
    ...extra,
  });
  const action = (
    session: Session | null = fixture.person,
    extra: BookingDependencies = {},
  ) => createUpdateBookingAction(options(session, extra));
  const make = (values: Partial<typeof bookings.$inferInsert> = {}) =>
    insertFixtureBooking(database, fixture, {
      during: bookingRange("13:30", "14:30"),
      title: "원래 제목",
      attendeeCount: 3,
      ...values,
    });
  const draft = (booking: Booking, currentIds: string[] = []) => ({
    bookingId: booking.id,
    start: booking.during.start.toISOString(),
    end: booking.during.end.toISOString(),
    attendeeCount: booking.attendeeCount,
    title: booking.title ?? undefined,
    participants: currentIds.map((userId) => ({ userId })),
    participantIdsAtLoad: currentIds,
  });
  const read = async (id: string) =>
    (await database.db.select().from(bookings).where(eq(bookings.id, id)))[0]!;
  const all = async () => ({
    bookings: await database.db.select().from(bookings).orderBy(bookings.id),
    participants: await database.db
      .select()
      .from(bookingParticipants)
      .orderBy(bookingParticipants.bookingId, bookingParticipants.userId),
    notifications: await database.db
      .select()
      .from(notifications)
      .orderBy(notifications.id),
  });
  const participantIds = (id: string) =>
    participantDal.listBookingParticipantIds(id, database.db);
  async function withParticipants() {
    const result = await createBookingActions(options()).createBooking({
      ...bookingInput(fixture, {
        start: bookingInstant("13:30"),
        end: bookingInstant("14:30"),
        title: "원래 제목",
      }),
      attendeeCount: 3,
      participants: [fixture.stranger, fixture.operator].map(
        ({ userId, email }) => ({ userId, email }),
      ),
    });
    if (!result.ok) throw new Error(`Fixture create failed: ${result.code}`);
    return read(result.data.bookingId);
  }
  const notices = async (id: string) =>
    database.db
      .select()
      .from(notifications)
      .where(eq(notifications.bookingId, id));
  const setLimits = (limits: {
    maxMinutesPerBooking?: number;
    maxMinutesPerDay?: number;
    maxDaysAhead?: number;
  }) =>
    database.db
      .insert(roleSettings)
      .values({
        branchId: fixture.branchId,
        role: "user",
        permissions: [...defaultPermissions.user],
        limits,
      })
      .onConflictDoUpdate({
        target: [roleSettings.branchId, roleSettings.role],
        set: { limits },
      });

  it("updates time and updatedAt without changing identity, date, actor or creation fields", async () => {
    const booking = await make();
    const publish = vi.fn();
    const result = await action(fixture.person, { publisher: { publish } })({
      ...draft(booking),
      start: bookingInstant("14:00"),
      end: bookingInstant("15:00"),
    });
    expect(result).toEqual({ ok: true, data: { bookingId: booking.id } });
    expect(await read(booking.id)).toEqual({
      ...booking,
      during: bookingRange("14:00", "15:00"),
      updatedAt: bookingNow,
    });
    expect(publish).toHaveBeenCalledExactlyOnceWith(
      `floor:${fixture.floorId}`,
      { type: "booking.changed", spaceId: fixture.publicSpaceId },
    );
  });

  it("treats equivalent offsets as unchanged and skips quota, time and maintenance checks", async () => {
    const booking = await make();
    await database.db
      .update(schema.branches)
      .set({ openHours: { wed: null } })
      .where(eq(schema.branches.id, fixture.branchId));
    await setLimits({
      maxMinutesPerBooking: 0,
      maxMinutesPerDay: 0,
      maxDaysAhead: 0,
    });
    await database.db.insert(spaceBlocks).values({
      spaceId: booking.spaceId,
      during: booking.during,
      createdBy: fixture.operator.userId,
    });
    const sum = vi.spyOn(bookingDal, "sumBookedMinutes");
    const blocks = vi.spyOn(bookingDal, "listSpaceBlocks");
    const result = await action()({
      ...draft(booking),
      start: bookingInstant("13:30"),
      end: bookingInstant("14:30"),
      title: "제목만",
    });
    expect(result.ok).toBe(true);
    expect(sum).not.toHaveBeenCalled();
    expect(blocks).not.toHaveBeenCalled();
    expect((await read(booking.id)).during).toEqual(booking.during);
    expect(await notices(booking.id)).toEqual([]);
  });

  it.each(["title", "count", "noop"] as const)(
    "accepts %s-only edits with existing invalid quotas and leaves notifications untouched",
    async (kind) => {
      const booking = await withParticipants();
      await setLimits({ maxMinutesPerBooking: 0, maxMinutesPerDay: 0 });
      const before = await notices(booking.id);
      const ids = await participantIds(booking.id);
      statements.length = 0;
      const result = await action()({
        ...draft(booking, ids),
        ...(kind === "title"
          ? { title: "새 제목" }
          : kind === "count"
            ? { attendeeCount: 4 }
            : {}),
      });
      expect(result.ok).toBe(true);
      expect((await read(booking.id)).updatedAt).toEqual(bookingNow);
      expect(await notices(booking.id)).toEqual(before);
      expect(
        statements.filter(({ sql }) => /^(insert|delete)/u.test(sql)),
      ).toEqual([]);
    },
  );

  it("allows overlap with itself but rolls back participants and notifications on another booking's EXCLUDE conflict", async () => {
    const booking = await withParticipants();
    const ids = await participantIds(booking.id);
    await make({
      userId: fixture.stranger.userId,
      during: bookingRange("14:30", "15:30"),
    });
    const before = await all();
    const result = await action()({
      ...draft(booking, ids),
      start: bookingInstant("14:00"),
      end: bookingInstant("15:00"),
      title: "실패할 제목",
      participants: [
        { userId: fixture.member.userId, email: fixture.member.email },
      ],
    });
    expect(result).toEqual({ ok: false, code: "BOOKING_CONFLICT" });
    expect(await all()).toEqual(before);
  });

  it.each([
    ["14:00", "15:00", "SPACE_BLOCKED"],
    ["22:00", "23:00", "OUTSIDE_HOURS"],
    ["11:00", "12:00", "INVALID_INPUT"],
    ["13:40", "14:40", "INVALID_INPUT"],
    ["14:00", "14:00", "INVALID_INPUT"],
  ])("rejects changed %s–%s with %s", async (start, end, code) => {
    const booking = await make();
    await database.db.insert(spaceBlocks).values({
      spaceId: booking.spaceId,
      during: bookingRange("14:30", "15:00"),
      createdBy: fixture.operator.userId,
    });
    const before = await all();
    expect(
      await action()({
        ...draft(booking),
        start: bookingInstant(start),
        end: bookingInstant(end),
      }),
    ).toEqual({ ok: false, code });
    expect(await all()).toEqual(before);
  });

  it("forbids a different local date and permits same-day midnight ending under 24-hour hours", async () => {
    const booking = await make();
    expect(
      await action()({
        ...draft(booking),
        start: bookingInstant("13:30", "2026-10-08"),
        end: bookingInstant("14:30", "2026-10-08"),
      }),
    ).toEqual({ ok: false, code: "INVALID_INPUT" });
    await database.db
      .update(schema.branches)
      .set({ openHours: { wed: { open: "00:00", close: "24:00" } } })
      .where(eq(schema.branches.id, fixture.branchId));
    expect(
      (
        await action()({
          ...draft(booking),
          start: bookingInstant("23:00"),
          end: "2026-10-08T00:00:00+09:00",
        })
      ).ok,
    ).toBe(true);
  });

  it("subtracts its original interval from the daily quota and succeeds after the other reservation is cancelled", async () => {
    await setLimits({ maxMinutesPerBooking: 120, maxMinutesPerDay: 120 });
    const booking = await make();
    const other = await make({
      spaceId: fixture.secondSpaceId,
      during: bookingRange("15:30", "16:30"),
    });
    const input = { ...draft(booking), end: bookingInstant("15:00") };
    expect(await action()(input)).toEqual({
      ok: false,
      code: "LIMIT_EXCEEDED",
      message: "per_day",
    });
    await database.db
      .update(bookings)
      .set({ status: "cancelled", cancelledAt: bookingNow })
      .where(eq(bookings.id, other.id));
    expect((await action()(input)).ok).toBe(true);
  });

  it.each(["per_booking", "days_ahead"] as const)(
    "checks %s only for a changed time",
    async (reason) => {
      await setLimits(
        reason === "per_booking"
          ? { maxMinutesPerBooking: 30 }
          : { maxDaysAhead: 0 },
      );
      const booking = await make({
        during:
          reason === "days_ahead"
            ? bookingRange("13:30", "14:30", "2026-10-08")
            : bookingRange("13:30", "14:30"),
      });
      expect(
        await action()({
          ...draft(booking),
          end: bookingInstant(
            "15:00",
            reason === "days_ahead" ? "2026-10-08" : "2026-10-07",
          ),
        }),
      ).toEqual({ ok: false, code: "LIMIT_EXCEEDED", message: reason });
    },
  );

  it("checks ongoing state against the stored interval but still permits metadata and participants", async () => {
    const booking = await make({ during: bookingRange("12:00", "13:00") });
    expect(
      await action()({ ...draft(booking), end: bookingInstant("13:30") }),
    ).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(
      (
        await action()({
          ...draft(booking),
          title: "진행 중 메모",
          attendeeCount: 2,
          participants: [
            { userId: fixture.stranger.userId, email: fixture.stranger.email },
          ],
        })
      ).ok,
    ).toBe(true);
    expect(await participantIds(booking.id)).toEqual([fixture.stranger.userId]);
  });

  it.each([
    "missing",
    "other owner",
    "invited",
    "cancelled",
    "ended",
    "archived",
  ] as const)("does not disclose a %s reservation", async (kind) => {
    const booking = await make({
      ...(kind === "other owner" || kind === "invited"
        ? { userId: fixture.stranger.userId }
        : {}),
      ...(kind === "cancelled"
        ? { status: "cancelled", cancelledAt: bookingNow }
        : {}),
      ...(kind === "ended" ? { during: bookingRange("11:00", "12:00") } : {}),
      ...(kind === "archived" ? { spaceId: fixture.archivedSpaceId } : {}),
    });
    if (kind === "invited")
      await database.db
        .insert(bookingParticipants)
        .values({ bookingId: booking.id, userId: fixture.person.userId });
    expect(
      await action()({
        ...draft(booking),
        bookingId: kind === "missing" ? crypto.randomUUID() : booking.id,
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("rejects desks before checking inaccessible desk/area access", async () => {
    const booking = await make({
      spaceId: fixture.deskId,
      attendeeCount: null,
    });
    await database.db
      .update(spaces)
      .set({ access: "closed" })
      .where(inArray(spaces.id, [fixture.deskId, fixture.deskAreaId]));
    expect(await action()(draft(booking))).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
  });

  it("rejects lost access while the owner's existing cancellation remains allowed", async () => {
    const booking = await make();
    await database.db
      .update(spaces)
      .set({ access: "closed" })
      .where(eq(spaces.id, booking.spaceId));
    expect(await action()(draft(booking))).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(
      (await createCancelBookingAction(options())({ bookingId: booking.id }))
        .ok,
    ).toBe(true);
  });

  it("checks the original team actor membership, not a submitted replacement", async () => {
    const booking = await make({
      userId: fixture.member.userId,
      teamId: fixture.teamId,
    });
    await database.db
      .delete(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, fixture.teamId),
          eq(teamMembers.userId, fixture.member.userId),
        ),
      );
    expect(await action(fixture.member)(draft(booking))).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(
      await action(fixture.member)({ ...draft(booking), teamId: null }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("enforces the current attendee and participant capacities and permits reducing them", async () => {
    const booking = await withParticipants();
    const ids = await participantIds(booking.id);
    await database.db
      .update(spaces)
      .set({ capacity: 2 })
      .where(eq(spaces.id, booking.spaceId));
    expect(await action()({ ...draft(booking, ids), title: "제목만" })).toEqual(
      { ok: false, code: "OVER_CAPACITY", message: "attendee_count" },
    );
    expect(
      await action()({ ...draft(booking, ids), attendeeCount: null }),
    ).toEqual({ ok: false, code: "OVER_CAPACITY", message: "participants" });
    expect(
      (
        await action()({
          ...draft(booking, ids),
          attendeeCount: 2,
          participants: [{ userId: ids[0]! }],
        })
      ).ok,
    ).toBe(true);
  });

  it.each([
    "small count",
    "self",
    "missing email",
    "wrong email",
    "unverified",
  ] as const)("rejects invalid participant edits: %s", async (kind) => {
    const booking = await make();
    const target = kind === "self" ? fixture.person : fixture.stranger;
    if (kind === "unverified")
      await database.db
        .update(users)
        .set({ emailVerified: false })
        .where(eq(users.id, target.userId));
    const result = await action()({
      ...draft(booking),
      attendeeCount: kind === "small count" ? 1 : 3,
      participants: [
        {
          userId: target.userId,
          ...(kind === "missing email"
            ? {}
            : {
                email:
                  kind === "wrong email" ? "wrong@example.test" : target.email,
              }),
        },
      ],
    });
    expect(result).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await participantIds(booking.id)).toEqual([]);
  });

  it("retains existing unverified external participants without asking for email again", async () => {
    const booking = await withParticipants();
    const ids = await participantIds(booking.id);
    await database.db
      .update(users)
      .set({ emailVerified: false })
      .where(inArray(users.id, ids));
    expect(
      (await action()({ ...draft(booking, ids), title: "제목 수정" })).ok,
    ).toBe(true);
    expect((await participantIds(booking.id)).sort()).toEqual(ids.sort());
  });

  it("rechecks the entire external participant count even without additions and does not auto-remove anyone", async () => {
    const booking = await make({
      spaceId: fixture.secondSpaceId,
      attendeeCount: null,
    });
    const ids: string[] = [];
    for (let index = 0; index < 6; index++) {
      const [user] = await database.db
        .insert(users)
        .values({
          email: `guest-${index}@example.test`,
          name: `손님 ${index}`,
          emailVerified: false,
        })
        .returning();
      ids.push(user!.id);
    }
    await database.db
      .insert(bookingParticipants)
      .values(ids.map((userId) => ({ bookingId: booking.id, userId })));
    expect(
      await action()({ ...draft(booking, ids), title: "제목만" }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect((await participantIds(booking.id)).sort()).toEqual(ids.sort());
    expect((await read(booking.id)).updatedAt).toBeNull();
  });

  it("does not accept participantIdsAtLoad as authorization or email proof", async () => {
    const booking = await make();
    const absent = fixture.stranger.userId;
    expect(
      (
        await action()({
          ...draft(booking),
          participants: [{ userId: absent }],
          participantIdsAtLoad: [absent],
        })
      ).ok,
    ).toBe(true);
    expect(await participantIds(booking.id)).toEqual([]);
    expect(
      await action()({
        ...draft(booking),
        participants: [{ userId: absent }],
        participantIdsAtLoad: [],
      }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it.each([false, true])(
    "diffs recipients and reminders once when timeChanged=%s",
    async (changed) => {
      const booking = await withParticipants();
      const ids = await participantIds(booking.id);
      if (changed) {
        const reminder = (await notices(booking.id)).find(
          ({ type }) => type === "booking_reminder",
        )!;
        await database.db
          .update(notifications)
          .set({ scheduledFor: new Date(bookingNow.getTime() - 1_000) })
          .where(eq(notifications.id, reminder.id));
      }
      const before = await notices(booking.id);
      const beforeIds = new Set(before.map(({ id }) => id));
      const insert = vi.spyOn(notificationDal, "insertNotifications");
      statements.length = 0;
      const result = await action()({
        ...draft(booking, ids),
        ...(changed
          ? { start: bookingInstant("14:00"), end: bookingInstant("15:00") }
          : {}),
        participants: [
          { userId: fixture.stranger.userId },
          { userId: fixture.member.userId, email: fixture.member.email },
        ],
      });
      expect(result.ok).toBe(true);
      expect(insert).toHaveBeenCalledTimes(1);
      expect((await participantIds(booking.id)).sort()).toEqual(
        [fixture.stranger.userId, fixture.member.userId].sort(),
      );
      const rows = await notices(booking.id);
      const fresh = rows.filter(({ id }) => !beforeIds.has(id));
      expect(
        fresh.filter(({ type }) => type === "booking_invited"),
      ).toMatchObject([
        {
          userId: fixture.member.userId,
          data: {
            start: changed
              ? bookingRange("14:00", "15:00").start.toISOString()
              : booking.during.start.toISOString(),
          },
        },
      ]);
      expect(
        fresh.filter(({ type }) => type === "booking_removed"),
      ).toMatchObject([
        {
          userId: fixture.operator.userId,
          data: {
            start: booking.during.start.toISOString(),
            end: booking.during.end.toISOString(),
          },
        },
      ]);
      expect(
        fresh.filter(({ type }) => type === "booking_changed"),
      ).toHaveLength(changed ? 1 : 0);
      if (changed) {
        expect(
          fresh.find(({ type }) => type === "booking_changed"),
        ).toMatchObject({
          userId: fixture.stranger.userId,
          data: {
            previousStart: booking.during.start.toISOString(),
            previousEnd: booking.during.end.toISOString(),
          },
        });
        expect(
          rows.filter(
            ({ id, type }) => type === "booking_reminder" && beforeIds.has(id),
          ),
        ).toEqual([]);
      }
      expect(
        rows.filter(({ type }) => type === "booking_reminder"),
      ).toHaveLength(12);
      expect(
        rows.filter(
          ({ type, userId }) =>
            type === "booking_reminder" && userId === fixture.operator.userId,
        ),
      ).toEqual([]);
      expect(
        rows.filter(
          ({ type, userId }) =>
            type === "booking_reminder" && userId === fixture.member.userId,
        ),
      ).toHaveLength(4);
      const participantWrites = statements.filter(({ sql }) =>
        /^(insert into|delete from) "booking_participants"/u.test(sql),
      );
      expect(participantWrites).toHaveLength(2);
      const update = statements.filter(({ sql }) =>
        /^update "bookings"/u.test(sql),
      );
      expect(update).toHaveLength(1);
      expect(update[0]!.sql).toMatch(
        /"user_id" = .*"status" = .*upper\("bookings"\."during"\) > .*returning/u,
      );
    },
  );

  it("does not resurrect a participant who left before an old edit and preserves their vanished reminders", async () => {
    const booking = await withParticipants();
    const input = draft(booking, await participantIds(booking.id));
    expect(
      (
        await createLeaveBookingAction(options(fixture.stranger))({
          bookingId: booking.id,
        })
      ).ok,
    ).toBe(true);
    const beforeInvites = (await notices(booking.id)).filter(
      ({ type }) => type === "booking_invited",
    ).length;
    expect((await action()({ ...input, title: "오래된 화면" })).ok).toBe(true);
    expect(await participantIds(booking.id)).toEqual([fixture.operator.userId]);
    const rows = await notices(booking.id);
    expect(rows.filter(({ type }) => type === "booking_invited")).toHaveLength(
      beforeInvites,
    );
    expect(
      rows.filter(
        ({ type, userId }) =>
          type === "booking_reminder" && userId === fixture.stranger.userId,
      ),
    ).toEqual([]);
  });

  it("allows leave after an edit and snapshots the latest time for the departure", async () => {
    const booking = await withParticipants();
    expect(
      (
        await action()({
          ...draft(booking, await participantIds(booking.id)),
          start: bookingInstant("14:00"),
          end: bookingInstant("15:00"),
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await createLeaveBookingAction(options(fixture.stranger))({
          bookingId: booking.id,
        })
      ).ok,
    ).toBe(true);
    const rows = await notices(booking.id);
    expect(
      rows.find(({ type }) => type === "participant_left")?.data.start,
    ).toBe(bookingRange("14:00", "15:00").start.toISOString());
    expect(
      rows.filter(
        ({ type, userId }) =>
          type === "booking_reminder" && userId === fixture.stranger.userId,
      ),
    ).toEqual([]);
  });

  it("does not re-add a participant who leaves while the edit waits for the space lock", async () => {
    const booking = await withParticipants();
    const input = draft(booking, await participantIds(booking.id));
    const original = bookingDal.lockSpaceForBooking;
    vi.spyOn(bookingDal, "lockSpaceForBooking").mockImplementationOnce(
      async (id, db) => {
        await db
          .delete(bookingParticipants)
          .where(
            and(
              eq(bookingParticipants.bookingId, booking.id),
              eq(bookingParticipants.userId, fixture.stranger.userId),
            ),
          );
        await notificationDal.deleteBookingReminders(
          { bookingId: booking.id, userIds: [fixture.stranger.userId] },
          db,
        );
        return original(id, db);
      },
    );
    expect((await action()({ ...input, title: "대기 뒤 수정" })).ok).toBe(true);
    expect(await participantIds(booking.id)).toEqual([fixture.operator.userId]);
    expect(
      (await notices(booking.id)).filter(
        ({ type, userId }) =>
          type === "booking_reminder" && userId === fixture.stranger.userId,
      ),
    ).toEqual([]);
  });

  it.each(["capacity", "access", "archived", "conflict", "cancelled"] as const)(
    "rechecks %s after locking and rolls everything back",
    async (kind) => {
      const booking = await withParticipants();
      const input = draft(booking, await participantIds(booking.id));
      const before = await all();
      const original = bookingDal.lockSpaceForBooking;
      vi.spyOn(bookingDal, "lockSpaceForBooking").mockImplementationOnce(
        async (id, db) => {
          if (kind === "capacity")
            await db
              .update(spaces)
              .set({ capacity: 1 })
              .where(eq(spaces.id, id));
          if (kind === "access")
            await db
              .update(spaces)
              .set({ access: "closed" })
              .where(eq(spaces.id, id));
          if (kind === "archived")
            await db
              .update(spaces)
              .set({ archivedAt: bookingNow })
              .where(eq(spaces.id, id));
          if (kind === "conflict")
            await db.insert(bookings).values({
              spaceId: id,
              userId: fixture.stranger.userId,
              during: bookingRange("14:30", "15:30"),
            });
          if (kind === "cancelled")
            await db
              .update(bookings)
              .set({ status: "cancelled", cancelledAt: bookingNow })
              .where(eq(bookings.id, booking.id));
          return original(id, db);
        },
      );
      const result = await action()({
        ...input,
        start: bookingInstant("14:00"),
        end: bookingInstant("15:00"),
      });
      expect(result).toMatchObject({
        ok: false,
        code: {
          capacity: "OVER_CAPACITY",
          access: "FORBIDDEN",
          archived: "NOT_FOUND",
          conflict: "BOOKING_CONFLICT",
          cancelled: "NOT_FOUND",
        }[kind],
      });
      expect(await all()).toEqual(before);
    },
  );

  it("uses the locked latest interval as the previous notification time", async () => {
    const booking = await withParticipants();
    const input = draft(booking, await participantIds(booking.id));
    const original = participantDal.lockParticipantBooking;
    vi.spyOn(participantDal, "lockParticipantBooking").mockImplementationOnce(
      async (id, db) => {
        await db
          .update(bookings)
          .set({ during: bookingRange("13:00", "14:00") })
          .where(eq(bookings.id, id));
        return original(id, db);
      },
    );
    expect(
      (
        await action()({
          ...input,
          start: bookingInstant("14:00"),
          end: bookingInstant("15:00"),
        })
      ).ok,
    ).toBe(true);
    for (const row of (await notices(booking.id)).filter(
      ({ type }) => type === "booking_changed",
    ))
      expect(row.data.previousStart).toBe(
        bookingRange("13:00", "14:00").start.toISOString(),
      );
  });

  it.each([false, true])(
    "retries the complete transaction for an unlocked current recipient; exhaust=%s",
    async (exhaust) => {
      const booking = await make();
      const original = participantDal.listBookingParticipantIds;
      let transactionReads = 0;
      let injected = false;
      vi.spyOn(participantDal, "listBookingParticipantIds").mockImplementation(
        async (id, db) => {
          const rows = await original(id, db);
          if (db === database.db) return rows;
          transactionReads++;
          if (transactionReads % 2 === 0 && (exhaust || !injected)) {
            injected = true;
            return [...rows, fixture.stranger.userId];
          }
          return rows;
        },
      );
      const floor = vi.spyOn(bookingDal, "lockFloorForBooking");
      const publish = vi.fn();
      const result = await action(fixture.person, { publisher: { publish } })({
        ...draft(booking),
        title: "재시도",
      });
      expect(floor).toHaveBeenCalledTimes(exhaust ? 3 : 2);
      expect(result).toMatchObject(
        exhaust ? { ok: false, code: "INTERNAL" } : { ok: true },
      );
      expect(publish).toHaveBeenCalledTimes(exhaust ? 0 : 1);
      expect((await read(booking.id)).title).toBe(
        exhaust ? booking.title : "재시도",
      );
      if (exhaust) expect(await read(booking.id)).toEqual(booking);
      expect(await notices(booking.id)).toEqual([]);
    },
  );

  it.each(["no row", "participants", "notifications"] as const)(
    "rolls back %s failures after the conditional write",
    async (kind) => {
      const booking = await withParticipants();
      const input = draft(booking, await participantIds(booking.id));
      const before = await all();
      if (kind === "no row")
        vi.spyOn(updateDal, "updateBookingRecord").mockResolvedValueOnce(null);
      if (kind === "participants")
        vi.spyOn(
          participantDal,
          "insertBookingParticipants",
        ).mockRejectedValueOnce(new Error("private error"));
      if (kind === "notifications")
        vi.spyOn(notificationDal, "insertNotifications").mockRejectedValueOnce(
          new Error("private error"),
        );
      expect(
        await action()({
          ...input,
          title: "롤백",
          participants: [
            { userId: fixture.member.userId, email: fixture.member.email },
          ],
        }),
      ).toMatchObject({
        ok: false,
        code: kind === "no row" ? "NOT_FOUND" : "INTERNAL",
      });
      expect(await all()).toEqual(before);
    },
  );

  it("keeps a committed edit when the post-commit event fails", async () => {
    const booking = await make();
    const publish = vi.fn().mockRejectedValue(new Error("private realtime"));
    expect(
      (
        await action(fixture.person, { publisher: { publish } })({
          ...draft(booking),
          title: "저장됨",
        })
      ).ok,
    ).toBe(true);
    expect((await read(booking.id)).title).toBe("저장됨");
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("locks every affected user once in UUID order with only the personal owner at UPDATE strength before the booking", async () => {
    const booking = await withParticipants();
    const input = draft(booking, await participantIds(booking.id));
    statements.length = 0;
    expect(
      (
        await action()({
          ...input,
          participants: [
            { userId: fixture.stranger.userId },
            { userId: fixture.member.userId, email: fixture.member.email },
          ],
        })
      ).ok,
    ).toBe(true);
    const locks = statements.filter(({ sql }) =>
      /for (update|key share)/u.test(sql),
    );
    const userLocks = locks.filter(({ sql }) => sql.includes('from "users"'));
    const ids = userLocks.map(({ params }) => params[0]);
    expect(ids).toEqual(
      [
        fixture.person.userId,
        fixture.stranger.userId,
        fixture.operator.userId,
        fixture.member.userId,
      ].sort(),
    );
    for (const row of userLocks)
      expect(row.sql).toContain(
        row.params[0] === fixture.person.userId
          ? "for update"
          : "for key share",
      );
    expect(
      locks.findIndex(({ sql }) => sql.includes('from "spaces"')),
    ).toBeLessThan(locks.findIndex(({ sql }) => sql.includes('from "users"')));
    expect(
      locks.findLastIndex(({ sql }) => sql.includes('from "users"')),
    ).toBeLessThan(
      locks.findIndex(({ sql }) => sql.includes('from "bookings"')),
    );
  });

  it("locks a team owner at KEY SHARE and the team at UPDATE before the reservation", async () => {
    const booking = await make({
      userId: fixture.member.userId,
      teamId: fixture.teamId,
    });
    const input = {
      ...draft(booking),
      participants: [{ userId: fixture.admin.userId }],
    };
    statements.length = 0;
    expect((await action(fixture.member)(input)).ok).toBe(true);
    const locks = statements.filter(({ sql }) =>
      /for (update|key share)/u.test(sql),
    );
    const userLocks = locks.filter(({ sql }) => sql.includes('from "users"'));
    expect(userLocks.map(({ params }) => params[0])).toEqual(
      [fixture.member.userId, fixture.admin.userId].sort(),
    );
    expect(userLocks.every(({ sql }) => sql.includes("for key share"))).toBe(
      true,
    );
    const teamIndex = locks.findIndex(({ sql }) =>
      sql.includes('from "teams"'),
    );
    expect(locks[teamIndex]!.sql).toContain("for update");
    expect(locks[teamIndex]!.params[0]).toBe(fixture.teamId);
    expect(
      locks.findLastIndex(({ sql }) => sql.includes('from "users"')),
    ).toBeLessThan(teamIndex);
    expect(teamIndex).toBeLessThan(
      locks.findIndex(({ sql }) => sql.includes('from "bookings"')),
    );
  });

  it("does not reinsert an existing participant missing from the post-UPDATE authoritative list", async () => {
    const booking = await withParticipants();
    const input = draft(booking, await participantIds(booking.id));
    const original = updateDal.updateBookingRecord;
    vi.spyOn(updateDal, "updateBookingRecord").mockImplementationOnce(
      async (input, db) => {
        const row = await original(input, db);
        await db
          .delete(bookingParticipants)
          .where(
            and(
              eq(bookingParticipants.bookingId, input.bookingId),
              eq(bookingParticipants.userId, fixture.stranger.userId),
            ),
          );
        await notificationDal.deleteBookingReminders(
          { bookingId: input.bookingId, userIds: [fixture.stranger.userId] },
          db,
        );
        return row;
      },
    );
    expect(
      (
        await action()({
          ...input,
          start: bookingInstant("14:00"),
          end: bookingInstant("15:00"),
        })
      ).ok,
    ).toBe(true);
    expect(await participantIds(booking.id)).toEqual([fixture.operator.userId]);
    expect(
      (await notices(booking.id)).filter(
        ({ type, userId }) =>
          type === "booking_reminder" && userId === fixture.stranger.userId,
      ),
    ).toEqual([]);
  });

  it("checks the started restriction against a booking changed while waiting for its lock", async () => {
    const booking = await make();
    const original = participantDal.lockParticipantBooking;
    vi.spyOn(participantDal, "lockParticipantBooking").mockImplementationOnce(
      async (id, db) => {
        await db
          .update(bookings)
          .set({ during: bookingRange("12:00", "13:00") })
          .where(eq(bookings.id, id));
        return original(id, db);
      },
    );
    expect(await action()(draft(booking))).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect(await read(booking.id)).toEqual(booking);
  });

  it("validates sessions and strict input before SQL and ignores no immutable fields", async () => {
    const booking = await make();
    statements.length = 0;
    expect(await action(null)({})).toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    for (const input of [
      { ...draft(booking), spaceId: fixture.secondSpaceId },
      { ...draft(booking), userId: fixture.stranger.userId },
      { ...draft(booking), attendeeCount: undefined },
      { ...draft(booking), participantIdsAtLoad: undefined },
      { ...draft(booking), title: "\0" },
    ])
      expect(await action()(input)).toMatchObject({
        ok: false,
        code: "INVALID_INPUT",
      });
    expect(statements).toEqual([]);
  });
});

import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
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
import { createMaintenanceActionFactory } from "@/features/admin/maintenance-action-factory";
import { createBookingActions } from "@/features/bookings/create-booking-factory";
import { createDeskBookingAction } from "@/features/bookings/create-desk-booking-factory";
import { notificationPresentation } from "@/features/notifications/format";
import { parseNotificationContent } from "@/features/notifications/types";
import type { Session } from "@/lib/auth/types";
import * as callEviction from "@/lib/calls/evict";
import * as adminDal from "@/lib/dal/admin";
import * as meetingDal from "@/lib/dal/chat-meeting";
import * as maintenanceDal from "@/lib/dal/maintenance-write";
import * as schema from "@/lib/db/schema";
import type { RealtimePublisher } from "@/lib/realtime/types";
import {
  bookingParticipants,
  bookings,
  chatRooms,
  messages,
  notifications,
  roleSettings,
  spaceBlocks,
  spaces,
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

describe("maintenance actions and transactional booking cancellation", () => {
  let database: TestDatabase;
  let fixture: BookingActors;
  const publish = vi.fn<RealtimePublisher["publish"]>(async () => {});
  const publishMany = vi.fn<RealtimePublisher["publishMany"]>(async () => {});
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    fixture = await seedBookingActors(database);
  });

  const deps = (session: Session = fixture.operator, now = bookingNow) => ({
    database: database.db,
    getSession: async () => session,
    now: () => now,
    publisher: { publish },
    chatPublisher: { publish, publishMany },
    livekit: null,
    logError: vi.fn(),
  });
  const subject = (session = fixture.operator, now = bookingNow) =>
    createMaintenanceActionFactory(deps(session, now));
  const input = (overrides: Record<string, unknown> = {}) => ({
    spaceId: fixture.publicSpaceId,
    start: { kind: "at", at: bookingInstant("13:00") },
    end: bookingInstant("16:00"),
    reason: "모니터 교체",
    expectedBookingIds: [],
    ...overrides,
  });
  async function block(
    start = "13:00",
    end = "16:00",
    spaceId = fixture.publicSpaceId,
  ) {
    const [row] = await database.db
      .insert(spaceBlocks)
      .values({
        spaceId,
        during: bookingRange(start, end),
        reason: "기존 점검",
        createdBy: fixture.operator.userId,
      })
      .returning();
    return row!;
  }
  async function meeting(
    start = "13:00",
    end = "14:00",
    session = fixture.person,
  ) {
    const result = await createBookingActions(deps(session)).createBooking({
      ...bookingInput(fixture),
      start: bookingInstant(start),
      end: bookingInstant(end),
      participants: [
        { userId: fixture.stranger.userId, email: fixture.stranger.email },
      ],
    });
    if (!result.ok) throw new Error(`Fixture booking failed: ${result.code}`);
    return result.data.bookingId;
  }
  const stateError = {
    ok: false,
    code: "INVALID_INPUT",
    message: "maintenance_state",
  };

  it("creates an empty maintenance window without booking.manage_all and emits its target status", async () => {
    await database.db.insert(roleSettings).values({
      branchId: fixture.branchId,
      role: "operator",
      permissions: ["space.manage"],
    });
    const result = await subject().createMaintenance(input());
    expect(result).toEqual({
      ok: true,
      data: { blockId: expect.any(String), cancelledCount: 0 },
    });
    expect(await database.db.select().from(spaceBlocks)).toEqual([
      expect.objectContaining({
        spaceId: fixture.publicSpaceId,
        reason: "모니터 교체",
        createdBy: fixture.operator.userId,
        during: bookingRange("13:00", "16:00"),
      }),
    ]);
    expect(publish).toHaveBeenCalledExactlyOnceWith(
      `floor:${fixture.floorId}`,
      { type: "space.status_changed", spaceId: fixture.publicSpaceId },
    );
    expect(publishMany).not.toHaveBeenCalled();
  });

  it("cancels three bookings with reason, recipients, reminder removal and meeting records in one commit", async () => {
    const ids = [
      await meeting("13:00", "14:00", fixture.person),
      await meeting("14:00", "15:00", fixture.member),
      await meeting("15:00", "16:00", fixture.admin),
    ];
    expect(
      (await database.db.select().from(notifications)).some(
        (row) => row.type === "booking_reminder",
      ),
    ).toBe(true);
    publish.mockClear();
    publishMany.mockClear();
    const result = await subject().createMaintenance(
      input({
        expectedBookingIds: [...ids].reverse(),
        reason: "  냉방기 점검  ",
      }),
    );
    expect(result).toMatchObject({ ok: true, data: { cancelledCount: 3 } });
    const cancelled = await database.db
      .select()
      .from(bookings)
      .where(inArray(bookings.id, ids));
    expect(cancelled).toHaveLength(3);
    for (const row of cancelled)
      expect(row).toMatchObject({
        status: "cancelled",
        cancelKind: "maintenance",
        cancelReason: "냉방기 점검",
        cancelledBy: fixture.operator.userId,
        cancelledAt: bookingNow,
      });
    const notices = await database.db.select().from(notifications);
    expect(notices.some((row) => row.type === "booking_reminder")).toBe(false);
    const cancellationNotices = notices.filter(
      (row) => row.type === "booking_cancelled",
    );
    expect(cancellationNotices).toHaveLength(6);
    for (const row of cancelled) {
      expect(
        cancellationNotices
          .filter((notice) => notice.bookingId === row.id)
          .map((notice) => notice.userId)
          .sort(),
      ).toEqual([row.userId, fixture.stranger.userId].sort());
    }
    for (const notice of cancellationNotices) {
      expect(notice.data).toMatchObject({
        cancelKind: "maintenance",
        cancelReason: "냉방기 점검",
      });
      const content = parseNotificationContent(
        notice.type,
        notice.data,
        notice.bookingId,
      );
      expect(content).not.toBeNull();
      const text = notificationPresentation(content!);
      expect(text.text).toBe("점검으로 회의실 B 예약이 취소됐어요");
      expect(text.dateTime).toMatch(/^냉방기 점검 · /);
    }
    const history = await database.db.select().from(messages);
    expect(
      history.filter((row) => row.systemData?.type === "booking_cancelled"),
    ).toHaveLength(3);
    for (const row of history.filter(
      (row) => row.systemData?.type === "booking_cancelled",
    ))
      expect(row.systemData).toMatchObject({
        type: "booking_cancelled",
        cancelKind: "maintenance",
        reason: "냉방기 점검",
        actorName: fixture.operator.name,
      });
    expect(
      publish.mock.calls.filter(
        ([, event]) => event.type === "booking.changed",
      ),
    ).toEqual([
      [
        `floor:${fixture.floorId}`,
        { type: "booking.changed", spaceId: fixture.publicSpaceId },
      ],
    ]);
    expect(publish).toHaveBeenCalledWith(`floor:${fixture.floorId}`, {
      type: "space.status_changed",
      spaceId: fixture.publicSpaceId,
    });
    expect(publishMany).toHaveBeenCalled();
  });

  it("reports STALE after a preview omitted a newly committed overlapping booking, with no writes", async () => {
    const id = await meeting();
    const beforeNotices = await database.db.select().from(notifications);
    const beforeMessages = await database.db.select().from(messages);
    publish.mockClear();
    publishMany.mockClear();
    expect(await subject().createMaintenance(input())).toEqual({
      ok: false,
      code: "STALE",
    });
    expect(await database.db.select().from(spaceBlocks)).toEqual([]);
    expect(
      (await database.db.select().from(bookings).where(eq(bookings.id, id)))[0]
        ?.status,
    ).toBe("confirmed");
    expect(await database.db.select().from(notifications)).toEqual(
      beforeNotices,
    );
    expect(await database.db.select().from(messages)).toEqual(beforeMessages);
    expect(publish).not.toHaveBeenCalled();
    expect(publishMany).not.toHaveBeenCalled();
  });

  it("reports STALE when the expected booking no longer overlaps, not just when the count changes", async () => {
    const actual = await insertFixtureBooking(database, fixture, {
      during: bookingRange("13:00", "14:00"),
    });
    const outside = await insertFixtureBooking(database, fixture, {
      during: bookingRange("17:00", "18:00"),
    });
    expect(
      await subject().createMaintenance(
        input({ expectedBookingIds: [outside.id] }),
      ),
    ).toEqual({ ok: false, code: "STALE" });
    expect(await database.db.select().from(spaceBlocks)).toEqual([]);
    expect(
      (
        await database.db
          .select()
          .from(bookings)
          .where(eq(bookings.id, actual.id))
      )[0]?.status,
    ).toBe("confirmed");
  });

  it("does not cancel touching, already cancelled, ended or other-space reservations", async () => {
    const ignored = [
      await insertFixtureBooking(database, fixture, {
        during: bookingRange("12:00", "13:00"),
      }),
      await insertFixtureBooking(database, fixture, {
        during: bookingRange("16:00", "17:00"),
      }),
      await insertFixtureBooking(database, fixture, {
        during: bookingRange("09:00", "10:00"),
      }),
      await insertFixtureBooking(database, fixture, {
        during: bookingRange("13:00", "14:00"),
        status: "cancelled",
        cancelledAt: bookingNow,
      }),
      await insertFixtureBooking(database, fixture, {
        spaceId: fixture.secondSpaceId,
        during: bookingRange("13:00", "14:00"),
      }),
    ];
    expect(await subject().createMaintenance(input())).toMatchObject({
      ok: true,
      data: { cancelledCount: 0 },
    });
    expect(
      await database.db.select().from(bookings).orderBy(bookings.id),
    ).toEqual([...ignored].sort((a, b) => a.id.localeCompare(b.id)));
  });

  it("includes both child desks for an area and publishes their parent booking change once", async () => {
    const ids = await Promise.all(
      [fixture.deskId, fixture.otherDeskId].map((spaceId) =>
        insertFixtureBooking(database, fixture, {
          spaceId,
          during: bookingRange("13:00", "22:00"),
        }),
      ),
    );
    expect(
      await subject().createMaintenance(
        input({
          spaceId: fixture.deskAreaId,
          expectedBookingIds: ids.map((row) => row.id),
        }),
      ),
    ).toMatchObject({ ok: true, data: { cancelledCount: 2 } });
    expect(
      (await database.db.select().from(bookings)).every(
        (row) => row.status === "cancelled",
      ),
    ).toBe(true);
    expect(await database.db.select().from(chatRooms)).toHaveLength(0);
    expect(
      (await database.db.select().from(notifications)).map((row) => row.data),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          spaceName: "데스크 구역 좌석 1",
          cancelKind: "maintenance",
        }),
        expect.objectContaining({
          spaceName: "데스크 구역 좌석 2",
          cancelKind: "maintenance",
        }),
      ]),
    );
    expect(
      publish.mock.calls.filter(
        ([, event]) => event.type === "booking.changed",
      ),
    ).toEqual([
      [
        `floor:${fixture.floorId}`,
        { type: "booking.changed", spaceId: fixture.deskAreaId },
      ],
    ]);
  });

  it("accepts direct desk maintenance but does not cancel another desk's reservation", async () => {
    const first = await insertFixtureBooking(database, fixture, {
      spaceId: fixture.deskId,
      during: bookingRange("13:00", "22:00"),
    });
    const other = await insertFixtureBooking(database, fixture, {
      spaceId: fixture.otherDeskId,
      during: bookingRange("13:00", "22:00"),
    });
    expect(
      await subject().createMaintenance(
        input({ spaceId: fixture.deskId, expectedBookingIds: [first.id] }),
      ),
    ).toMatchObject({ ok: true, data: { cancelledCount: 1 } });
    expect(
      (
        await database.db
          .select()
          .from(bookings)
          .where(eq(bookings.id, other.id))
      )[0]?.status,
    ).toBe("confirmed");
    expect(publish).toHaveBeenCalledWith(`floor:${fixture.floorId}`, {
      type: "space.status_changed",
      spaceId: fixture.deskId,
    });
  });

  it("blocks a later room booking after maintenance commits", async () => {
    expect((await subject().createMaintenance(input())).ok).toBe(true);
    expect(
      await createBookingActions(deps(fixture.person)).createBooking({
        ...bookingInput(fixture),
        start: bookingInstant("13:00"),
        end: bookingInstant("14:00"),
      }),
    ).toEqual({ ok: false, code: "SPACE_BLOCKED" });
    expect(await database.db.select().from(bookings)).toEqual([]);
  });

  it.each(["area", "seat"] as const)(
    "blocks a later desk booking after %s maintenance commits",
    async (scope) => {
      expect(
        (
          await subject().createMaintenance(
            input({
              spaceId: scope === "area" ? fixture.deskAreaId : fixture.deskId,
            }),
          )
        ).ok,
      ).toBe(true);
      expect(
        await createDeskBookingAction(deps(fixture.person))({
          deskId: fixture.deskId,
          date: bookingDate,
          part: "pm",
          teamId: null,
        }),
      ).toEqual({ ok: false, code: "SPACE_BLOCKED" });
    },
  );

  it("maps the actual same-space exclusion failure to start INVALID_INPUT and rolls back cancellation", async () => {
    await block("14:00", "15:00");
    const bookingId = await meeting("13:00", "14:00");
    const notices = await database.db.select().from(notifications);
    publish.mockClear();
    publishMany.mockClear();
    expect(
      await subject().createMaintenance(
        input({ expectedBookingIds: [bookingId] }),
      ),
    ).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      fieldErrors: { start: expect.any(Array) },
    });
    expect(await database.db.select().from(spaceBlocks)).toHaveLength(1);
    expect((await database.db.select().from(bookings))[0]?.status).toBe(
      "confirmed",
    );
    expect(await database.db.select().from(notifications)).toEqual(notices);
    expect(publish).not.toHaveBeenCalled();
    expect(publishMany).not.toHaveBeenCalled();
  });

  it("permits touching maintenance and same-time maintenance in another space", async () => {
    await block("12:00", "13:00");
    expect((await subject().createMaintenance(input())).ok).toBe(true);
    expect(
      (
        await subject().createMaintenance(
          input({ spaceId: fixture.secondSpaceId }),
        )
      ).ok,
    ).toBe(true);
    expect(await database.db.select().from(spaceBlocks)).toHaveLength(3);
  });

  it("updates only the future block, cancels newly overlapping bookings and never restores earlier cancellations", async () => {
    const prior = await insertFixtureBooking(database, fixture, {
      during: bookingRange("13:00", "14:00"),
    });
    const created = await subject().createMaintenance(
      input({ end: bookingInstant("14:00"), expectedBookingIds: [prior.id] }),
    );
    if (!created.ok) throw new Error(created.code);
    const next = await insertFixtureBooking(database, fixture, {
      during: bookingRange("15:00", "16:00"),
    });
    publish.mockClear();
    publishMany.mockClear();
    expect(
      await subject().updateMaintenance({
        blockId: created.data.blockId,
        start: { kind: "at", at: bookingInstant("15:00") },
        end: bookingInstant("17:00"),
        reason: "후속 점검",
        expectedBookingIds: [next.id],
      }),
    ).toEqual({
      ok: true,
      data: { blockId: created.data.blockId, cancelledCount: 1 },
    });
    expect(
      (await database.db.select().from(bookings)).every(
        (row) => row.status === "cancelled",
      ),
    ).toBe(true);
    expect(
      (
        await database.db
          .select()
          .from(bookings)
          .where(eq(bookings.id, prior.id))
      )[0]?.cancelReason,
    ).toBe("모니터 교체");
    expect((await database.db.select().from(spaceBlocks))[0]).toMatchObject({
      spaceId: fixture.publicSpaceId,
      reason: "후속 점검",
      during: bookingRange("15:00", "17:00"),
    });
    expect(publish).toHaveBeenCalledWith(`floor:${fixture.floorId}`, {
      type: "space.status_changed",
      spaceId: fixture.publicSpaceId,
    });
  });

  it("preserves the previous maintenance when an update's expected booking set is stale", async () => {
    const existing = await block();
    const booking = await insertFixtureBooking(database, fixture, {
      during: bookingRange("17:00", "18:00"),
    });
    expect(
      await subject().updateMaintenance({
        blockId: existing.id,
        start: { kind: "at", at: bookingInstant("17:00") },
        end: bookingInstant("18:00"),
        reason: "변경",
        expectedBookingIds: [],
      }),
    ).toEqual({ ok: false, code: "STALE" });
    expect(await database.db.select().from(spaceBlocks)).toEqual([existing]);
    expect(
      (
        await database.db
          .select()
          .from(bookings)
          .where(eq(bookings.id, booking.id))
      )[0]?.status,
    ).toBe("confirmed");
  });

  it("rolls an overlapping update back to the unchanged original block", async () => {
    const existing = await block("13:00", "14:00");
    await block("15:00", "16:00");
    expect(
      await subject().updateMaintenance({
        blockId: existing.id,
        start: { kind: "at", at: bookingInstant("14:00") },
        end: bookingInstant("16:00"),
        reason: "변경",
        expectedBookingIds: [],
      }),
    ).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      fieldErrors: { start: expect.any(Array) },
    });
    expect(
      (
        await database.db
          .select()
          .from(spaceBlocks)
          .where(eq(spaceBlocks.id, existing.id))
      )[0],
    ).toEqual(existing);
  });

  it("floors now to a minute and releases the following 30-minute booking slot without restoring cancelled bookings", async () => {
    const now = new Date("2026-10-07T03:10:49.999Z");
    const cancelled = await insertFixtureBooking(database, fixture, {
      during: bookingRange("12:00", "13:00"),
    });
    const created = await subject(fixture.operator, now).createMaintenance(
      input({ start: { kind: "now" }, expectedBookingIds: [cancelled.id] }),
    );
    if (!created.ok) throw new Error(created.code);
    expect(
      (await database.db.select().from(spaceBlocks))[0]?.during.start,
    ).toEqual(bookingNow);
    const endNow = new Date("2026-10-07T03:11:59.999Z");
    publish.mockClear();
    expect(
      await subject(fixture.operator, endNow).endMaintenance({
        blockId: created.data.blockId,
      }),
    ).toEqual({ ok: true, data: { blockId: created.data.blockId } });
    expect(
      (await database.db.select().from(spaceBlocks))[0]?.during.end,
    ).toEqual(new Date("2026-10-07T03:11:00Z"));
    const book = createBookingActions(
      deps(fixture.person, endNow),
    ).createBooking;
    expect(
      await book({
        ...bookingInput(fixture),
        start: bookingInstant("12:00"),
        end: bookingInstant("12:30"),
      }),
    ).toEqual({ ok: false, code: "SPACE_BLOCKED" });
    expect(
      (
        await book({
          ...bookingInput(fixture),
          start: bookingInstant("12:30"),
          end: bookingInstant("13:00"),
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await database.db
          .select()
          .from(bookings)
          .where(eq(bookings.id, cancelled.id))
      )[0]?.status,
    ).toBe("cancelled");
    expect(publish).toHaveBeenCalledWith(`floor:${fixture.floorId}`, {
      type: "space.status_changed",
      spaceId: fixture.publicSpaceId,
    });
  });

  it("deletes a just-started block when minute flooring would make an empty interval", async () => {
    const row = await block("12:10", "13:00");
    expect(
      await subject(
        fixture.operator,
        new Date("2026-10-07T03:10:15Z"),
      ).endMaintenance({ blockId: row.id }),
    ).toEqual({ ok: true, data: { blockId: row.id } });
    expect(await database.db.select().from(spaceBlocks)).toEqual([]);
  });

  it("deletes only an upcoming block and emits its status change once", async () => {
    const row = await block();
    expect(await subject().deleteMaintenance({ blockId: row.id })).toEqual({
      ok: true,
      data: { blockId: row.id },
    });
    expect(await database.db.select().from(spaceBlocks)).toEqual([]);
    expect(publish).toHaveBeenCalledExactlyOnceWith(
      `floor:${fixture.floorId}`,
      { type: "space.status_changed", spaceId: fixture.publicSpaceId },
    );
    expect(await subject().deleteMaintenance({ blockId: row.id })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
  });

  it.each([
    ["update", "12:00", "13:00"],
    ["update", "09:00", "10:00"],
    ["delete", "12:00", "13:00"],
    ["delete", "09:00", "10:00"],
    ["end", "13:00", "14:00"],
    ["end", "09:00", "10:00"],
  ] as const)(
    "rejects %s for a block from %s to %s without effects",
    async (operation, start, end) => {
      const row = await block(start, end);
      const action = subject();
      const result =
        operation === "update"
          ? await action.updateMaintenance({
              blockId: row.id,
              start: { kind: "at", at: bookingInstant("14:00") },
              end: bookingInstant("15:00"),
              reason: "변경",
              expectedBookingIds: [],
            })
          : operation === "delete"
            ? await action.deleteMaintenance({ blockId: row.id })
            : await action.endMaintenance({ blockId: row.id });
      expect(result).toEqual(stateError);
      expect(await database.db.select().from(spaceBlocks)).toEqual([row]);
      expect(publish).not.toHaveBeenCalled();
    },
  );

  it("checks session before invalid input and rejects extra mutation authority fields", async () => {
    const action = createMaintenanceActionFactory({
      ...deps(),
      getSession: async () => null,
    });
    for (const method of [
      action.createMaintenance,
      action.updateMaintenance,
      action.endMaintenance,
      action.deleteMaintenance,
    ])
      expect(await method({ wrong: true })).toEqual({
        ok: false,
        code: "UNAUTHENTICATED",
      });
    expect(
      await subject().createMaintenance(
        input({ userId: fixture.person.userId }),
      ),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(
      await subject().createMaintenance(
        input({ expectedBookingIds: [randomUUID(), "invalid"] }),
      ),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await database.db.select().from(spaceBlocks)).toEqual([]);
  });

  it("conceals foreign spaces and block IDs and rejects disabled space.manage", async () => {
    const foreign = await block("13:00", "14:00", fixture.otherSpaceId);
    expect(
      await subject().createMaintenance(
        input({ spaceId: fixture.otherSpaceId }),
      ),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    for (const session of [fixture.person, fixture.otherOperator])
      expect(await subject(session).createMaintenance(input())).toEqual({
        ok: false,
        code: "NOT_FOUND",
      });
    expect(await subject().deleteMaintenance({ blockId: foreign.id })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await subject().endMaintenance({ blockId: foreign.id })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(
      await subject().updateMaintenance({
        blockId: foreign.id,
        start: { kind: "at", at: bookingInstant("15:00") },
        end: bookingInstant("16:00"),
        reason: "변경",
        expectedBookingIds: [],
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    await database.db.insert(roleSettings).values({
      branchId: fixture.branchId,
      role: "operator",
      permissions: ["booking.manage_all"],
    });
    const own = await block();
    expect(await subject().createMaintenance(input())).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(await subject().deleteMaintenance({ blockId: own.id })).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(await subject().endMaintenance({ blockId: own.id })).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(
      await subject().updateMaintenance({
        blockId: own.id,
        start: { kind: "at", at: bookingInstant("15:00") },
        end: bookingInstant("16:00"),
        reason: "변경",
        expectedBookingIds: [],
      }),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("rejects lounges and archived targets without writing maintenance", async () => {
    await database.db
      .update(spaces)
      .set({ archivedAt: null })
      .where(eq(spaces.id, fixture.archivedSpaceId));
    expect(
      await subject().createMaintenance(
        input({ spaceId: fixture.archivedSpaceId }),
      ),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    await database.db
      .update(spaces)
      .set({ archivedAt: bookingNow })
      .where(eq(spaces.id, fixture.publicSpaceId));
    expect(await subject().createMaintenance(input())).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    await database.db
      .update(spaces)
      .set({ archivedAt: bookingNow })
      .where(eq(spaces.id, fixture.deskAreaId));
    expect(
      await subject().createMaintenance(input({ spaceId: fixture.deskId })),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await database.db.select().from(spaceBlocks)).toEqual([]);
  });

  it.each([
    { start: { kind: "at", at: bookingInstant("12:00") } },
    { start: { kind: "at", at: bookingInstant("13:10") } },
    { end: bookingInstant("16:15") },
    { end: bookingInstant("12:30") },
    { end: bookingInstant("16:00", "2026-11-07") },
    { reason: " " },
    { reason: "가".repeat(101) },
    { reason: "점검\0" },
  ])(
    "rejects invalid maintenance windows or reasons: %j",
    async (overrides) => {
      expect(await subject().createMaintenance(input(overrides))).toMatchObject(
        { ok: false, code: "INVALID_INPUT" },
      );
      expect(await database.db.select().from(spaceBlocks)).toEqual([]);
      expect(publish).not.toHaveBeenCalled();
    },
  );

  it("allows maintenance outside operating hours and an aligned explicit current time", async () => {
    expect(
      (
        await subject().createMaintenance(
          input({
            start: { kind: "at", at: bookingInstant("23:00") },
            end: bookingInstant("00:30", "2026-10-08"),
          }),
        )
      ).ok,
    ).toBe(true);
    const now = new Date(bookingInstant("13:00"));
    expect(
      await subject(fixture.operator, now).createMaintenance(input()),
    ).toMatchObject({ ok: true, data: { cancelledCount: 0 } });
  });

  it("rechecks current space.manage after waiting for the target space lock", async () => {
    const original = adminDal.lockAdminSpace;
    vi.spyOn(adminDal, "lockAdminSpace").mockImplementationOnce(
      async (id, tx) => {
        if (!tx) throw new Error("Expected the maintenance transaction.");
        const row = await original(id, tx);
        await tx.insert(roleSettings).values({
          branchId: fixture.branchId,
          role: "operator",
          permissions: [],
        });
        return row;
      },
    );
    expect(await subject().createMaintenance(input())).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(await database.db.select().from(spaceBlocks)).toEqual([]);
  });

  it("rolls all cancellations, reminders, notifications, rooms and the block back when a later meeting write fails", async () => {
    const ids = [
      await meeting("13:00", "14:00"),
      await meeting("14:00", "15:00", fixture.member),
    ];
    const before = {
      bookings: await database.db.select().from(bookings).orderBy(bookings.id),
      notices: await database.db
        .select()
        .from(notifications)
        .orderBy(notifications.id),
      messages: await database.db.select().from(messages).orderBy(messages.id),
      rooms: await database.db.select().from(chatRooms).orderBy(chatRooms.id),
    };
    const original = meetingDal.recordMeetingMessages;
    let calls = 0;
    vi.spyOn(meetingDal, "recordMeetingMessages").mockImplementation(
      async (...args) => {
        calls += 1;
        if (calls === 2) throw new Error("private database failure");
        return original(...args);
      },
    );
    publish.mockClear();
    publishMany.mockClear();
    expect(
      await subject().createMaintenance(input({ expectedBookingIds: ids })),
    ).toEqual({ ok: false, code: "INTERNAL" });
    expect(calls).toBe(2);
    expect(await database.db.select().from(spaceBlocks)).toEqual([]);
    expect(
      await database.db.select().from(bookings).orderBy(bookings.id),
    ).toEqual(before.bookings);
    expect(
      await database.db.select().from(notifications).orderBy(notifications.id),
    ).toEqual(before.notices);
    expect(
      await database.db.select().from(messages).orderBy(messages.id),
    ).toEqual(before.messages);
    expect(
      await database.db.select().from(chatRooms).orderBy(chatRooms.id),
    ).toEqual(before.rooms);
    expect(publish).not.toHaveBeenCalled();
    expect(publishMany).not.toHaveBeenCalled();
  });

  it("keeps committed work successful when publication and its logger both fail", async () => {
    const bookingId = await meeting();
    const failedPublish = vi.fn(async () => {
      throw new Error("publisher");
    });
    const failedChat = vi.fn(async () => {
      throw new Error("chat publisher");
    });
    const action = createMaintenanceActionFactory({
      ...deps(),
      publisher: { publish: failedPublish },
      chatPublisher: { publish, publishMany: failedChat },
      logError: () => {
        throw new Error("logger");
      },
    });
    expect(
      await action.createMaintenance(
        input({ expectedBookingIds: [bookingId] }),
      ),
    ).toMatchObject({ ok: true, data: { cancelledCount: 1 } });
    expect((await database.db.select().from(bookings))[0]?.status).toBe(
      "cancelled",
    );
    expect(await database.db.select().from(spaceBlocks)).toHaveLength(1);
    expect(failedPublish).toHaveBeenCalled();
    expect(failedChat).toHaveBeenCalled();
  });

  it("locks floor, space, UUID-sorted users and every booking before any meeting room", async () => {
    const ids = [
      await meeting("13:00", "14:00"),
      await meeting("14:00", "15:00", fixture.member),
    ];
    const statements: { query: string; params: unknown[] }[] = [];
    const logged = drizzle({
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
        await createMaintenanceActionFactory({
          ...deps(),
          database: logged,
        }).createMaintenance(input({ expectedBookingIds: ids }))
      ).ok,
    ).toBe(true);
    const index = (pattern: RegExp) =>
      statements.findIndex(({ query }) => pattern.test(query));
    const floorLock = index(/from "floors".*for share/);
    const spaceLock = index(/from "spaces".*for update/);
    const userLocks = statements.filter(({ query }) =>
      /from "users".*for key share/.test(query),
    );
    const bookingLock = index(/from "bookings".*for update/);
    const roomLock = index(/from "chat_rooms".*for update/);
    expect(floorLock).toBeGreaterThanOrEqual(0);
    expect(spaceLock).toBeGreaterThan(floorLock);
    expect(index(/from "users".*for key share/)).toBeGreaterThan(spaceLock);
    expect(userLocks.map(({ params }) => params[0])).toEqual(
      [
        fixture.operator.userId,
        fixture.person.userId,
        fixture.member.userId,
        fixture.stranger.userId,
      ].sort(),
    );
    expect(bookingLock).toBeGreaterThan(
      statements.findLastIndex(({ query }) =>
        /from "users".*for key share/.test(query),
      ),
    );
    expect(statements[bookingLock]?.query).toMatch(
      /order by "bookings"\."id" asc for update/,
    );
    expect(statements[bookingLock]?.params).toEqual([...ids].sort());
    expect(roomLock).toBeGreaterThan(
      statements.findLastIndex(({ query }) =>
        /from "bookings".*for update/.test(query),
      ),
    );
    for (const statement of statements.filter(({ query }) =>
      query.startsWith('update "bookings"'),
    )) {
      expect(statement.query).toMatch(
        /"bookings"\."status" = .*upper\("bookings"\."during"\) > .*returning/,
      );
      expect(statement.params).toContain("confirmed");
    }
  });

  it("retries a freshly expanded participant lock set before cancellation without acquiring users after bookings", async () => {
    const bookingId = await meeting();
    const original = maintenanceDal.listMaintenanceParticipants;
    let reads = 0;
    vi.spyOn(maintenanceDal, "listMaintenanceParticipants").mockImplementation(
      async (...args) => {
        const rows = await original(...args);
        reads += 1;
        return reads === 1
          ? rows
          : [...rows, { bookingId, userId: fixture.otherMember.userId }];
      },
    );
    expect(
      await subject().createMaintenance(
        input({ expectedBookingIds: [bookingId] }),
      ),
    ).toMatchObject({ ok: true, data: { cancelledCount: 1 } });
    expect(reads).toBe(4);
    expect(await database.db.select().from(spaceBlocks)).toHaveLength(1);
    expect(
      (await database.db.select().from(notifications))
        .filter((row) => row.type === "booking_cancelled")
        .map((row) => row.userId)
        .sort(),
    ).toEqual(
      [
        fixture.person.userId,
        fixture.stranger.userId,
        fixture.otherMember.userId,
      ].sort(),
    );
    expect(
      (await database.db.select().from(messages)).filter(
        (row) => row.systemData?.type === "booking_cancelled",
      ),
    ).toHaveLength(1);
    expect(await database.db.select().from(bookingParticipants)).toHaveLength(
      1,
    );
  });

  it("stops after three changing participant snapshots with no partial writes or publication", async () => {
    const bookingId = await meeting();
    const before = await database.db
      .select()
      .from(notifications)
      .orderBy(notifications.id);
    const original = maintenanceDal.listMaintenanceParticipants;
    let reads = 0;
    vi.spyOn(maintenanceDal, "listMaintenanceParticipants").mockImplementation(
      async (...args) => {
        const rows = await original(...args);
        reads += 1;
        return reads % 2 === 1
          ? rows
          : [...rows, { bookingId, userId: fixture.otherMember.userId }];
      },
    );
    publish.mockClear();
    publishMany.mockClear();
    expect(
      await subject().createMaintenance(
        input({ expectedBookingIds: [bookingId] }),
      ),
    ).toEqual({ ok: false, code: "INTERNAL" });
    expect(reads).toBe(6);
    expect(await database.db.select().from(spaceBlocks)).toEqual([]);
    expect((await database.db.select().from(bookings))[0]?.status).toBe(
      "confirmed",
    );
    expect(
      await database.db.select().from(notifications).orderBy(notifications.id),
    ).toEqual(before);
    expect(publish).not.toHaveBeenCalled();
    expect(publishMany).not.toHaveBeenCalled();
  });

  it("rechecks authorization after waiting for users and bookings, not only after the space lock", async () => {
    const bookingId = await meeting();
    const original = maintenanceDal.lockMaintenanceBookings;
    vi.spyOn(maintenanceDal, "lockMaintenanceBookings").mockImplementationOnce(
      async (ids, tx) => {
        await original(ids, tx);
        await tx.insert(roleSettings).values({
          branchId: fixture.branchId,
          role: "operator",
          permissions: [],
        });
      },
    );
    publish.mockClear();
    publishMany.mockClear();
    expect(
      await subject().createMaintenance(
        input({ expectedBookingIds: [bookingId] }),
      ),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(await database.db.select().from(spaceBlocks)).toEqual([]);
    expect((await database.db.select().from(bookings))[0]?.status).toBe(
      "confirmed",
    );
    expect(publish).not.toHaveBeenCalled();
    expect(publishMany).not.toHaveBeenCalled();
  });

  it("rejects an update that is no longer upcoming after waiting for booking locks", async () => {
    const existing = await block();
    const now = vi
      .fn<() => Date>()
      .mockReturnValueOnce(bookingNow)
      .mockReturnValue(new Date(bookingInstant("13:00")));
    const action = createMaintenanceActionFactory({ ...deps(), now });
    expect(
      await action.updateMaintenance({
        blockId: existing.id,
        start: { kind: "at", at: bookingInstant("14:00") },
        end: bookingInstant("15:00"),
        reason: "변경",
        expectedBookingIds: [],
      }),
    ).toEqual(stateError);
    expect(await database.db.select().from(spaceBlocks)).toEqual([existing]);
    expect(publish).not.toHaveBeenCalled();
  });

  it("does not expose missing targets and does not change an update target through an extra spaceId", async () => {
    const absent = randomUUID();
    expect(
      await subject().createMaintenance(input({ spaceId: absent })),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await subject().endMaintenance({ blockId: absent })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await subject().deleteMaintenance({ blockId: absent })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    const update = {
      blockId: absent,
      start: { kind: "at", at: bookingInstant("14:00") },
      end: bookingInstant("15:00"),
      reason: "변경",
      expectedBookingIds: [],
    };
    expect(await subject().updateMaintenance(update)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    const row = await block();
    expect(
      await subject().updateMaintenance({
        ...update,
        blockId: row.id,
        spaceId: fixture.secondSpaceId,
      }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await database.db.select().from(spaceBlocks)).toEqual([row]);
  });

  it("evicts calls only after commit and continues other effects when eviction fails", async () => {
    const bookingId = await meeting();
    const observed: { status: string | undefined; blocks: number }[] = [];
    const eviction = vi
      .spyOn(callEviction, "evictCalls")
      .mockImplementation(async () => {
        const [row] = await database.db
          .select()
          .from(bookings)
          .where(eq(bookings.id, bookingId));
        const blocks = await database.db.select().from(spaceBlocks);
        observed.push({ status: row?.status, blocks: blocks.length });
        throw new Error("call provider failure");
      });
    publish.mockClear();
    publishMany.mockClear();
    expect(
      await subject().createMaintenance(
        input({ expectedBookingIds: [bookingId] }),
      ),
    ).toMatchObject({ ok: true, data: { cancelledCount: 1 } });
    expect(eviction.mock.calls.map(([userId]) => userId).sort()).toEqual(
      [fixture.person.userId, fixture.stranger.userId].sort(),
    );
    await Promise.allSettled(eviction.mock.results.map(({ value }) => value));
    expect(observed).toEqual([
      { status: "cancelled", blocks: 1 },
      { status: "cancelled", blocks: 1 },
    ]);
    expect(publish).toHaveBeenCalledWith(`floor:${fixture.floorId}`, {
      type: "booking.changed",
      spaceId: fixture.publicSpaceId,
    });
    expect(publish).toHaveBeenCalledWith(`floor:${fixture.floorId}`, {
      type: "space.status_changed",
      spaceId: fixture.publicSpaceId,
    });
    expect(publishMany).toHaveBeenCalled();
  });

  it("uses conditional end and delete statements after the same floor-to-space locks", async () => {
    const current = await block("12:00", "13:00");
    const upcoming = await block("14:00", "15:00");
    const statements: { query: string; params: unknown[] }[] = [];
    const logged = drizzle({
      client: database.client,
      schema,
      logger: {
        logQuery(query, params) {
          statements.push({ query, params });
        },
      },
    });
    const action = createMaintenanceActionFactory({
      ...deps(),
      database: logged,
    });
    expect((await action.endMaintenance({ blockId: current.id })).ok).toBe(
      true,
    );
    const endWrite = statements.find(({ query }) =>
      query.startsWith('update "space_blocks"'),
    );
    expect(endWrite?.query).toMatch(
      /lower\("space_blocks"\."during"\) <= .*upper\("space_blocks"\."during"\) > .*returning/,
    );
    expect(endWrite?.params).toContain(bookingNow.toISOString());
    expect(
      statements.findIndex(({ query }) =>
        /from "spaces".*for update/.test(query),
      ),
    ).toBeGreaterThan(
      statements.findIndex(({ query }) =>
        /from "floors".*for share/.test(query),
      ),
    );
    statements.length = 0;
    expect((await action.deleteMaintenance({ blockId: upcoming.id })).ok).toBe(
      true,
    );
    const deleteWrite = statements.find(({ query }) =>
      query.startsWith('delete from "space_blocks"'),
    );
    expect(deleteWrite?.query).toMatch(
      /lower\("space_blocks"\."during"\) > .*returning/,
    );
    expect(deleteWrite?.params).toContain(bookingNow.toISOString());
    expect(
      statements.findIndex(({ query }) =>
        /from "spaces".*for update/.test(query),
      ),
    ).toBeGreaterThan(
      statements.findIndex(({ query }) =>
        /from "floors".*for share/.test(query),
      ),
    );
  });
});

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
import { createNotificationActions } from "@/features/notifications/action-factory";
import { createNotificationQueries } from "@/features/notifications/query-factory";
import { notifications } from "@/lib/db/schema";
import { ActionError } from "@/lib/actions/result";
import {
  bookingNow,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

describe("notification visibility, read isolation and query budgets", () => {
  let database: TestDatabase;
  let actors: BookingActors;
  let bookingId: string;
  let now: Date;
  const at = (minutes: number) =>
    new Date(bookingNow.getTime() + minutes * 60_000);
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    actors = await seedBookingActors(database);
    bookingId = (await insertFixtureBooking(database, actors)).id;
    now = bookingNow;
  });
  const queries = () =>
    createNotificationQueries({
      database: database.db,
      requireSession: async () => actors.person,
      now: () => now,
    });
  const actions = () =>
    createNotificationActions({
      database: database.db,
      getSession: async () => actors.person,
      now: () => now,
    });
  async function add(
    overrides: Partial<typeof notifications.$inferInsert> = {},
  ) {
    const [row] = await database.db
      .insert(notifications)
      .values({
        userId: actors.person.userId,
        bookingId,
        type: "booking_reminder",
        scheduledFor: at(-30),
        expiresAt: at(60),
        data: {
          spaceName: "회의실",
          floorName: "7F",
          branchName: "강남점",
          timezone: "Asia/Seoul",
          start: at(0).toISOString(),
          end: at(60).toISOString(),
          minutesBefore: 30,
        },
        ...overrides,
      })
      .returning();
    if (!row) throw new Error("Expected notification fixture.");
    return row;
  }
  async function reminders() {
    const early = await add();
    const later = await add({
      scheduledFor: at(-10),
      data: { ...early.data, minutesBefore: 10 },
    });
    const future = await add({
      scheduledFor: at(5),
      data: { ...early.data, minutesBefore: 0 },
    });
    return { early, later, future };
  }
  it("exposes only the latest currently visible reminder, never future payloads", async () => {
    const { early, later, future } = await reminders();
    now = at(-20);
    expect(await queries().getNotificationSummary()).toMatchObject({
      unreadCount: 1,
      nextAt: later.scheduledFor.toISOString(),
      items: [{ id: early.id }],
    });
    now = at(-10);
    const result = await queries().getNotificationSummary();
    expect(result.items.map((item) => item.id)).toEqual([later.id]);
    expect(result.unreadCount).toBe(1);
    expect(result.nextAt).toBe(future.scheduledFor.toISOString());
    expect(JSON.stringify(result.items)).not.toContain(future.id);
  });
  it("reading an old stage does not pre-read a future stage", async () => {
    const { early, later } = await reminders();
    now = at(-20);
    expect(
      await actions().markNotificationRead({ notificationId: early.id }),
    ).toEqual({ ok: true, data: {} });
    expect((await queries().getNotificationSummary()).unreadCount).toBe(0);
    now = at(-10);
    expect(await queries().getNotificationSummary()).toMatchObject({
      unreadCount: 1,
      items: [{ id: later.id, read: false }],
    });
  });
  it("reading a reminder marks all its public stages, not future ones", async () => {
    const { early, later, future } = await reminders();
    await actions().markNotificationRead({ notificationId: later.id });
    const rows = await database.db.select().from(notifications);
    expect(rows.find((row) => row.id === early.id)?.readAt).toEqual(now);
    expect(rows.find((row) => row.id === later.id)?.readAt).toEqual(now);
    expect(rows.find((row) => row.id === future.id)?.readAt).toBeNull();
  });
  it("a future target ID cannot be used to mark earlier stages", async () => {
    const { future } = await reminders();
    await actions().markNotificationRead({ notificationId: future.id });
    expect(
      (await database.db.select().from(notifications)).every(
        (row) => row.readAt === null,
      ),
    ).toBe(true);
  });
  it("a read latest reminder never reveals an older unread stage", async () => {
    const { later } = await reminders();
    await database.db
      .update(notifications)
      .set({ readAt: now })
      .where(eq(notifications.id, later.id));
    expect(await queries().getNotificationSummary()).toMatchObject({
      unreadCount: 0,
      items: [{ id: later.id, read: true }],
    });
  });
  it("mark all leaves future, expired and foreign rows unchanged", async () => {
    const { future } = await reminders();
    const foreign = await add({ userId: actors.member.userId });
    const expired = await add({ scheduledFor: at(-31), expiresAt: now });
    await actions().markAllNotificationsRead();
    const rows = await database.db.select().from(notifications);
    for (const id of [future.id, foreign.id, expired.id])
      expect(rows.find((row) => row.id === id)?.readAt).toBeNull();
    expect((await queries().getNotificationSummary()).unreadCount).toBe(0);
    now = at(5);
    expect((await queries().getNotificationSummary()).unreadCount).toBe(1);
  });
  it("foreign IDs do not disclose or mutate another user's rows", async () => {
    const own = await add();
    const foreign = await add({
      userId: actors.member.userId,
      scheduledFor: at(-5),
    });
    await actions().markNotificationRead({ notificationId: foreign.id });
    await actions().markNotificationRead({
      notificationId: crypto.randomUUID(),
    });
    expect(
      (await queries().getNotifications()).items.map((item) => item.id),
    ).toEqual([own.id]);
    expect(
      (await database.db.select().from(notifications)).every(
        (row) => row.readAt === null,
      ),
    ).toBe(true);
  });
  it("expires reminders exactly at booking end but keeps ordinary notifications", async () => {
    const reminder = await add();
    const ordinary = await add({
      type: "booking_cancelled",
      expiresAt: null,
      data: { ...reminder.data, minutesBefore: undefined, actorName: "김하은" },
    });
    now = at(60);
    expect(await queries().getNotificationSummary()).toMatchObject({
      unreadCount: 1,
      nextAt: null,
      items: [{ id: ordinary.id }],
    });
  });
  it("deduplicates before limits and sorts by descending timestamp then ID", async () => {
    const source = await add();
    await database.db.delete(notifications);
    const rows = Array.from({ length: 105 }, (_, index) => ({
      ...source,
      id: crypto.randomUUID(),
      type: "booking_invited" as const,
      expiresAt: null,
      scheduledFor: at(-index),
      data: { ...source.data, minutesBefore: undefined },
    }));
    await database.db.insert(notifications).values(rows);
    const summary = await queries().getNotificationSummary();
    const list = await queries().getNotifications();
    expect(summary.items).toHaveLength(20);
    expect(list.items).toHaveLength(100);
    expect(list.unreadCount).toBe(105);
    expect(list.items.map((item) => item.id)).toEqual(
      rows.slice(0, 100).map((row) => row.id),
    );
  });
  it("deduplicates reminder stages in SQL before filling the 20-row window", async () => {
    const source = await add();
    await database.db.delete(notifications);
    const stages = Array.from({ length: 25 }, (_, index) => ({
      ...source,
      id: crypto.randomUUID(),
      scheduledFor: at(-index - 1),
    }));
    const ordinary = Array.from({ length: 20 }, (_, index) => ({
      ...source,
      id: crypto.randomUUID(),
      type: "booking_invited" as const,
      expiresAt: null,
      scheduledFor: at(-index - 30),
      data: { ...source.data, minutesBefore: undefined },
    }));
    await database.db.insert(notifications).values([...stages, ...ordinary]);
    const summary = await queries().getNotificationSummary();
    expect(summary.unreadCount).toBe(21);
    expect(summary.items.map((item) => item.id)).toEqual([
      stages[0]!.id,
      ...ordinary.slice(0, 19).map((row) => row.id),
    ]);
    expect((await queries().getNotifications()).items).toHaveLength(21);
  });
  it("breaks equal publication times by ID without merging ordinary rows", async () => {
    const source = await add();
    await database.db.delete(notifications);
    const ids = [
      "00000000-0000-4000-8000-000000000003",
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    ];
    await database.db.insert(notifications).values(
      ids.map((id) => ({
        ...source,
        id,
        type: "booking_invited" as const,
        expiresAt: null,
        data: { ...source.data, minutesBefore: undefined },
      })),
    );
    expect(
      (await queries().getNotifications()).items.map((item) => item.id),
    ).toEqual([...ids].sort());
  });
  it("reading an ordinary notification does not mark reminders for its booking", async () => {
    const { early, later, future } = await reminders();
    const ordinary = await add({
      type: "booking_invited",
      expiresAt: null,
      data: { ...early.data, minutesBefore: undefined },
    });
    await actions().markNotificationRead({ notificationId: ordinary.id });
    const rows = await database.db.select().from(notifications);
    expect(rows.find((row) => row.id === ordinary.id)?.readAt).toEqual(now);
    for (const id of [early.id, later.id, future.id])
      expect(rows.find((row) => row.id === id)?.readAt).toBeNull();
    expect((await queries().getNotificationSummary()).unreadCount).toBe(1);
  });
  it("skips malformed snapshot data without exposing raw values", async () => {
    await add({
      data: {
        spaceName: "raw secret",
      } as typeof notifications.$inferInsert.data,
    });
    expect((await queries().getNotifications()).items).toEqual([]);
  });
  it.each([
    ["getNotificationSummary", 3],
    ["getNotifications", 2],
  ] as const)("keeps %s at one read-only stage", async (method, statements) => {
    await reminders();
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      await queries()[method]();
      expect(meter.stop()).toEqual({
        stages: 1,
        statements,
        perStage: [statements],
      });
    } finally {
      meter.restore();
    }
    expect(await database.db.select().from(notifications)).toHaveLength(3);
  });
  it("each read action sends exactly one conditional UPDATE", async () => {
    const row = await add();
    const meter = createQueryMeter(database.client);
    try {
      for (const action of [
        () => actions().markNotificationRead({ notificationId: row.id }),
        () => actions().markAllNotificationsRead(),
      ]) {
        meter.start();
        await action();
        expect(meter.stop()).toEqual({
          stages: 1,
          statements: 1,
          perStage: [1],
        });
      }
    } finally {
      meter.restore();
    }
  });
  it("requires sessions before all queries and read actions", async () => {
    const session = vi.fn(async () => {
      throw new ActionError("UNAUTHENTICATED");
    });
    const read = createNotificationQueries({
      requireSession: session,
      database: database.db,
    });
    await expect(read.getNotificationSummary()).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    await expect(read.getNotifications()).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    const write = createNotificationActions({
      getSession: async () => null,
      database: database.db,
    });
    expect(
      await write.markNotificationRead({ notificationId: crypto.randomUUID() }),
    ).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect(await write.markAllNotificationsRead()).toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
    });
  });
});

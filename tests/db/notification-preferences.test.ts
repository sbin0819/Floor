import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { notifications, users } from "@/lib/db/schema";
import { createNotificationQueries } from "@/features/notifications/query-factory";
import { createNotificationActions } from "@/features/notifications/action-factory";
import {
  bookingNow,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

describe("notification reminder preference filtering", () => {
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
    now = at(-7);
    await database.db.insert(notifications).values(
      ([30, 10, 5, 0] as const).map((minute) => ({
        userId: actors.person.userId,
        bookingId,
        type: "booking_reminder" as const,
        scheduledFor: at(-minute),
        expiresAt: at(60),
        data: {
          spaceName: "가상 회의실",
          floorName: "7F",
          branchName: "가상 지점",
          timezone: "Asia/Seoul",
          start: at(0).toISOString(),
          end: at(60).toISOString(),
          minutesBefore: minute,
        },
      })),
    );
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
  const choose = (minutes: number[]) =>
    database.db
      .update(users)
      .set({ reminderMinutes: minutes })
      .where(eq(users.id, actors.person.userId));
  it("filters list, unread count, next time and the newer-reminder predicate together", async () => {
    await choose([30, 0]);
    const summary = await queries().getNotificationSummary();
    expect(summary).toMatchObject({
      unreadCount: 1,
      nextAt: at(0).toISOString(),
      items: [{ type: "booking_reminder", data: { minutesBefore: 30 } }],
    });
    expect((await queries().getNotifications()).items).toHaveLength(1);
    await choose([10, 5]);
    expect(await queries().getNotificationSummary()).toMatchObject({
      unreadCount: 1,
      nextAt: at(-5).toISOString(),
      items: [{ data: { minutesBefore: 10 } }],
    });
    await choose([]);
    expect(await queries().getNotificationSummary()).toMatchObject({
      unreadCount: 0,
      nextAt: null,
      items: [],
    });
    expect(await database.db.select().from(notifications)).toHaveLength(4);
  });
  it("mark all includes hidden public stages but not future stages", async () => {
    await choose([]);
    await actions().markAllNotificationsRead();
    await choose([30, 10, 5, 0]);
    expect((await queries().getNotificationSummary()).unreadCount).toBe(0);
    now = at(-5);
    expect(await queries().getNotificationSummary()).toMatchObject({
      unreadCount: 1,
      items: [{ data: { minutesBefore: 5 } }],
    });
  });
  it("reading one public reminder also reads disabled older siblings", async () => {
    await choose([10]);
    const visible = (await queries().getNotificationSummary()).items[0]!;
    await actions().markNotificationRead({ notificationId: visible.id });
    await choose([30]);
    expect(await queries().getNotificationSummary()).toMatchObject({
      unreadCount: 0,
      items: [{ read: true, data: { minutesBefore: 30 } }],
    });
  });
  it("does not filter other notification types or expired/future privacy", async () => {
    await choose([]);
    await database.db.insert(notifications).values({
      userId: actors.person.userId,
      type: "friend_request",
      actorId: actors.member.userId,
      scheduledFor: at(-1),
      data: { actorName: "초대한 사람" },
    });
    expect((await queries().getNotificationSummary()).items).toEqual([]);
    now = at(70);
    expect(await queries().getNotificationSummary()).toMatchObject({
      unreadCount: 1,
      items: [{ type: "friend_request" }],
    });
    await choose([30, 10, 5, 0]);
    expect((await queries().getNotificationSummary()).items).toHaveLength(1);
  });
  it("keeps the summary/list query budgets", async () => {
    await choose([30]);
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      await queries().getNotificationSummary();
      expect(meter.stop().perStage).toEqual([3]);
      meter.start();
      await queries().getNotifications();
      expect(meter.stop().perStage).toEqual([2]);
    } finally {
      meter.restore();
    }
  });
});

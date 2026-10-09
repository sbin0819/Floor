import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createNotificationActions } from "@/features/notifications/action-factory";
import { buildBranchAnnouncementNotifications } from "@/features/notifications/builders";
import { createNotificationQueries } from "@/features/notifications/query-factory";
import { insertNotifications } from "@/lib/dal/notifications";
import { notifications, users } from "@/lib/db/schema";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

describe("branch announcement notification persistence", () => {
  let database: TestDatabase;
  const me = {
    userId: crypto.randomUUID(),
    email: "member@example.test",
    name: "김하은",
  };
  const actorId = crypto.randomUUID();
  const now = new Date("2026-10-09T03:00:00Z");
  const data = {
    branchName: "강남점",
    title: "정전 안내",
    body: "7층은 8시부터 이용해 주세요.",
    announcementId: crypto.randomUUID(),
  };
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    await database.db.execute(sql`truncate users cascade`);
    await database.db.insert(users).values([
      { id: me.userId, name: me.name, email: me.email },
      { id: actorId, name: "운영자", email: "operator@example.test" },
    ]);
  });
  const queries = () =>
    createNotificationQueries({
      database: database.db,
      requireSession: async () => me,
      now: () => now,
    });
  const rows = () =>
    buildBranchAnnouncementNotifications({
      ...data,
      actorId,
      userIds: [me.userId, actorId, me.userId],
      now,
    });
  it("stores snapshots, excludes the actor and preserves the exact notification query budgets", async () => {
    await insertNotifications(rows(), database.db);
    await database.db
      .update(users)
      .set({ name: "바뀐 이름" })
      .where(eq(users.id, actorId));
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      const summary = await queries().getNotificationSummary();
      expect(meter.stop()).toEqual({ stages: 1, statements: 3, perStage: [3] });
      expect(summary.items).toHaveLength(1);
      expect(summary.items[0]).toMatchObject({
        type: "branch_announcement",
        data,
        bookingId: null,
        href: null,
        read: false,
      });
      expect(summary.unreadCount).toBe(1);
      expect(JSON.stringify(summary)).not.toContain("@example.test");
      expect(summary.items[0]).not.toHaveProperty("actorId");
      meter.start();
      expect((await queries().getNotifications()).items).toEqual(summary.items);
      expect(meter.stop()).toEqual({ stages: 1, statements: 2, perStage: [2] });
    } finally {
      meter.restore();
    }
  });
  it("only marks the current recipient's visible notice read", async () => {
    await insertNotifications(rows(), database.db);
    const [notice] = await database.db.select().from(notifications);
    const future = {
      ...rows()[0]!,
      scheduledFor: new Date(now.getTime() + 1000),
    };
    await insertNotifications([future], database.db);
    const foreign = createNotificationActions({
      database: database.db,
      getSession: async () => ({
        userId: actorId,
        email: "operator@example.test",
        name: "운영자",
      }),
      now: () => now,
    });
    expect(
      await foreign.markNotificationRead({ notificationId: notice!.id }),
    ).toEqual({ ok: true, data: {} });
    expect((await queries().getNotifications()).unreadCount).toBe(1);
    const mine = createNotificationActions({
      database: database.db,
      getSession: async () => me,
      now: () => now,
    });
    expect(
      await mine.markNotificationRead({ notificationId: notice!.id }),
    ).toEqual({ ok: true, data: {} });
    expect((await queries().getNotifications()).unreadCount).toBe(0);
    expect(
      (await database.db.select().from(notifications)).filter(
        (row) => row.readAt === null,
      ),
    ).toHaveLength(1);
  });
  it("rolls back the whole notification batch with its parent transaction", async () => {
    await expect(
      database.db.transaction(async (tx) => {
        await insertNotifications(rows(), tx);
        throw new Error("rollback notice");
      }),
    ).rejects.toThrow("rollback notice");
    expect(await database.db.select().from(notifications)).toEqual([]);
  });
});

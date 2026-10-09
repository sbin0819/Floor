import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createNotificationActions } from "@/features/notifications/action-factory";
import { buildTeamNotifications } from "@/features/notifications/builders";
import { notificationPresentation } from "@/features/notifications/format";
import { createNotificationQueries } from "@/features/notifications/query-factory";
import { insertNotifications } from "@/lib/dal/notifications";
import { notifications, users } from "@/lib/db/schema";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

describe("team notification persistence", () => {
  let database: TestDatabase;
  const me = {
    userId: crypto.randomUUID(),
    email: "member@floor.test",
    name: "김하은",
  };
  const actor = { id: crypto.randomUUID(), name: "박지훈" };
  const teamId = crypto.randomUUID();
  const now = new Date("2026-10-09T03:00:00Z");
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    await database.db.execute(sql`TRUNCATE users CASCADE`);
    await database.db.insert(users).values([
      { id: me.userId, email: me.email, name: me.name },
      { ...actor, email: "actor@floor.test" },
    ]);
  });
  const queries = () =>
    createNotificationQueries({
      database: database.db,
      requireSession: async () => me,
      now: () => now,
    });
  const rows = () => [
    ...buildTeamNotifications({
      type: "team_removed",
      teamName: "디자인팀",
      actor,
      userIds: [me.userId],
      now,
    }),
    ...buildTeamNotifications({
      type: "team_role_changed",
      teamName: "디자인팀",
      teamId,
      role: "admin",
      actor,
      userIds: [me.userId],
      now,
    }),
    ...buildTeamNotifications({
      type: "team_deleted",
      teamName: "디자인팀",
      actor,
      userIds: [me.userId],
      now,
    }),
  ];

  it("keeps the actor and team snapshots after renaming and without a live actor reference", async () => {
    await insertNotifications(rows(), database.db);
    await database.db
      .update(users)
      .set({ name: "지금 이름" })
      .where(eq(users.id, actor.id));
    let summary = await queries().getNotificationSummary();
    expect(summary.unreadCount).toBe(3);
    expect(summary.items).toHaveLength(3);
    for (const item of summary.items) {
      expect(item.data).toMatchObject({
        actorName: actor.name,
        teamName: "디자인팀",
      });
      expect(item).not.toHaveProperty("actorId");
      expect(JSON.stringify(item)).not.toContain("@floor.test");
      expect(notificationPresentation(item).text).toContain("박지훈 님이");
    }
    expect(
      summary.items.find((item) => item.type === "team_role_changed")?.href,
    ).toBe(`/teams/${teamId}`);
    await database.db.update(notifications).set({ actorId: null });
    summary = await queries().getNotificationSummary();
    expect(summary.items.every((item) => item.actorAvatar === null)).toBe(true);
    expect(
      summary.items.every(
        (item) =>
          (item.type === "team_removed" ||
            item.type === "team_role_changed" ||
            item.type === "team_deleted") &&
          item.data.actorName === actor.name,
      ),
    ).toBe(true);
  });

  it("retains the notification query budgets and existing read actions", async () => {
    await insertNotifications(rows(), database.db);
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      const summary = await queries().getNotificationSummary();
      expect(meter.stop()).toEqual({ stages: 1, statements: 3, perStage: [3] });
      expect(summary.items).toHaveLength(3);
      meter.start();
      expect((await queries().getNotifications()).items).toEqual(summary.items);
      expect(meter.stop()).toEqual({ stages: 1, statements: 2, perStage: [2] });
    } finally {
      meter.restore();
    }
    const actions = createNotificationActions({
      database: database.db,
      getSession: async () => me,
      now: () => now,
    });
    const first = (await queries().getNotifications()).items[0]!;
    expect(
      await actions.markNotificationRead({ notificationId: first.id }),
    ).toEqual({ ok: true, data: {} });
    expect((await queries().getNotificationSummary()).unreadCount).toBe(2);
  });

  it("rolls the complete snapshot batch back with the surrounding team mutation", async () => {
    await expect(
      database.db.transaction(async (tx) => {
        await insertNotifications(rows(), tx);
        throw new Error("team mutation rollback");
      }),
    ).rejects.toThrow("team mutation rollback");
    expect(await database.db.select().from(notifications)).toEqual([]);
  });
});

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createNotificationQueries } from "@/features/notifications/query-factory";
import { avatarColorFor } from "@/lib/avatar";
import { createNotificationActions } from "@/features/notifications/action-factory";
import {
  createPersonNotification,
  deleteFriendRequestNotification,
} from "@/lib/dal/notifications";
import { notifications, users } from "@/lib/db/schema";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("person notification persistence", () => {
  let database: TestDatabase;
  const me = {
    userId: crypto.randomUUID(),
    email: "me@floor.test",
    name: "김하은",
  };
  const other = {
    userId: crypto.randomUUID(),
    email: "other@floor.test",
    name: "박지훈",
  };
  const now = new Date("2026-10-09T03:00:00Z");
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    await database.db.execute(sql`TRUNCATE users CASCADE`);
    await database.db
      .insert(users)
      .values(
        [me, other].map(({ userId, ...user }) => ({ id: userId, ...user })),
      );
  });
  const create = (
    type: "friend_request" | "friend_accepted" | "message_request",
    userId = me.userId,
    actorId = other.userId,
  ) =>
    createPersonNotification(
      { userId, actorId, actorName: "박지훈", type, now },
      database.db,
    );
  const queries = () =>
    createNotificationQueries({
      database: database.db,
      requireSession: async () => me,
      now: () => now,
    });

  it("returns minimal person data through both queries and supports the existing read action", async () => {
    const request = await create("friend_request");
    await create("friend_accepted");
    await create("friend_request", other.userId, me.userId);
    const list = await queries().getNotifications();
    expect(list.unreadCount).toBe(2);
    expect(list.items).toHaveLength(2);
    expect(list.items.find((item) => item.id === request.id)).toEqual({
      id: request.id,
      type: "friend_request",
      data: { actorName: "박지훈" },
      actorAvatar: {
        color: avatarColorFor(other.userId, null),
        photoUrl: null,
      },
      read: false,
      scheduledFor: now.toISOString(),
      bookingId: null,
      href: "/friends?tab=received",
    });
    expect((await queries().getNotificationSummary()).items).toEqual(
      list.items,
    );
    const actions = createNotificationActions({
      database: database.db,
      getSession: async () => me,
      now: () => now,
    });
    await actions.markNotificationRead({ notificationId: request.id });
    expect((await queries().getNotificationSummary()).unreadCount).toBe(1);
  });

  it("reads the actor's current safe avatar and returns null for a snapshot without an actor reference", async () => {
    await create("friend_request");
    await database.db
      .update(users)
      .set({
        avatarColor: "pink",
        avatarPhoto: true,
        avatarUrl: "https://avatars.githubusercontent.com/u/789",
      })
      .where(eq(users.id, other.userId));
    const first = (await queries().getNotificationSummary()).items[0]!;
    expect(first.actorAvatar).toEqual({
      color: "pink",
      photoUrl: "https://avatars.githubusercontent.com/u/789",
    });
    expect(first).not.toHaveProperty("actor");
    expect(first).not.toHaveProperty("actorId");
    await database.db
      .update(users)
      .set({ avatarUrl: "https://private.example.test/photo" })
      .where(eq(users.id, other.userId));
    expect((await queries().getNotifications()).items[0]?.actorAvatar).toEqual({
      color: "pink",
      photoUrl: null,
    });
    await database.db
      .update(notifications)
      .set({ actorId: null })
      .where(eq(notifications.actorId, other.userId));
    const orphan = (await queries().getNotifications()).items[0]!;
    expect(orphan.actorAvatar).toBeNull();
    expect(orphan.data).toEqual({ actorName: "박지훈" });
  });
  it("deletes only the specified recipient's request from the actor, not acceptance or reverse alerts", async () => {
    const request = await create("friend_request");
    const accepted = await create("friend_accepted");
    const reverse = await create("friend_request", other.userId, me.userId);
    expect(
      await deleteFriendRequestNotification(
        me.userId,
        other.userId,
        database.db,
      ),
    ).toEqual([{ id: request.id }]);
    expect(
      (await database.db.select().from(notifications))
        .map((row) => row.id)
        .sort(),
    ).toEqual([accepted.id, reverse.id].sort());
    expect(
      await deleteFriendRequestNotification(
        me.userId,
        other.userId,
        database.db,
      ),
    ).toEqual([]);
  });

  it("returns a message request as a person notification with no booking fields", async () => {
    const request = await create("message_request");
    expect((await queries().getNotifications()).items).toEqual([
      {
        id: request.id,
        type: "message_request",
        data: { actorName: "박지훈" },
        actorAvatar: {
          color: avatarColorFor(other.userId, null),
          photoUrl: null,
        },
        read: false,
        scheduledFor: now.toISOString(),
        bookingId: null,
        href: "/friends?tab=requests",
      },
    ]);
    const actions = createNotificationActions({
      database: database.db,
      getSession: async () => me,
      now: () => now,
    });
    expect(
      await actions.markNotificationRead({ notificationId: request.id }),
    ).toEqual({ ok: true, data: {} });
    expect((await queries().getNotificationSummary()).unreadCount).toBe(0);
  });

  it("rolls back person notifications with the surrounding transaction", async () => {
    await expect(
      database.db.transaction(async (tx) => {
        await createPersonNotification(
          {
            userId: me.userId,
            actorId: other.userId,
            actorName: other.name,
            type: "friend_request",
            now,
          },
          tx,
        );
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await database.db.select().from(notifications)).toEqual([]);
  });

  it("filters malformed person data at the query boundary", async () => {
    await database.db.insert(notifications).values({
      userId: me.userId,
      type: "friend_request",
      actorId: other.userId,
      scheduledFor: now,
      data: {} as typeof notifications.$inferInsert.data,
    });
    expect((await queries().getNotifications()).items).toEqual([]);
  });
});

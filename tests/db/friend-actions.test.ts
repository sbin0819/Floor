import { eq, sql } from "drizzle-orm";
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
import { createFriendActions } from "@/features/people/friend-actions";
import * as locks from "@/lib/dal/people-write";
import * as friendDal from "@/lib/dal/friends";
import * as notificationDal from "@/lib/dal/notifications";
import * as schema from "@/lib/db/schema";
import {
  chatRoomMembers,
  chatRooms,
  friendships,
  messages,
  notifications,
  users,
} from "@/lib/db/schema";
import { FRIEND_DAY_MS, FRIEND_DECLINE_MS } from "@/lib/people/friendship";
import { userChannel } from "@/lib/realtime/channels";
import type { RealtimeItem, RealtimePublisher } from "@/lib/realtime/types";
import { createTestDatabase, type TestDatabase } from "./helper";

const now = new Date("2026-10-08T03:00:00Z");
const me = "72000000-0000-4000-8000-000000000002";
const other = "72000000-0000-4000-8000-000000000001";
const absent = "72000000-0000-4000-8000-000000000099";
const before = (milliseconds: number) => new Date(now.getTime() - milliseconds);
type Status = (typeof friendships.$inferSelect)["status"];

describe("transactional friend request state machine", () => {
  let database: TestDatabase;
  const queries: { text: string; params: unknown[] }[] = [];
  const delivered: RealtimeItem[] = [];
  const logError = vi.fn();
  const publisher: RealtimePublisher = {
    publish: vi.fn(),
    publishMany: vi.fn(async (items) => {
      delivered.push(...items);
    }),
  };
  beforeAll(async () => {
    database = await createTestDatabase();
    database.db = drizzle({
      client: database.client,
      schema,
      logger: {
        logQuery(text, params) {
          queries.push({ text, params });
        },
      },
    });
  });
  afterAll(async () => {
    await database.client.close();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  beforeEach(async () => {
    logError.mockReset();
    await database.db.execute(sql`truncate users, branches cascade`);
    await database.db.insert(users).values([
      {
        id: me,
        name: "김하은",
        email: "haeun@example.test",
        emailVerified: true,
      },
      {
        id: other,
        name: "이서연",
        email: "seoyeon@example.test",
        emailVerified: true,
      },
    ]);
    delivered.length = 0;
    queries.length = 0;
  });
  const actions = (id = me, at = now, customPublisher = publisher) =>
    createFriendActions({
      database: database.db,
      now: () => at,
      publisher: customPublisher,
      logError,
      getSession: async () => ({
        userId: id,
        name: "오래된 세션 이름",
        email: "session@example.test",
      }),
    });
  const readPair = async () =>
    (
      await database.db
        .select()
        .from(friendships)
        .where(locks.friendPairCondition(me, other))
    )[0];
  const readNotifications = () =>
    database.db.select().from(notifications).orderBy(notifications.userId);
  const targetEvents = (id: string) =>
    delivered
      .filter(({ channel }) => channel === userChannel(id))
      .map(({ event }) => event);
  const friendChanged = { type: "friend.changed" };
  const notificationChanged = { type: "notifications.changed" };
  async function pair(
    status: Status,
    requestedBy = me,
    changedAt = now,
    requestedAt = changedAt,
  ) {
    await database.db.insert(friendships).values({
      userLowId: other,
      userHighId: me,
      status,
      requestedBy,
      requestedAt,
      statusChangedAt: changedAt,
      createdAt: requestedAt,
    });
  }
  async function requestNotification(recipient = other, actor = me) {
    await notificationDal.createPersonNotification(
      {
        userId: recipient,
        actorId: actor,
        type: "friend_request",
        actorName: "신청자",
        now,
      },
      database.db,
    );
  }
  async function fillDaily(count = 20, requestedAt = now) {
    const ids = Array.from(
      { length: count },
      (_, i) => `73000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    );
    if (!ids.length) return;
    await database.db.insert(users).values(
      ids.map((id, index) => ({
        id,
        name: `친구${index}`,
        email: `friend${index}@example.test`,
        emailVerified: true,
      })),
    );
    await database.db.insert(friendships).values(
      ids.map((id, index) => ({
        userLowId: me,
        userHighId: id,
        requestedBy: me,
        status: index % 2 ? ("pending" as const) : ("cancelled" as const),
        requestedAt,
        statusChangedAt: now,
      })),
    );
  }

  it("creates a request with canonical SQL ordering, safe notification snapshot and both user refresh events", async () => {
    expect(await actions().sendFriendRequest({ userId: other })).toEqual({
      ok: true,
      data: { relation: "outgoing" },
    });
    expect(await readPair()).toMatchObject({
      userLowId: other,
      userHighId: me,
      requestedBy: me,
      status: "pending",
      requestedAt: now,
      statusChangedAt: now,
    });
    const [notification] = await readNotifications();
    expect(notification).toMatchObject({
      userId: other,
      actorId: me,
      type: "friend_request",
      data: { actorName: "김하은" },
      scheduledFor: now,
      bookingId: null,
      expiresAt: null,
    });
    expect(JSON.stringify(notification!.data)).not.toMatch(/id|email|@/i);
    expect(targetEvents(me)).toEqual([friendChanged]);
    expect(targetEvents(other)).toEqual([friendChanged, notificationChanged]);
    expect(
      queries.find(({ text }) => text.startsWith('insert into "friendships"'))
        ?.text,
    ).toMatch(/least\([\s\S]*greatest\([\s\S]*on conflict do nothing/);
  });

  it.each(["accepted", "pending", "declined"] as const)(
    "does not change or publish for existing own %s, even at the daily limit",
    async (status) => {
      await pair(status);
      await fillDaily();
      const previous = await readPair();
      const counter = vi.spyOn(friendDal, "countRecentFriendRequests");
      expect(await actions().sendFriendRequest({ userId: other })).toEqual({
        ok: true,
        data: { relation: status === "accepted" ? "friend" : "outgoing" },
      });
      expect(await readPair()).toEqual(previous);
      expect(counter).not.toHaveBeenCalled();
      expect(delivered).toEqual([]);
      expect(await readNotifications()).toEqual([]);
    },
  );

  it("accepts an incoming request immediately, removes only its pending notification and sends acceptance", async () => {
    await pair("pending", other);
    await requestNotification(me, other);
    await fillDaily();
    expect(await actions().sendFriendRequest({ userId: other })).toEqual({
      ok: true,
      data: { relation: "friend" },
    });
    expect(await readPair()).toMatchObject({
      status: "accepted",
      requestedBy: other,
    });
    expect(await readNotifications()).toEqual([
      expect.objectContaining({
        userId: other,
        actorId: me,
        type: "friend_accepted",
        data: { actorName: "김하은" },
      }),
    ]);
    expect(targetEvents(me)).toEqual([friendChanged, notificationChanged]);
    expect(targetEvents(other)).toEqual([friendChanged, notificationChanged]);
  });

  it("handles a reverse request inserted in the initial pair-lock window", async () => {
    const original = locks.lockFriendPair;
    vi.spyOn(locks, "lockFriendPair").mockImplementationOnce(
      async (own, target, tx) => {
        await friendDal.insertFriendRequest(target, own, now, tx);
        return original(own, target, tx);
      },
    );
    expect(await actions().sendFriendRequest({ userId: other })).toMatchObject({
      ok: true,
      data: { relation: "friend" },
    });
    expect(await database.db.select().from(friendships)).toHaveLength(1);
  });

  it("reapplies the state table after ON CONFLICT instead of surfacing a duplicate error or counting a no-op", async () => {
    await pair("pending", other);
    await fillDaily();
    const lock = vi.spyOn(locks, "lockFriendPair").mockResolvedValueOnce(null);
    const counter = vi.spyOn(friendDal, "countRecentFriendRequests");
    expect(await actions().sendFriendRequest({ userId: other })).toMatchObject({
      ok: true,
      data: { relation: "friend" },
    });
    expect(lock).toHaveBeenCalledTimes(2);
    expect(counter).not.toHaveBeenCalled();
  });

  it.each([
    ["declined", me, FRIEND_DECLINE_MS],
    ["declined", me, FRIEND_DECLINE_MS + 1],
    ["declined", other, 1],
    ["cancelled", me, FRIEND_DAY_MS],
    ["cancelled", me, FRIEND_DAY_MS + 1],
    ["cancelled", other, 1],
  ] satisfies [Status, string, number][])(
    "restarts %s by %s after %i ms",
    async (status, requester, age) => {
      await pair(status, requester, before(age));
      expect(
        await actions().sendFriendRequest({ userId: other }),
      ).toMatchObject({ ok: true, data: { relation: "outgoing" } });
      expect(await readPair()).toMatchObject({
        status: "pending",
        requestedBy: me,
        requestedAt: now,
        statusChangedAt: now,
      });
      expect(await readNotifications()).toHaveLength(1);
      expect(targetEvents(other)).toEqual([friendChanged, notificationChanged]);
    },
  );

  it("enforces cancellation cooldown until exactly 24 hours", async () => {
    await pair("cancelled", me, before(FRIEND_DAY_MS - 1));
    expect(await actions().sendFriendRequest({ userId: other })).toEqual({
      ok: false,
      code: "LIMIT_EXCEEDED",
      message: "friend_cooldown",
    });
    expect((await readPair())?.status).toBe("cancelled");
    expect(delivered).toEqual([]);
  });
  it("keeps the declined request looking outgoing until one millisecond before 30 days", async () => {
    await pair("declined", me, before(FRIEND_DECLINE_MS - 1));
    expect(await actions().sendFriendRequest({ userId: other })).toMatchObject({
      ok: true,
      data: { relation: "outgoing" },
    });
    expect((await readPair())?.status).toBe("declined");
    expect(delivered).toEqual([]);
  });

  it("allows the twentieth request and rolls the twenty-first back, counting cancelled rows", async () => {
    await fillDaily(19);
    expect(await actions().sendFriendRequest({ userId: other })).toMatchObject({
      ok: true,
    });
    await database.db.insert(users).values({
      id: absent,
      name: "새 친구",
      email: "last@example.test",
      emailVerified: true,
    });
    delivered.length = 0;
    const previousNotifications = await readNotifications();
    expect(await actions().sendFriendRequest({ userId: absent })).toEqual({
      ok: false,
      code: "LIMIT_EXCEEDED",
      message: "friend_daily",
    });
    expect(await database.db.select().from(friendships)).toHaveLength(20);
    expect(await readNotifications()).toEqual(previousNotifications);
    expect(delivered).toEqual([]);
  });
  it("does not count requests made exactly twenty-four hours ago", async () => {
    await fillDaily(20, before(FRIEND_DAY_MS));
    expect(await actions().sendFriendRequest({ userId: other })).toMatchObject({
      ok: true,
    });
  });
  it("excludes the existing pair from its own restart limit", async () => {
    await fillDaily(19);
    await pair("cancelled", me, before(FRIEND_DAY_MS), now);
    expect(await actions().sendFriendRequest({ userId: other })).toMatchObject({
      ok: true,
    });
    expect(await database.db.select().from(friendships)).toHaveLength(20);
  });
  it("rejects restarting an expired row when twenty other recent requests remain", async () => {
    await fillDaily(20);
    await pair("declined", me, before(FRIEND_DECLINE_MS));
    const previous = await readPair();
    expect(await actions().sendFriendRequest({ userId: other })).toMatchObject({
      ok: false,
      message: "friend_daily",
    });
    expect(await readPair()).toEqual(previous);
  });

  it("accepts only incoming pending and clears its own request notification", async () => {
    await pair("pending", other, before(1000));
    await requestNotification(me, other);
    expect(
      await actions().respondFriendRequest({ userId: other, accept: true }),
    ).toEqual({ ok: true, data: { relation: "friend" } });
    expect(await readPair()).toMatchObject({
      status: "accepted",
      statusChangedAt: now,
      requestedAt: before(1000),
    });
    expect(await readNotifications()).toEqual([
      expect.objectContaining({ type: "friend_accepted", userId: other }),
    ]);
    expect(targetEvents(me)).toEqual([friendChanged, notificationChanged]);
    expect(targetEvents(other)).toEqual([friendChanged, notificationChanged]);
  });
  it("declines without telling the sender and keeps unrelated notifications", async () => {
    await pair("pending", other);
    await requestNotification(me, other);
    await notificationDal.createPersonNotification(
      {
        userId: me,
        actorId: other,
        type: "friend_accepted",
        actorName: "친구",
        now,
      },
      database.db,
    );
    expect(
      await actions().respondFriendRequest({ userId: other, accept: false }),
    ).toEqual({ ok: true, data: { relation: "none" } });
    expect((await readPair())?.status).toBe("declined");
    expect(await readNotifications()).toEqual([
      expect.objectContaining({ type: "friend_accepted" }),
    ]);
    expect(targetEvents(other)).toEqual([]);
    expect(targetEvents(me)).toEqual([friendChanged, notificationChanged]);
  });
  it("cancels a pending request and refreshes its recipient", async () => {
    await pair("pending", me, before(1000));
    await requestNotification();
    expect(
      await actions().cancelFriendRequest({ userId: other }),
    ).toMatchObject({ ok: true, data: { relation: "none" } });
    expect(await readPair()).toMatchObject({
      status: "cancelled",
      statusChangedAt: now,
      requestedAt: before(1000),
    });
    expect(await readNotifications()).toEqual([]);
    expect(targetEvents(other)).toEqual([friendChanged, notificationChanged]);
    expect(targetEvents(me)).toEqual([friendChanged]);
  });
  it("cancels a privately declined request without emitting to the recipient", async () => {
    await pair("declined");
    expect(
      await actions().cancelFriendRequest({ userId: other }),
    ).toMatchObject({ ok: true });
    expect(targetEvents(other)).toEqual([]);
    expect(targetEvents(me)).toEqual([friendChanged]);
    expect(await actions().sendFriendRequest({ userId: other })).toMatchObject({
      ok: false,
      message: "friend_cooldown",
    });
    expect(
      await actions(
        me,
        new Date(now.getTime() + FRIEND_DAY_MS),
      ).sendFriendRequest({ userId: other }),
    ).toMatchObject({ ok: true });
  });
  it("removes accepted friendship but preserves an existing DM and messages", async () => {
    await pair("accepted");
    const [room] = await database.db
      .insert(chatRooms)
      .values({ kind: "dm", dmLowUserId: other, dmHighUserId: me })
      .returning();
    await database.db.insert(chatRoomMembers).values(
      [me, other].map((userId) => ({
        roomId: room!.id,
        userId,
        status: "active" as const,
        joinedAt: now,
        statusChangedAt: now,
      })),
    );
    await database.db.insert(messages).values({
      roomId: room!.id,
      seq: 1,
      authorId: me,
      body: "남아 있는 대화",
    });
    expect(await actions().removeFriend({ userId: other })).toEqual({
      ok: true,
      data: { relation: "none" },
    });
    expect(await readPair()).toBeUndefined();
    expect(await database.db.select().from(chatRooms)).toHaveLength(1);
    expect(await database.db.select().from(messages)).toHaveLength(1);
    expect(targetEvents(me)).toEqual([friendChanged]);
    expect(targetEvents(other)).toEqual([friendChanged]);
  });

  it.each(["respond", "cancel", "remove"] as const)(
    "returns NOT_FOUND for absent %s relationship",
    async (operation) => {
      const api = actions();
      const result =
        operation === "respond"
          ? await api.respondFriendRequest({ userId: other, accept: true })
          : operation === "cancel"
            ? await api.cancelFriendRequest({ userId: other })
            : await api.removeFriend({ userId: other });
      expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
      expect(delivered).toEqual([]);
    },
  );
  it.each(["accepted", "declined", "cancelled", "pending"] as const)(
    "respond refuses own %s",
    async (status) => {
      await pair(status);
      expect(
        await actions().respondFriendRequest({ userId: other, accept: false }),
      ).toEqual({ ok: false, code: "NOT_FOUND" });
    },
  );
  it.each([
    ["accepted", me, 0],
    ["cancelled", me, 0],
    ["pending", other, 0],
    ["declined", other, 0],
    ["declined", me, FRIEND_DECLINE_MS],
  ] satisfies [Status, string, number][])(
    "cancel refuses %s by %s aged %d",
    async (status, requester, age) => {
      await pair(status, requester, before(age));
      expect(await actions().cancelFriendRequest({ userId: other })).toEqual({
        ok: false,
        code: "NOT_FOUND",
      });
    },
  );
  it.each(["pending", "declined", "cancelled"] as const)(
    "remove refuses %s",
    async (status) => {
      await pair(status);
      expect(await actions().removeFriend({ userId: other })).toEqual({
        ok: false,
        code: "NOT_FOUND",
      });
    },
  );
  it.each(["send", "respond", "cancel", "remove"] as const)(
    "protects %s against absent, unverified and self targets",
    async (operation) => {
      await database.db
        .update(users)
        .set({ emailVerified: false })
        .where(eq(users.id, other));
      const api = actions();
      const call = (id: string) =>
        operation === "send"
          ? api.sendFriendRequest({ userId: id })
          : operation === "respond"
            ? api.respondFriendRequest({ userId: id, accept: true })
            : operation === "cancel"
              ? api.cancelFriendRequest({ userId: id })
              : api.removeFriend({ userId: id });
      for (const id of [absent, other])
        expect(await call(id)).toEqual({ ok: false, code: "NOT_FOUND" });
      expect(await call(me)).toEqual({ ok: false, code: "INVALID_INPUT" });
      expect(delivered).toEqual([]);
    },
  );
  it("validates session and strict input before locking", async () => {
    const lock = vi.spyOn(locks, "lockFriendUsers");
    const anonymous = createFriendActions({
      database: database.db,
      getSession: async () => null,
    });
    expect(await anonymous.sendFriendRequest({ userId: other })).toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    for (const input of [
      { userId: "invalid" },
      { userId: other, requestedBy: me },
    ])
      expect(await actions().sendFriendRequest(input)).toMatchObject({
        ok: false,
        code: "INVALID_INPUT",
      });
    expect(lock).not.toHaveBeenCalled();
  });

  it.each([me, other])(
    "locks users once in UUID order with correct strength before the relationship (%s)",
    async (actor) => {
      const target = actor === me ? other : me;
      await actions(actor).sendFriendRequest({ userId: target });
      const locked = queries.filter(({ text }) =>
        /from "users".* for (update|key share)/.test(text),
      );
      expect(locked).toHaveLength(2);
      expect(locked.map(({ params }) => params[0])).toEqual([other, me]);
      for (const query of locked)
        expect(
          query.text.endsWith(
            query.params[0] === actor ? "for update" : "for key share",
          ),
        ).toBe(true);
      const pairIndex = queries.findIndex(({ text }) =>
        /from "friendships".* for update/.test(text),
      );
      expect(pairIndex).toBeGreaterThan(queries.indexOf(locked[1]!));
    },
  );

  it("uses conditional UPDATE RETURNING and never announces an unsuccessful change", async () => {
    await pair("pending", other);
    const original = friendDal.changeFriendship;
    vi.spyOn(friendDal, "changeFriendship").mockImplementationOnce(
      async (row, values, tx) => {
        await tx
          .update(friendships)
          .set({ status: "cancelled" })
          .where(eq(friendships.userLowId, other));
        return original(row, values, tx);
      },
    );
    expect(
      await actions().respondFriendRequest({ userId: other, accept: true }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect((await readPair())?.status).toBe("pending");
    const update = queries.findLast(({ text }) =>
      text.startsWith('update "friendships"'),
    )?.text;
    expect(update).toMatch(
      /where[\s\S]*"status"[\s\S]*"requested_by"[\s\S]*returning/,
    );
    expect(delivered).toEqual([]);
  });
  it("rolls relationship and notification removal back if acceptance notification fails", async () => {
    await pair("pending", other);
    await requestNotification(me, other);
    const previous = await readNotifications();
    vi.spyOn(notificationDal, "createPersonNotification").mockRejectedValueOnce(
      new Error("private snapshot"),
    );
    expect(
      await actions().respondFriendRequest({ userId: other, accept: true }),
    ).toMatchObject({ ok: false, code: "INTERNAL" });
    expect((await readPair())?.status).toBe("pending");
    expect(await readNotifications()).toEqual(previous);
    expect(delivered).toEqual([]);
  });
  it("publishes only after commit and never rolls successful data back on delivery failure", async () => {
    const failing: RealtimePublisher = {
      publish: vi.fn(),
      publishMany: vi.fn(async () => {
        expect((await readPair())?.status).toBe("pending");
        expect(await readNotifications()).toHaveLength(1);
        throw new Error("private service error");
      }),
    };
    expect(
      await actions(me, now, failing).sendFriendRequest({ userId: other }),
    ).toMatchObject({ ok: true });
    expect(failing.publishMany).toHaveBeenCalledTimes(1);
    expect(failing.publish).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledExactlyOnceWith(
      "Friend realtime publication failed.",
    );
    expect((await readPair())?.status).toBe("pending");
  });
});

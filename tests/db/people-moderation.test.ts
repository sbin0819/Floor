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
import { createModerationActions } from "@/features/people/moderation-actions";
import { createFriendActions } from "@/features/people/friend-actions";
import * as moderation from "@/lib/dal/people-moderation";
import * as locks from "@/lib/dal/people-write";
import { blockBetween } from "@/lib/dal/people-blocks";
import { relationOf } from "@/lib/people/friendship";
import * as schema from "@/lib/db/schema";
import {
  chatRoomMembers,
  chatRooms,
  friendships,
  messages,
  notifications,
  reports,
  teamMembers,
  teams,
  userBlocks,
  users,
} from "@/lib/db/schema";
import { userChannel } from "@/lib/realtime/channels";
import type { RealtimeItem, RealtimePublisher } from "@/lib/realtime/types";
import { createTestDatabase, type TestDatabase } from "./helper";

const id = (n: number) =>
  `74000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const me = id(2),
  other = id(1),
  stranger = id(3),
  roomId = id(100),
  messageId = id(200);
const now = new Date("2026-10-08T03:00:00Z");
const before = (ms: number) => new Date(now.getTime() - ms);
describe("private user blocks and reports", () => {
  let database: TestDatabase;
  const queries: { text: string; params: unknown[] }[] = [];
  const events: RealtimeItem[] = [];
  const logError = vi.fn();
  const publisher: RealtimePublisher = {
    publish: vi.fn(),
    publishMany: vi.fn(async (items) => {
      events.push(...items);
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
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    await database.db.execute(sql`truncate users, branches cascade`);
    await database.db.insert(users).values(
      [me, other, stranger].map((id, i) => ({
        id,
        name: ["김하은", "이서연", "박지훈"][i]!,
        email: `${i}@example.test`,
        emailVerified: true,
      })),
    );
    await database.db
      .insert(teams)
      .values({ id: id(10), name: "가상 팀", createdBy: me });
    await database.db.insert(teamMembers).values(
      [me, other].map((userId) => ({
        teamId: id(10),
        userId,
        role: "member" as const,
      })),
    );
    await database.db.insert(chatRooms).values({
      id: roomId,
      kind: "dm",
      dmLowUserId: other,
      dmHighUserId: me,
      lastSeq: 1,
      lastMessageAt: now,
    });
    await database.db.insert(chatRoomMembers).values(
      [me, other].map((userId) => ({
        roomId,
        userId,
        status: "active" as const,
        joinedAt: before(60_000),
        statusChangedAt: before(60_000),
      })),
    );
    await database.db.insert(messages).values({
      id: messageId,
      roomId,
      seq: 1,
      authorId: other,
      body: "복사하거나 노출하지 않을 본문",
      createdAt: now,
    });
    queries.length = 0;
    events.length = 0;
    logError.mockReset();
  });
  const dependencies = (userId = me) => ({
    database: database.db,
    getSession: async () => ({
      userId,
      email: "session@example.test",
      name: "세션 이름",
    }),
    now: () => now,
    publisher,
    logError,
  });
  const actions = (userId = me) =>
    createModerationActions(dependencies(userId));
  async function relation(
    status: "accepted" | "pending" | "declined" | "cancelled",
    requestedBy = other,
  ) {
    await database.db.insert(friendships).values({
      userLowId: other,
      userHighId: me,
      status,
      requestedBy,
      requestedAt: before(1000),
      statusChangedAt: before(1000),
      createdAt: before(1000),
    });
  }
  async function note(
    userId: string,
    actorId: string,
    type: "friend_request" | "friend_accepted" | "message_request",
  ) {
    await database.db.insert(notifications).values({
      userId,
      actorId,
      type,
      data: { actorName: "이름" },
      scheduledFor: now,
    });
  }
  const readRelation = async () =>
    (await database.db.select().from(friendships))[0] ?? null;

  it("blocks and unblocks idempotently without altering conversation history or notifying the peer", async () => {
    const history = await database.db.select().from(messages);
    expect(await actions().blockUser({ userId: other })).toEqual({
      ok: true,
      data: {},
    });
    expect(await actions().blockUser({ userId: other })).toEqual({
      ok: true,
      data: {},
    });
    expect(await blockBetween(me, other, database.db)).toEqual({
      byMe: true,
      byThem: false,
    });
    expect(await blockBetween(other, me, database.db)).toEqual({
      byMe: false,
      byThem: true,
    });
    expect(await database.db.select().from(userBlocks)).toHaveLength(1);
    expect(events).toEqual([
      { channel: userChannel(me), event: { type: "friend.changed" } },
    ]);
    expect(await actions().unblockUser({ userId: other })).toEqual({
      ok: true,
      data: {},
    });
    expect(await actions().unblockUser({ userId: other })).toEqual({
      ok: true,
      data: {},
    });
    expect(await database.db.select().from(userBlocks)).toEqual([]);
    expect(await database.db.select().from(messages)).toEqual(history);
    expect(events.every(({ channel }) => channel === userChannel(me))).toBe(
      true,
    );
  });
  it.each(["blockUser", "reportUser"] as const)(
    "%s rejects self, unknown and invisible targets",
    async (method) => {
      const input = { reason: "spam" };
      for (const [target, code] of [
        [me, "INVALID_INPUT"],
        [stranger, "NOT_FOUND"],
        [id(999), "NOT_FOUND"],
      ] as const) {
        const result =
          method === "blockUser"
            ? await actions().blockUser({ userId: target })
            : await actions().reportUser({ userId: target, ...input });
        expect(result).toEqual({ ok: false, code });
      }
      expect(await database.db.select().from(userBlocks)).toEqual([]);
      expect(await database.db.select().from(reports)).toEqual([]);
      expect(events).toEqual([]);
    },
  );
  it("removes accepted friendship without restoring it on unblock", async () => {
    await relation("accepted");
    await actions().blockUser({ userId: other });
    expect(await readRelation()).toBeNull();
    await actions().unblockUser({ userId: other });
    expect(await readRelation()).toBeNull();
    expect(events.every(({ channel }) => channel === userChannel(me))).toBe(
      true,
    );
  });
  it("declines the peer's pending request quietly while their sent relation remains outgoing", async () => {
    await relation("pending");
    await note(me, other, "friend_request");
    expect((await actions().blockUser({ userId: other })).ok).toBe(true);
    const row = await readRelation();
    expect(row).toMatchObject({ status: "declined", statusChangedAt: now });
    expect(relationOf(row, other, now)).toBe("outgoing");
    expect(await database.db.select().from(notifications)).toEqual([]);
    expect(events).toEqual([
      { channel: userChannel(me), event: { type: "friend.changed" } },
      { channel: userChannel(me), event: { type: "notifications.changed" } },
    ]);
  });
  it("cancels my pending request and deletes the peer's request notification without peer events", async () => {
    await relation("pending", me);
    await note(other, me, "friend_request");
    await actions().blockUser({ userId: other });
    expect(await readRelation()).toMatchObject({
      status: "cancelled",
      statusChangedAt: now,
    });
    expect(await database.db.select().from(notifications)).toEqual([]);
    expect(events.every(({ channel }) => channel === userChannel(me))).toBe(
      true,
    );
  });
  it.each(["declined", "cancelled"] as const)(
    "preserves a %s relation row",
    async (status) => {
      await relation(status);
      const before = await readRelation();
      await actions().blockUser({ userId: other });
      expect(await readRelation()).toEqual(before);
    },
  );
  it.each([me, other])(
    "ends requested membership on %s and clears only the relevant notifications",
    async (recipient) => {
      await database.db
        .update(chatRoomMembers)
        .set({ status: "requested", requestedAt: before(10_000) })
        .where(eq(chatRoomMembers.userId, recipient));
      await note(me, other, "message_request");
      await note(other, me, "message_request");
      await note(me, other, "friend_request");
      await note(me, other, "friend_accepted");
      await note(me, stranger, "message_request");
      await actions().blockUser({ userId: other });
      expect(
        (
          await database.db
            .select()
            .from(chatRoomMembers)
            .where(eq(chatRoomMembers.userId, recipient))
        )[0],
      ).toMatchObject({
        status: "declined",
        requestedAt: before(10_000),
        statusChangedAt: now,
      });
      expect(
        (await database.db.select().from(notifications)).map(
          ({ type, actorId }) => ({ type, actorId }),
        ),
      ).toEqual([
        { type: "friend_accepted", actorId: other },
        { type: "message_request", actorId: stranger },
      ]);
      expect(await database.db.select().from(chatRooms)).toHaveLength(1);
    },
  );
  it.each([me, other])(
    "rejects new friend requests before existing friend/team relations when %s blocks",
    async (blocker) => {
      await relation("accepted");
      await database.db
        .insert(userBlocks)
        .values({ blockerId: blocker, blockedId: blocker === me ? other : me });
      expect(
        await createFriendActions(dependencies()).sendFriendRequest({
          userId: other,
        }),
      ).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(await readRelation()).toMatchObject({ status: "accepted" });
      expect(await database.db.select().from(notifications)).toEqual([]);
      expect(events).toEqual([]);
    },
  );
  it("holds users in UUID order before friendship, room and membership changes", async () => {
    await relation("pending");
    queries.length = 0;
    await actions().blockUser({ userId: other });
    const locking = queries.filter(({ text }) =>
      /for (?:key share|update)/i.test(text),
    );
    expect(locking[0]).toMatchObject({ params: [other] });
    expect(locking[0]!.text).toMatch(/for key share/i);
    expect(locking[1]).toMatchObject({ params: [me] });
    expect(locking[1]!.text).toMatch(/for update/i);
    expect(locking[2]!.text).toContain('"friendships"');
    expect(locking[3]!.text).toContain('"chat_rooms"');
    expect(locking[4]!.text).toContain('"chat_room_members"');
  });
  it("rechecks target visibility after user locks", async () => {
    const original = locks.lockFriendUsers;
    vi.spyOn(locks, "lockFriendUsers").mockImplementationOnce(
      async (...args) => {
        const rows = await original(...args);
        await args[2].delete(chatRooms);
        await args[2].delete(teamMembers).where(eq(teamMembers.userId, other));
        return rows;
      },
    );
    expect(await actions().blockUser({ userId: other })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await database.db.select().from(userBlocks)).toEqual([]);
    expect(await database.db.select().from(chatRooms)).toHaveLength(1);
  });
  it("rolls back blocks, relation and request state if notification deletion fails", async () => {
    await relation("pending");
    vi.spyOn(moderation, "deleteBlockedNotifications").mockRejectedValueOnce(
      new Error("secret database failure"),
    );
    expect(await actions().blockUser({ userId: other })).toEqual({
      ok: false,
      code: "INTERNAL",
    });
    expect(await database.db.select().from(userBlocks)).toEqual([]);
    expect(await readRelation()).toMatchObject({ status: "pending" });
    expect(events).toEqual([]);
    expect(JSON.stringify(logError.mock.calls)).not.toContain("secret");
  });
  it("commits blocks even if post-commit publishing fails", async () => {
    const action = createModerationActions({
      ...dependencies(),
      publisher: {
        ...publisher,
        publishMany: vi.fn().mockRejectedValue(new Error("secret")),
      },
    });
    expect((await action.blockUser({ userId: other })).ok).toBe(true);
    expect(await blockBetween(me, other, database.db)).toMatchObject({
      byMe: true,
    });
    expect(logError).toHaveBeenCalledWith(
      "People realtime publication failed.",
    );
  });
  it("records trimmed user reports and no separate message body or realtime events", async () => {
    expect(
      await actions().reportUser({
        userId: other,
        reason: "harassment",
        detail: "  자세한 설명 \n",
      }),
    ).toEqual({ ok: true, data: {} });
    expect(
      await actions().reportUser({
        userId: other,
        reason: "other",
        detail: "  ",
      }),
    ).toEqual({ ok: true, data: {} });
    const rows = await database.db.select().from(reports);
    expect(rows.map(({ detail }) => detail)).toEqual(["자세한 설명", null]);
    expect(rows[0]).toMatchObject({
      reporterId: me,
      targetUserId: other,
      messageId: null,
      reason: "harassment",
      createdAt: now,
    });
    expect(JSON.stringify(rows)).not.toContain("복사하거나");
    expect(events).toEqual([]);
  });
  it("accepts 500 Unicode characters and rejects 501, unknown reasons and extra fields", async () => {
    expect(
      (
        await actions().reportUser({
          userId: other,
          reason: "spam",
          detail: "😀".repeat(500),
        })
      ).ok,
    ).toBe(true);
    for (const extra of [
      { detail: "😀".repeat(501) },
      { reason: "unknown" },
      { extra: true },
    ])
      expect(
        await actions().reportUser({ userId: other, reason: "spam", ...extra }),
      ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await database.db.select().from(reports)).toHaveLength(1);
  });
  it("enforces twenty reports in a rolling day and ignores the exact 24-hour boundary", async () => {
    await database.db.insert(reports).values(
      Array.from({ length: 20 }, (_, index) => ({
        reporterId: me,
        targetUserId: other,
        reason: "other" as const,
        createdAt: index === 0 ? before(86_400_000) : before(1000),
      })),
    );
    expect(
      (await actions().reportUser({ userId: other, reason: "spam" })).ok,
    ).toBe(true);
    expect(
      await actions().reportUser({ userId: other, reason: "spam" }),
    ).toEqual({ ok: false, code: "LIMIT_EXCEEDED", message: "report_daily" });
    expect(await database.db.select().from(reports)).toHaveLength(21);
  });
  it("reports a readable peer message once, even when duplicate submission follows reaching the daily limit", async () => {
    const input = { messageId, reason: "inappropriate", detail: " first " };
    expect((await actions().reportMessage(input)).ok).toBe(true);
    await database.db.insert(reports).values(
      Array.from({ length: 19 }, () => ({
        reporterId: me,
        targetUserId: other,
        reason: "other" as const,
        createdAt: now,
      })),
    );
    expect(
      await actions().reportMessage({ ...input, detail: "different" }),
    ).toEqual({ ok: true, data: {} });
    const rows = await database.db
      .select()
      .from(reports)
      .where(eq(reports.messageId, messageId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reporterId: me,
      targetUserId: other,
      detail: "first",
    });
    expect(events).toEqual([]);
  });
  it.each(["own", "system", "deleted"] as const)(
    "rejects %s messages without persisting a report",
    async (kind) => {
      if (kind === "own")
        await database.db.update(messages).set({ authorId: me });
      if (kind === "system")
        await database.db.update(messages).set({
          authorId: null,
          kind: "system",
          systemData: { type: "group_created", actorName: "이름" },
        });
      if (kind === "deleted")
        await database.db.update(messages).set({ deletedAt: now, body: "" });
      expect(
        await actions().reportMessage({ messageId, reason: "spam" }),
      ).toEqual({ ok: false, code: "INVALID_INPUT" });
      expect(await database.db.select().from(reports)).toEqual([]);
    },
  );
  it("does not disclose the existence or type of messages in an inaccessible room", async () => {
    expect(
      await actions(stranger).reportMessage({ messageId, reason: "spam" }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(
      await actions().reportMessage({ messageId: id(999), reason: "spam" }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
  });
  it("rechecks deleted messages after locking and rolls back on report persistence failure", async () => {
    const original = locks.lockFriendUsers;
    vi.spyOn(locks, "lockFriendUsers").mockImplementationOnce(
      async (...args) => {
        const rows = await original(...args);
        await args[2]
          .update(messages)
          .set({ body: "", deletedAt: now })
          .where(eq(messages.id, messageId));
        return rows;
      },
    );
    expect(
      await actions().reportMessage({ messageId, reason: "spam" }),
    ).toEqual({ ok: false, code: "INVALID_INPUT" });
    vi.spyOn(moderation, "insertReport").mockRejectedValueOnce(
      new Error("secret"),
    );
    expect(
      await actions().reportMessage({ messageId, reason: "spam" }),
    ).toEqual({ ok: false, code: "INTERNAL" });
    expect(await database.db.select().from(reports)).toEqual([]);
    expect(events).toEqual([]);
  });
});

import { eq, sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createChatActions } from "@/features/chat/action-factory";
import { createChatQueries } from "@/features/chat/query-factory";
import { createRealtimeToken } from "@/features/chat/realtime-token";
import { advanceRoomRead } from "@/lib/dal/chat-reads";
import { canReadRoom, canWriteRoom, canReactRoom } from "@/lib/dal/chat-access";
import {
  chatRoomMembers,
  chatRoomReads,
  chatRooms,
  friendships,
  messageMentions,
  messages,
  notifications,
  teamMembers,
  users,
} from "@/lib/db/schema";
import { createMemoryRateLimiter } from "@/lib/rate-limit/memory";
import { createTestDatabase, type TestDatabase } from "./helper";
import { seedChatActors, chatNow, type ChatActors } from "./chat-helper";
import { createQueryMeter } from "./query-meter";
import * as directDal from "@/lib/dal/direct";
import * as chatWrite from "@/lib/dal/chat-write";

describe("direct messages", () => {
  let database: TestDatabase;
  let actors: ChatActors;
  const now = new Date(chatNow.getTime() + 60_000);
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    await database.db.execute(sql`truncate users, branches cascade`);
    actors = await seedChatActors(database);
    await database.db.update(users).set({ emailVerified: true });
  });
  const publisher = { publish: vi.fn(), publishMany: vi.fn() };
  const actions = (session = actors.member, clock = now) =>
    createChatActions({
      database: database.db,
      getSession: async () => session,
      now: () => clock,
      publisher,
      limiter: createMemoryRateLimiter(),
    });
  const queries = (session = actors.member) =>
    createChatQueries({
      database: database.db,
      requireSession: async () => session,
      now: () => now,
      limiter: createMemoryRateLimiter(),
    });
  async function open(
    session = actors.member,
    other = actors.admin,
    clock = chatNow,
  ) {
    const result = await actions(session, clock).openDirectMessage({
      userId: other.userId,
    });
    if (!result.ok) throw new Error(`Open failed: ${result.code}`);
    return result.data.roomId;
  }
  async function send(
    roomId: string,
    session = actors.member,
    body = "안녕하세요",
  ) {
    const result = await actions(session).sendMessage({
      roomId,
      body,
      clientId: crypto.randomUUID(),
    });
    if (!result.ok) throw new Error(`Send failed: ${result.code}`);
    return result.data;
  }
  async function friend() {
    const [low, high] = [
      actors.member.userId,
      actors.outsider.userId,
    ].sort() as [string, string];
    await database.db.insert(friendships).values({
      userLowId: low,
      userHighId: high,
      requestedBy: low,
      status: "accepted",
      requestedAt: chatNow,
      statusChangedAt: chatNow,
    });
  }

  it("advances cursors with atomic previous values", async () => {
    expect(
      await advanceRoomRead(
        { roomId: actors.roomId, userId: actors.member.userId, seq: 0, now },
        database.db,
      ),
    ).toEqual({ lastReadSeq: 0, advanced: false });
  });

  it("only returns a changed write for an increased cursor and reads the actual cursor after no-op", async () => {
    await database.db
      .update(chatRooms)
      .set({ lastSeq: 5 })
      .where(eq(chatRooms.id, actors.roomId));
    const calls = vi.spyOn(database.client, "query");
    try {
      expect(
        await advanceRoomRead(
          { roomId: actors.roomId, userId: actors.member.userId, seq: 5, now },
          database.db,
        ),
      ).toEqual({ lastReadSeq: 5, advanced: true });
      expect(calls).toHaveBeenCalledTimes(1);
      expect(calls.mock.calls[0]![0]).toMatch(
        /on conflict[\s\S]*where "chat_room_reads"\."last_read_seq" < excluded.last_read_seq/i,
      );
      calls.mockClear();
      expect(
        await advanceRoomRead(
          { roomId: actors.roomId, userId: actors.member.userId, seq: 3, now },
          database.db,
        ),
      ).toEqual({ lastReadSeq: 5, advanced: false });
      expect(calls).toHaveBeenCalledTimes(2);
      expect(calls.mock.calls[1]![0]).toMatch(/^select[\s\S]*readable_room/i);
    } finally {
      calls.mockRestore();
    }
  });

  it("opens shared-team and friend DMs, keeps peers/cursors on retries and emits no open event", async () => {
    const roomId = await open();
    expect(await open(actors.admin, actors.member)).toBe(roomId);
    expect(await open(actors.member, actors.admin, now)).toBe(roomId);
    expect(await database.db.select().from(chatRoomMembers)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roomId,
          userId: actors.member.userId,
          joinedAt: chatNow,
        }),
        expect.objectContaining({
          roomId,
          userId: actors.admin.userId,
          joinedAt: chatNow,
        }),
      ]),
    );
    await friend();
    expect(await open(actors.member, actors.outsider)).not.toBe(roomId);
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(publisher.publishMany).not.toHaveBeenCalled();
  });

  it("rejects strangers, self, missing and unverified targets without disclosing them", async () => {
    expect(
      await actions().openDirectMessage({ userId: actors.outsider.userId }),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(
      await actions().openDirectMessage({ userId: actors.member.userId }),
    ).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(
      await actions().openDirectMessage({ userId: crypto.randomUUID() }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    await database.db
      .update(users)
      .set({ emailVerified: false })
      .where(eq(users.id, actors.admin.userId));
    expect(
      await actions().openDirectMessage({ userId: actors.admin.userId }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("leaves one room and two members after competing opens", async () => {
    const results = await Promise.all([
      open(),
      open(actors.admin, actors.member),
      open(),
    ]);
    expect(new Set(results).size).toBe(1);
    expect(
      await database.db
        .select()
        .from(chatRooms)
        .where(eq(chatRooms.kind, "dm")),
    ).toHaveLength(1);
    expect(await database.db.select().from(chatRoomMembers)).toHaveLength(2);
  });

  it("does not grant reopen from an empty DM after relationship loss but keeps existing member access", async () => {
    await friend();
    const roomId = await open(actors.member, actors.outsider);
    await database.db.delete(friendships);
    expect(
      await actions().openDirectMessage({ userId: actors.outsider.userId }),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(
      (await canWriteRoom(actors.member.userId, roomId, database.db)).canWrite,
    ).toBe(true);
    await send(roomId);
    expect(await open(actors.member, actors.outsider)).toBe(roomId);
  });

  it("hides DMs from nonmembers and operators at all read/write boundaries", async () => {
    const roomId = await open();
    const message = await send(roomId);
    for (const session of [actors.outsider, actors.operator]) {
      expect(await canReadRoom(session.userId, roomId, database.db)).toBeNull();
      expect(await queries(session).getDirectMessageView(roomId)).toBeNull();
      await expect(
        queries(session).getRoomMessagesPage(roomId, { before: "100" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(
        await actions(session).sendMessage({
          roomId,
          clientId: crypto.randomUUID(),
          body: "침입",
        }),
      ).toEqual({ ok: false, code: "NOT_FOUND" });
      expect(
        await actions(session).setRoomMuted({ roomId, muted: true }),
      ).toEqual({ ok: false, code: "NOT_FOUND" });
      expect(
        await actions(session).setReaction({
          messageId: message.id,
          emoji: "heart",
          on: true,
        }),
      ).toEqual({ ok: false, code: "NOT_FOUND" });
    }
    expect(await queries().getDirectMessageView("not-a-uuid")).toBeNull();
    expect(await queries().getChannelView(actors.spaceId, roomId)).toBeNull();
  });

  it("keeps DM peers non-admin, author-only delete, peer-active write and reaction permissions", async () => {
    const roomId = await open();
    const message = await send(roomId);
    expect(
      await actions(actors.admin).deleteMessage({ messageId: message.id }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    await database.db
      .update(chatRoomMembers)
      .set({ status: "left" })
      .where(eq(chatRoomMembers.userId, actors.admin.userId));
    expect(
      (await canWriteRoom(actors.member.userId, roomId, database.db)).canWrite,
    ).toBe(false);
    expect(
      (await canReactRoom(actors.member.userId, roomId, database.db)).canReact,
    ).toBe(false);
    expect(
      await canReadRoom(actors.member.userId, roomId, database.db),
    ).not.toBeNull();
    expect(await queries(actors.admin).getDirectMessageView(roomId)).toBeNull();
  });

  it("supports replies, edits, reactions and everyone mentions only for the active DM peer", async () => {
    const roomId = await open();
    const message = await send(
      roomId,
      actors.member,
      `<@everyone> <@${actors.admin.userId}> <@${actors.outsider.userId}>`,
    );
    expect(message.mentionsEveryone).toBe(true);
    expect(message.mentions).toEqual([
      { userId: actors.admin.userId, name: actors.admin.name },
    ]);
    expect(
      await actions(actors.admin).setReaction({
        messageId: message.id,
        emoji: "heart",
        on: true,
      }),
    ).toEqual({ ok: true, data: { count: 1, mine: true } });
    const edited = await actions().editMessage({
      messageId: message.id,
      body: "수정했어요",
    });
    expect(edited).toMatchObject({
      ok: true,
      data: { body: "수정했어요", mentions: [], mentionsEveryone: false },
    });
    const reply = await actions(actors.admin).sendMessage({
      roomId,
      clientId: crypto.randomUUID(),
      body: "답장",
      replyToId: message.id,
    });
    expect(reply).toMatchObject({
      ok: true,
      data: { replyTo: { id: message.id, excerpt: "수정했어요" } },
    });
    expect(await actions().deleteMessage({ messageId: message.id })).toEqual({
      ok: true,
      data: { id: message.id },
    });
  });

  it("sends activity only to the peer and DM mentions carry the sender's visible room name", async () => {
    const roomId = await open();
    const message = await send(roomId, actors.member, "<@everyone> 반가워요");
    expect(publisher.publishMany).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({
        channel: `room:${roomId}`,
        event: expect.objectContaining({ type: "message.created" }),
      }),
      {
        channel: `user:${actors.admin.userId}`,
        event: {
          type: "room.activity",
          bookingId: null,
          roomId,
          roomKind: "dm",
          spaceId: null,
          seq: 1,
          authorId: actors.member.userId,
          preview: {
            messageId: message.id,
            authorName: actors.member.name,
            excerpt: "@모두 반가워요",
          },
        },
      },
      {
        channel: `user:${actors.admin.userId}`,
        event: {
          type: "mention.created",
          bookingId: null,
          roomId,
          roomKind: "dm",
          spaceId: null,
          roomName: actors.member.name,
          seq: 1,
          messageId: message.id,
          authorName: actors.member.name,
          excerpt: "@모두 반가워요",
        },
      },
    ]);
  });

  it.each([false, true])(
    "keeps the canonical DM and all side effects unchanged on client-id retries (initial mention: %s)",
    async (withMention) => {
      const roomId = await open();
      const api = actions();
      const request = {
        roomId,
        clientId: crypto.randomUUID(),
        body: withMention ? `<@${actors.admin.userId}> 원본` : "원본",
      };
      const first = await api.sendMessage(request);
      expect(first).toMatchObject({ ok: true, data: { seq: 1 } });
      const snapshot = () =>
        Promise.all([
          database.db.select().from(chatRooms).where(eq(chatRooms.id, roomId)),
          database.db.select().from(messages),
          database.db.select().from(messageMentions),
          database.db.select().from(notifications),
          database.db.select().from(chatRoomReads),
        ]);
      const before = await snapshot();
      expect(before[2]).toHaveLength(withMention ? 1 : 0);
      expect(before[3]).toEqual([]);
      publisher.publish.mockClear();
      publisher.publishMany.mockClear();

      expect(
        await api.sendMessage({
          ...request,
          body: `<@everyone> <@${actors.admin.userId}> 다른 본문`,
        }),
      ).toEqual(first);
      expect(await api.sendMessage({ ...request, body: null })).toEqual({
        ok: false,
        code: "INVALID_INPUT",
        fieldErrors: { body: [expect.any(String)] },
      });
      expect(await actions(actors.admin).sendMessage(request)).toEqual({
        ok: false,
        code: "INVALID_INPUT",
      });
      expect(await snapshot()).toEqual(before);
      expect(publisher.publish).not.toHaveBeenCalled();
      expect(publisher.publishMany).not.toHaveBeenCalled();
    },
  );

  it("returns current edited and deleted DM snapshots on retry without restoring mentions or publishing", async () => {
    const roomId = await open();
    const api = actions();
    const request = {
      roomId,
      clientId: crypto.randomUUID(),
      body: "원본",
    };
    const first = await api.sendMessage(request);
    if (!first.ok) throw new Error("Send failed");
    const edited = await api.editMessage({
      messageId: first.data.id,
      body: `<@${actors.admin.userId}> 수정한 본문`,
    });
    expect(edited).toMatchObject({ ok: true, data: { seq: 1 } });
    const snapshot = () =>
      Promise.all([
        database.db.select().from(chatRooms).where(eq(chatRooms.id, roomId)),
        database.db.select().from(messages),
        database.db.select().from(messageMentions),
        database.db.select().from(notifications),
      ]);
    const afterEdit = await snapshot();
    expect(afterEdit[2]).toHaveLength(1);
    publisher.publish.mockClear();
    publisher.publishMany.mockClear();
    expect(await api.sendMessage(request)).toEqual(edited);
    expect(await snapshot()).toEqual(afterEdit);
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(publisher.publishMany).not.toHaveBeenCalled();

    expect(await api.deleteMessage({ messageId: first.data.id })).toEqual({
      ok: true,
      data: { id: first.data.id },
    });
    const deleted = (await queries().getDirectMessageView(roomId))!
      .messages[0]!;
    expect(deleted).toMatchObject({
      id: first.data.id,
      seq: 1,
      body: "",
      mentions: [],
      deletedAt: now.toISOString(),
    });
    const afterDelete = await snapshot();
    expect(afterDelete[2]).toEqual([]);
    publisher.publish.mockClear();
    publisher.publishMany.mockClear();
    expect(
      await api.sendMessage({ ...request, body: "<@everyone> 재전송" }),
    ).toEqual({ ok: true, data: deleted });
    expect(await snapshot()).toEqual(afterDelete);
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(publisher.publishMany).not.toHaveBeenCalled();
  });

  it("excludes empty DMs and counts only other nondeleted messages after joining, capped at 100", async () => {
    const roomId = await open();
    expect((await queries().getMyChatNav()).directMessages).toEqual([]);
    await database.db.insert(messages).values(
      Array.from({ length: 110 }, (_, index) => ({
        roomId,
        seq: index + 1,
        authorId: actors.admin.userId,
        body: "안녕",
        createdAt: now,
      })),
    );
    await database.db
      .update(chatRooms)
      .set({ lastSeq: 110, lastMessageAt: now })
      .where(eq(chatRooms.id, roomId));
    let nav = (await queries().getMyChatNav()).directMessages;
    expect(nav[0]).toMatchObject({ roomId, unread: true, unreadCount: 100 });
    await database.db
      .update(messages)
      .set({ body: "", deletedAt: now })
      .where(eq(messages.roomId, roomId));
    nav = (await queries().getMyChatNav()).directMessages;
    expect(nav[0]).toMatchObject({ unread: false, unreadCount: 0 });
    expect(
      (await queries().getDirectMessageView(roomId))?.firstUnreadSeq,
    ).toBeNull();
    expect(JSON.stringify(nav)).not.toContain("email");
  });

  it("publishes read receipts only for an increased DM cursor and exposes the peer cursor in pages", async () => {
    const roomId = await open();
    await send(roomId);
    publisher.publish.mockClear();
    expect(
      await actions(actors.admin).markRoomRead({ roomId, seq: 100 }),
    ).toEqual({ ok: true, data: { lastReadSeq: 1 } });
    expect(publisher.publish).toHaveBeenCalledExactlyOnceWith(
      `room:${roomId}`,
      { type: "room.read", roomId, userId: actors.admin.userId, seq: 1 },
    );
    await actions(actors.admin).markRoomRead({ roomId, seq: 1 });
    await actions(actors.admin).markRoomRead({ roomId, seq: 0 });
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    expect(
      await queries().getRoomMessagesPage(roomId, { after: "0" }),
    ).toMatchObject({ peerReadSeq: 1 });
    expect(await queries().getDirectMessageView(roomId)).toMatchObject({
      peerReadSeq: 1,
    });
    expect(
      await queries().getRoomMessagesPage(actors.roomId, { after: "0" }),
    ).toMatchObject({ peerReadSeq: null });
    await actions().markRoomRead({ roomId: actors.roomId, seq: 0 });
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });

  it("mutes a DM without changing its read cursor and shares the same user-room-read lock order", async () => {
    const roomId = await open();
    await send(roomId, actors.admin);
    const statements = vi.spyOn(database.client, "query");
    try {
      expect(await actions().setRoomMuted({ roomId, muted: true })).toEqual({
        ok: true,
        data: { muted: true },
      });
      expect(
        statements.mock.calls.some(([statement]) =>
          /locked_user[\s\S]*locked_room[\s\S]*on conflict/i.test(statement),
        ),
      ).toBe(true);
    } finally {
      statements.mockRestore();
    }
    expect(
      await database.db
        .select()
        .from(chatRoomReads)
        .where(eq(chatRoomReads.userId, actors.member.userId)),
    ).toEqual([expect.objectContaining({ lastReadSeq: 0, muted: true })]);
    expect((await queries().getMyChatNav()).directMessages[0]).toMatchObject({
      muted: true,
      unreadCount: 1,
    });
  });

  it("keeps navigation, view and paged reads inside their SQL budgets", async () => {
    const roomId = await open();
    await send(roomId, actors.admin);
    const meter = createQueryMeter(database.client);
    try {
      for (const [query, expected] of [
        [() => queries().getMyChatNav(), [3]],
        [() => queries().getDirectMessageView(roomId), [1, 2]],
        [() => queries().getRoomMessagesPage(roomId, { before: "100" }), [2]],
      ] as const) {
        meter.start();
        await query();
        expect(meter.stop().perStage).toEqual(expected);
      }
    } finally {
      meter.restore();
    }
  });

  it("grants tokens only to actual DM members, never operators or strangers", async () => {
    const roomId = await open();
    for (const session of [
      actors.member,
      actors.admin,
      actors.operator,
      actors.outsider,
    ]) {
      const issue = vi.fn().mockResolvedValue({});
      await createRealtimeToken({
        database: database.db,
        requireSession: async () => session,
        getKey: () => "test:key",
        createTokenRequest: issue,
        limiter: createMemoryRateLimiter(),
      })({ rooms: [roomId] });
      const capabilities = issue.mock.calls[0]![0].capability;
      expect(capabilities[`room:${roomId}`]).toEqual(
        [actors.member, actors.admin].includes(session)
          ? ["subscribe", "presence"]
          : undefined,
      );
    }
  });

  it("rolls back a partially created DM and locks users in sorted order before room creation", async () => {
    const locks = vi.spyOn(chatWrite, "lockUsersForKeyShare");
    const original = directDal.createDirectRoom;
    const create = vi
      .spyOn(directDal, "createDirectRoom")
      .mockImplementation(async (...args) => {
        await original(...args);
        throw new Error("test rollback");
      });
    const logError = vi.fn();
    try {
      const result = await createChatActions({
        database: database.db,
        getSession: async () => actors.member,
        now: () => now,
        logError,
      }).openDirectMessage({ userId: actors.admin.userId });
      expect(result).toEqual({ ok: false, code: "INTERNAL" });
      expect(locks).toHaveBeenCalledWith(
        [actors.member.userId, actors.admin.userId],
        expect.anything(),
      );
      expect(locks.mock.invocationCallOrder[0]).toBeLessThan(
        create.mock.invocationCallOrder[0]!,
      );
      expect(await database.db.select().from(chatRoomMembers)).toEqual([]);
      expect(
        await database.db
          .select()
          .from(chatRooms)
          .where(eq(chatRooms.kind, "dm")),
      ).toEqual([]);
    } finally {
      create.mockRestore();
      locks.mockRestore();
    }
  });

  it("keeps established DM access after leaving the shared team and sorts user locks", async () => {
    const roomId = await open();
    await database.db
      .delete(teamMembers)
      .where(eq(teamMembers.userId, actors.member.userId));
    expect(await send(roomId)).toMatchObject({ seq: 1 });
    const calls = vi.spyOn(database.client, "query");
    try {
      await chatWrite.lockUsersForKeyShare(
        [actors.member.userId, actors.admin.userId].sort().reverse(),
        database.db,
      );
      expect(calls.mock.calls[0]![0]).toMatch(
        /order by "users"\."id" asc for key share/i,
      );
      expect(calls.mock.calls[0]![1]).toEqual(
        [actors.member.userId, actors.admin.userId].sort(),
      );
    } finally {
      calls.mockRestore();
    }
  });

  it("excludes own and pre-join messages, preserves current read state on idempotent room opens", async () => {
    const roomId = await open();
    const rows = [
      {
        authorId: actors.admin.userId,
        createdAt: new Date(chatNow.getTime() - 1),
      },
      { authorId: actors.admin.userId, createdAt: chatNow },
      { authorId: actors.member.userId, createdAt: now },
      { authorId: actors.admin.userId, createdAt: now },
    ];
    await database.db.insert(messages).values(
      rows.map((row, index) => ({
        ...row,
        roomId,
        body: "안녕",
        seq: index + 1,
      })),
    );
    await database.db
      .update(chatRooms)
      .set({ lastSeq: 4, lastMessageAt: now })
      .where(eq(chatRooms.id, roomId));
    expect((await queries().getMyChatNav()).directMessages[0]).toMatchObject({
      unreadCount: 1,
      unread: true,
    });
    expect(await queries().getDirectMessageView(roomId)).toMatchObject({
      firstUnreadSeq: 4,
    });
    await actions().markRoomRead({ roomId, seq: 4 });
    await actions().setRoomMuted({ roomId, muted: true });
    await open(actors.member, actors.admin, now);
    expect(await queries().getDirectMessageView(roomId)).toMatchObject({
      lastReadSeq: 4,
      room: { muted: true },
    });
  });

  it("keeps nav SQL constant with twenty DMs and sorts/caps at fifty", async () => {
    const meter = createQueryMeter(database.client);
    const baseline = async () => {
      meter.start();
      await queries().getMyChatNav();
      return meter.stop();
    };
    try {
      const initial = await baseline();
      const others = Array.from({ length: 51 }, (_, index) => ({
        id: crypto.randomUUID(),
        name: `친구${index}`,
        email: `friend${index}@floor.test`,
        emailVerified: true,
      }));
      await database.db.insert(users).values(others);
      const roomIds: string[] = [];
      for (const [index, other] of others.entries()) {
        const room = await directDal.createDirectRoom(
          [actors.member.userId, other.id],
          chatNow,
          database.db,
        );
        roomIds.push(room.roomId);
        await database.db
          .update(chatRooms)
          .set({
            lastSeq: 1,
            lastMessageAt: new Date(now.getTime() + index * 1000),
          })
          .where(eq(chatRooms.id, room.roomId));
        if (index === 19) expect(await baseline()).toEqual(initial);
      }
      const nav = await queries().getMyChatNav();
      expect(nav.directMessages.map((row) => row.roomId)).toEqual(
        roomIds.slice(1).reverse(),
      );
      expect(nav.directMessages).toHaveLength(50);
      expect(await baseline()).toEqual(initial);
    } finally {
      meter.restore();
    }
  });
});

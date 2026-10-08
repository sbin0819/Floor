import { and, eq, sql } from "drizzle-orm";
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
import { createChatActions } from "@/features/chat/action-factory";
import { createChatQueries } from "@/features/chat/query-factory";
import { canReadRoom } from "@/lib/dal/chat-access";
import * as writes from "@/lib/dal/chat-write";
import {
  createEmptyDirectRoom,
  initializeDirectMembers,
} from "@/lib/dal/direct-requests";
import * as schema from "@/lib/db/schema";
import {
  chatRoomMembers,
  chatRooms,
  friendships,
  messageMentions,
  messages,
  notifications,
  teamMembers,
  userBlocks,
  users,
} from "@/lib/db/schema";
import { createMemoryRateLimiter } from "@/lib/rate-limit/memory";
import type { RealtimeItem } from "@/lib/realtime/types";
import { chatNow, seedChatActors, type ChatActors } from "./chat-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

describe("message request lifecycle", () => {
  let database: TestDatabase;
  let actors: ChatActors;
  const statements: string[] = [];
  const events: RealtimeItem[] = [];
  const publisher = {
    publish: vi.fn(async (channel, event) => {
      events.push({ channel, event });
    }),
    publishMany: vi.fn(async (items: readonly RealtimeItem[]) => {
      events.push(...items);
    }),
  };
  const now = new Date(chatNow.getTime() + 60_000);
  const after = (days: number) => new Date(now.getTime() + days * 86_400_000);
  beforeAll(async () => {
    database = await createTestDatabase();
    database.db = drizzle({
      client: database.client,
      schema,
      logger: { logQuery: (text) => statements.push(text) },
    });
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    await database.db.execute(sql`truncate users, branches cascade`);
    actors = await seedChatActors(database);
    await database.db.update(users).set({ emailVerified: true });
    events.length = 0;
    statements.length = 0;
  });
  const actions = (session = actors.member, clock = now) =>
    createChatActions({
      database: database.db,
      getSession: async () => session,
      now: () => clock,
      publisher,
      limiter: createMemoryRateLimiter(),
      logError: vi.fn(),
    });
  const queries = (session = actors.member, clock = now) => {
    const source = createChatQueries({
      database: database.db,
      requireSession: async () => session,
      now: () => clock,
      limiter: createMemoryRateLimiter(),
    });
    return {
      ...source,
      async getDirectMessageView(roomId: string) {
        const view = await source.getDirectMessageView(roomId);
        if (view && view.kind !== "dm")
          throw new Error("Expected a one-to-one request room");
        return view;
      },
    };
  };
  async function request(
    session = actors.member,
    recipient = actors.outsider,
    clock = now,
    body = "대화하고 싶어요",
  ) {
    const result = await actions(session, clock).sendMessageRequest({
      userId: recipient.userId,
      clientId: crypto.randomUUID(),
      body,
    });
    if (!result.ok)
      throw new Error(`Request failed ${result.code}:${result.message}`);
    return result.data;
  }
  async function send(
    roomId: string,
    session = actors.member,
    clock = now,
    body = "추가 메시지",
  ) {
    return actions(session, clock).sendMessage({
      roomId,
      clientId: crypto.randomUUID(),
      body,
    });
  }
  const membership = async (roomId: string, userId: string) =>
    (
      await database.db
        .select()
        .from(chatRoomMembers)
        .where(
          and(
            eq(chatRoomMembers.roomId, roomId),
            eq(chatRoomMembers.userId, userId),
          ),
        )
    )[0]!;
  const accept = (roomId: string, value = true) =>
    actions(actors.outsider).respondMessageRequest({ roomId, accept: value });

  it("creates one request and person alert, hides it from recipient nav, and stores no pending mentions", async () => {
    const result = await request(
      actors.member,
      actors.outsider,
      now,
      `<@${actors.outsider.userId}> <@everyone> 인사`,
    );
    expect(await membership(result.roomId, actors.member.userId)).toMatchObject(
      { status: "active", requestedAt: null },
    );
    expect(
      await membership(result.roomId, actors.outsider.userId),
    ).toMatchObject({ status: "requested", requestedAt: now });
    expect(await database.db.select().from(notifications)).toMatchObject([
      {
        userId: actors.outsider.userId,
        actorId: actors.member.userId,
        type: "message_request",
        data: { actorName: actors.member.name },
      },
    ]);
    expect(await database.db.select().from(messageMentions)).toEqual([]);
    expect(result.message.mentionsEveryone).toBe(false);
    expect(events.map((item) => item.event.type).sort()).toEqual([
      "friend.changed",
      "message.created",
      "notifications.changed",
    ]);
    expect((await queries().getMyChatNav()).directMessages).toHaveLength(1);
    expect(
      (await queries(actors.outsider).getMyChatNav()).directMessages,
    ).toEqual([]);
    expect(
      (await queries().getDirectMessageView(result.roomId))?.request,
    ).toEqual({ role: "sender", sentCount: 1 });
    expect(
      (await queries(actors.outsider).getDirectMessageView(result.roomId))
        ?.request,
    ).toEqual({ role: "recipient" });
  });

  it.each(["requested", "declined"] as const)(
    "counts deleted messages within a %s request and enforces the third-message boundary",
    async (state) => {
      const result = await request();
      if (state === "declined") await accept(result.roomId, false);
      events.length = 0;
      expect(await send(result.roomId)).toMatchObject({ ok: true });
      expect(await send(result.roomId)).toMatchObject({ ok: true });
      await actions().deleteMessage({ messageId: result.message.id });
      expect(await send(result.roomId)).toEqual({
        ok: false,
        code: "LIMIT_EXCEEDED",
        message: "request_pending",
      });
      expect(
        (await queries().getDirectMessageView(result.roomId))?.request,
      ).toEqual({ role: "sender", sentCount: 3 });
      const toRecipient = events.filter(
        (item) => item.channel === `user:${actors.outsider.userId}`,
      );
      expect(toRecipient.map((item) => item.event.type)).toEqual(
        state === "requested" ? ["friend.changed", "friend.changed"] : [],
      );
      expect(
        await canReadRoom(actors.outsider.userId, result.roomId, database.db),
      ).toEqual(state === "declined" ? null : expect.anything());
    },
  );

  it.each(["requested", "declined"] as const)(
    "restarts %s at the same exact 30-day boundary with identical sender state and signals",
    async (state) => {
      const result = await request();
      if (state === "declined") await accept(result.roomId, false);
      await send(result.roomId);
      await send(result.roomId);
      const boundary = after(30);
      expect(
        await send(
          result.roomId,
          actors.member,
          new Date(boundary.getTime() - 1),
        ),
      ).toMatchObject({ ok: false, message: "request_pending" });
      expect(
        (
          await queries(actors.member, boundary).getDirectMessageView(
            result.roomId,
          )
        )?.request,
      ).toEqual({ role: "sender", sentCount: 0 });
      events.length = 0;
      expect(await send(result.roomId, actors.member, boundary)).toMatchObject({
        ok: true,
      });
      expect(
        await membership(result.roomId, actors.outsider.userId),
      ).toMatchObject({
        status: "requested",
        requestedAt: boundary,
        statusChangedAt: boundary,
      });
      expect(events.map((item) => item.event.type).sort()).toEqual([
        "friend.changed",
        "message.created",
        "notifications.changed",
      ]);
      expect(await database.db.select().from(notifications)).toHaveLength(1);
      expect(
        (
          await queries(actors.outsider, boundary).getRoomMessagesPage(
            result.roomId,
            { after: "0" },
          )
        ).messages,
      ).toHaveLength(4);
    },
  );

  it("accepts on the recipient's first response and then publishes ordinary activity", async () => {
    const result = await request();
    events.length = 0;
    expect(await send(result.roomId, actors.outsider)).toMatchObject({
      ok: true,
    });
    expect(
      await membership(result.roomId, actors.outsider.userId),
    ).toMatchObject({ status: "active", requestedAt: now });
    expect(await database.db.select().from(notifications)).toEqual([]);
    expect(events.map((item) => item.event.type).sort()).toEqual([
      "friend.changed",
      "message.created",
      "notifications.changed",
      "room.activity",
      "room.changed",
    ]);
    expect(
      (await queries().getDirectMessageView(result.roomId))?.request,
    ).toBeNull();
  });

  it("keeps pending request edits from creating personal or everyone mentions", async () => {
    const result = await request();
    events.length = 0;
    expect(
      await actions().editMessage({
        messageId: result.message.id,
        body: `<@${actors.outsider.userId}> <@everyone> 수정`,
      }),
    ).toMatchObject({
      ok: true,
      data: { mentions: [], mentionsEveryone: false },
    });
    expect(await database.db.select().from(messageMentions)).toEqual([]);
    expect(events.map((item) => item.event.type)).toEqual(["message.updated"]);
  });

  it.each([true, false])(
    "responds accept=%s only once and emits no decline signal to the sender",
    async (acceptValue) => {
      const result = await request();
      events.length = 0;
      expect(await accept(result.roomId, acceptValue)).toEqual({
        ok: true,
        data: {},
      });
      expect(await accept(result.roomId, acceptValue)).toEqual({
        ok: false,
        code: "NOT_FOUND",
      });
      expect(events.map((item) => item.event.type).sort()).toEqual(
        acceptValue
          ? ["friend.changed", "notifications.changed", "room.changed"]
          : ["notifications.changed", "realtime.reauth"],
      );
      if (!acceptValue)
        expect(
          events.every(
            (item) => item.channel === `user:${actors.outsider.userId}`,
          ),
        ).toBe(true);
      expect(await database.db.select().from(notifications)).toEqual([]);
    },
  );

  it("stores a requested recipient's read cursor without exposing it through events or either read DTO", async () => {
    const result = await request();
    events.length = 0;
    expect(
      await actions(actors.outsider).markRoomRead({
        roomId: result.roomId,
        seq: 1,
      }),
    ).toEqual({ ok: true, data: { lastReadSeq: 1 } });
    expect(events).toEqual([]);
    expect(
      (await queries().getDirectMessageView(result.roomId))?.peerReadSeq,
    ).toBe(0);
    expect(
      (await queries().getRoomMessagesPage(result.roomId, { after: "0" }))
        .peerReadSeq,
    ).toBe(0);
    await accept(result.roomId);
    expect(
      (await queries().getDirectMessageView(result.roomId))?.peerReadSeq,
    ).toBe(1);
  });

  it.each(["friend", "team"])(
    "promotes a pending request when users become %s-related before sending",
    async (relation) => {
      const result = await request();
      await accept(result.roomId, false);
      if (relation === "team")
        await database.db
          .insert(teamMembers)
          .values({ teamId: actors.teamId, userId: actors.outsider.userId });
      else {
        const [low, high] = [
          actors.member.userId,
          actors.outsider.userId,
        ].sort() as [string, string];
        await database.db.insert(friendships).values({
          userLowId: low,
          userHighId: high,
          requestedBy: low,
          status: "accepted",
          requestedAt: now,
          statusChangedAt: now,
        });
      }
      events.length = 0;
      expect(await send(result.roomId)).toMatchObject({ ok: true });
      expect(
        await membership(result.roomId, actors.outsider.userId),
      ).toMatchObject({ status: "active" });
      expect(
        (await queries().getDirectMessageView(result.roomId))?.request,
      ).toBeNull();
      expect(events.some((item) => item.event.type === "room.activity")).toBe(
        true,
      );
    },
  );

  it("treats a declined recipient's new request as ordinary messaging and lets related recipients reopen", async () => {
    const result = await request();
    await accept(result.roomId, false);
    expect(await send(result.roomId, actors.outsider)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect((await request(actors.outsider, actors.member)).roomId).toBe(
      result.roomId,
    );
    expect(
      await membership(result.roomId, actors.outsider.userId),
    ).toMatchObject({ status: "active" });
    await database.db
      .update(chatRoomMembers)
      .set({ status: "declined" })
      .where(
        and(
          eq(chatRoomMembers.roomId, result.roomId),
          eq(chatRoomMembers.userId, actors.outsider.userId),
        ),
      );
    await database.db
      .insert(teamMembers)
      .values({ teamId: actors.teamId, userId: actors.outsider.userId });
    expect(
      await actions(actors.outsider).openDirectMessage({
        userId: actors.member.userId,
      }),
    ).toEqual({ ok: true, data: { roomId: result.roomId } });
    expect(
      await membership(result.roomId, actors.outsider.userId),
    ).toMatchObject({ status: "active" });
  });

  it("creates a normal DM with no request for teammates", async () => {
    const result = await request(actors.member, actors.admin);
    expect(await membership(result.roomId, actors.admin.userId)).toMatchObject({
      status: "active",
      requestedAt: null,
    });
    expect(await database.db.select().from(notifications)).toEqual([]);
    expect(events.map((item) => item.event.type).sort()).toEqual([
      "message.created",
      "room.activity",
    ]);
  });

  it("counts accepted requests in the daily ten-person limit and allows the exact 24-hour boundary", async () => {
    const people = Array.from({ length: 11 }, (_, index) => ({
      userId: crypto.randomUUID(),
      name: `가상${index}`,
      email: `virtual${index}@floor.test`,
    }));
    await database.db.insert(users).values(
      people.map(({ userId, ...user }) => ({
        id: userId,
        ...user,
        emailVerified: true,
      })),
    );
    for (const person of people.slice(0, 10)) {
      const result = await request(actors.member, person);
      expect(
        await actions(person).respondMessageRequest({
          roomId: result.roomId,
          accept: true,
        }),
      ).toMatchObject({ ok: true });
    }
    expect(
      await actions().sendMessageRequest({
        userId: people[10]!.userId,
        clientId: crypto.randomUUID(),
        body: "열한번째",
      }),
    ).toEqual({ ok: false, code: "LIMIT_EXCEEDED", message: "request_daily" });
    expect(
      (await request(actors.member, people[10]!, after(1))).message.seq,
    ).toBe(1);
  });

  it("does not restart or notify on an old client-id retry at the cooldown boundary", async () => {
    const clientId = crypto.randomUUID();
    const input = { userId: actors.outsider.userId, clientId, body: "원문" };
    const result = await actions().sendMessageRequest(input);
    expect(result.ok).toBe(true);
    events.length = 0;
    const before = await database.db.select().from(chatRoomMembers);
    expect(
      await actions(actors.member, after(30)).sendMessageRequest({
        ...input,
        body: "다른 본문",
      }),
    ).toEqual(result);
    expect(events).toEqual([]);
    expect(await database.db.select().from(chatRoomMembers)).toEqual(before);
    expect(await database.db.select().from(messages)).toHaveLength(1);
    expect(await database.db.select().from(notifications)).toHaveLength(1);
  });

  it("uses the existing opposite request inserted in the user-lock window and accepts it", async () => {
    const original = writes.lockMessageUsers;
    vi.spyOn(writes, "lockMessageUsers").mockImplementationOnce(
      async (...args) => {
        await original(...args);
        const tx = args[2];
        const room = await createEmptyDirectRoom(
          actors.outsider.userId,
          actors.member.userId,
          now,
          tx,
        );
        await initializeDirectMembers(
          {
            roomId: room.roomId,
            senderId: actors.outsider.userId,
            recipientId: actors.member.userId,
            requested: true,
            now,
          },
          tx,
        );
        await writes.insertChatMessage(
          {
            roomId: room.roomId,
            clientId: crypto.randomUUID(),
            authorId: actors.outsider.userId,
            body: "먼저 온 인사",
            now,
          },
          tx,
        );
      },
    );
    const result = await request();
    expect(
      await database.db
        .select()
        .from(chatRooms)
        .where(eq(chatRooms.kind, "dm")),
    ).toHaveLength(1);
    expect(result.message.seq).toBe(2);
    expect(
      (await database.db.select().from(chatRoomMembers)).every(
        (row) => row.status === "active",
      ),
    ).toBe(true);
  });

  it("locks all user IDs once in sorted final-strength order before the room and keeps GET budgets", async () => {
    const result = await request();
    const locks = statements.filter((text) =>
      /for (update|key share)/i.test(text),
    );
    expect(locks[0]).toMatch(/from "users".*for (update|key share)/);
    expect(locks[1]).toMatch(/from "users".*for (update|key share)/);
    expect(locks[2]).toMatch(/from "chat_rooms".*for update/);
    expect(locks[3]).toMatch(/from "chat_room_members".*for update/);
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      await queries().getDirectMessageView(result.roomId);
      expect(meter.stop().perStage).toEqual([1, 2]);
      meter.start();
      await queries().getRoomMessagesPage(result.roomId, { after: "0" });
      expect(meter.stop().perStage).toEqual([2]);
    } finally {
      meter.restore();
    }
  });

  it("rolls back the new room, request, notification and cursor if message insertion fails", async () => {
    vi.spyOn(writes, "insertChatMessage").mockRejectedValueOnce(
      new Error("synthetic failure"),
    );
    expect(
      await actions().sendMessageRequest({
        userId: actors.outsider.userId,
        clientId: crypto.randomUUID(),
        body: "인사",
      }),
    ).toEqual({ ok: false, code: "INTERNAL" });
    expect(
      await database.db
        .select()
        .from(chatRooms)
        .where(eq(chatRooms.kind, "dm")),
    ).toEqual([]);
    expect(await database.db.select().from(chatRoomMembers)).toEqual([]);
    expect(await database.db.select().from(notifications)).toEqual([]);
    expect(events).toEqual([]);
  });

  it("rejects self, missing, unverified and blocked targets without exposing the blocking direction", async () => {
    const input = { clientId: crypto.randomUUID(), body: "인사" };
    expect(
      await actions().sendMessageRequest({
        ...input,
        userId: actors.member.userId,
      }),
    ).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(
      await actions().sendMessageRequest({
        ...input,
        userId: crypto.randomUUID(),
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    await database.db
      .update(users)
      .set({ emailVerified: false })
      .where(eq(users.id, actors.outsider.userId));
    expect(
      await actions().sendMessageRequest({
        ...input,
        userId: actors.outsider.userId,
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    await database.db.update(users).set({ emailVerified: true });
    for (const [blockerId, blockedId] of [
      [actors.member.userId, actors.outsider.userId],
      [actors.outsider.userId, actors.member.userId],
    ]) {
      await database.db
        .insert(userBlocks)
        .values({ blockerId: blockerId!, blockedId: blockedId! });
      expect(
        await actions().sendMessageRequest({
          ...input,
          userId: actors.outsider.userId,
        }),
      ).toEqual({ ok: false, code: "FORBIDDEN" });
      await database.db.delete(userBlocks);
    }
    expect(await database.db.select().from(notifications)).toEqual([]);
  });
});

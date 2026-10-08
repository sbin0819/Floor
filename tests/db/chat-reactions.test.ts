import { eq, sql } from "drizzle-orm";
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
import {
  createChatActions,
  type ChatActionDependencies,
} from "@/features/chat/action-factory";
import { createChatQueries } from "@/features/chat/query-factory";
import * as reactionDal from "@/lib/dal/chat-reactions";
import * as messageWrite from "@/lib/dal/chat-message-write";
import * as schema from "@/lib/db/schema";
import { chatRooms, messageReactions, messages } from "@/lib/db/schema";
import { createMemoryRateLimiter } from "@/lib/rate-limit/memory";
import { roomChannel, userChannel } from "@/lib/realtime/channels";
import { createMemoryRealtime } from "@/lib/realtime/memory";
import type { RealtimeEvent } from "@/lib/realtime/types";
import { chatNow, seedChatActors, type ChatActors } from "./chat-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("message reactions", () => {
  let database: TestDatabase;
  let actors: ChatActors;
  let realtime: ReturnType<typeof createMemoryRealtime>;
  const delivered: { channel: string; event: RealtimeEvent }[] = [];
  const queries: { text: string; params: unknown[] }[] = [];
  const logError = vi.fn();
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
  beforeEach(async () => {
    vi.restoreAllMocks();
    logError.mockReset();
    await database.db.execute(sql`truncate users, branches cascade`);
    actors = await seedChatActors(database);
    realtime = createMemoryRealtime();
    delivered.length = 0;
    queries.length = 0;
    for (const channel of [
      roomChannel(actors.roomId),
      ...[actors.admin, actors.member, actors.outsider].map(({ userId }) =>
        userChannel(userId),
      ),
    ])
      realtime.subscribe(channel, (event) =>
        delivered.push({ channel, event }),
      );
  });
  const actions = (
    session = actors.member,
    extra: ChatActionDependencies = {},
  ) =>
    createChatActions({
      database: database.db,
      getSession: async () => session,
      now: () => chatNow,
      limiter: createMemoryRateLimiter(() => chatNow.getTime()),
      publisher: realtime,
      logError,
      ...extra,
    });
  async function sent(
    body = "처음 메시지",
    session = actors.member,
    replyToId?: string,
  ) {
    const result = await actions(session).sendMessage({
      roomId: actors.roomId,
      clientId: crypto.randomUUID(),
      body,
      ...(replyToId ? { replyToId } : {}),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected send failure: ${result.code}`);
    delivered.length = 0;
    return result.data;
  }
  const page = (session = actors.member) =>
    createChatQueries({
      database: database.db,
      requireSession: async () => session,
      now: () => chatNow,
    }).getRoomMessagesPage(actors.roomId, { after: "0" });

  it("sets reactions idempotently, counts multiple actors and only publishes actual changes", async () => {
    const message = await sent();
    const input = { messageId: message.id, emoji: "heart", on: true };
    expect(await actions().setReaction(input)).toMatchObject({
      ok: true,
      data: { count: 1, mine: true },
    });
    expect(await actions().setReaction(input)).toMatchObject({
      ok: true,
      data: { count: 1, mine: true },
    });
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toEqual({
      channel: roomChannel(actors.roomId),
      event: {
        type: "reaction.changed",
        roomId: actors.roomId,
        messageId: message.id,
        emoji: "heart",
        userId: actors.member.userId,
        added: true,
        count: 1,
      },
    });
    expect(await actions(actors.admin).setReaction(input)).toMatchObject({
      ok: true,
      data: { count: 2, mine: true },
    });
    expect(await actions().setReaction({ ...input, on: false })).toMatchObject({
      ok: true,
      data: { count: 1, mine: false },
    });
    expect(await actions().setReaction({ ...input, on: false })).toMatchObject({
      ok: true,
      data: { count: 1, mine: false },
    });
    expect(delivered).toHaveLength(3);
    expect(
      await actions().setReaction({ ...input, emoji: "pray" }),
    ).toMatchObject({ ok: true, data: { count: 1, mine: true } });
    expect(await database.db.select().from(messageReactions)).toHaveLength(2);
  });

  it("allows reactions in admin-only channels but rejects unreadable, archived and deleted targets", async () => {
    const message = await sent();
    const input = { messageId: message.id, emoji: "thumbs_up", on: true };
    expect(await actions(actors.outsider).setReaction(input)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(
      await actions().setReaction({ ...input, emoji: "invalid" }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await database.db
      .update(chatRooms)
      .set({ adminOnly: true })
      .where(eq(chatRooms.id, actors.roomId));
    expect(await actions().setReaction(input)).toMatchObject({ ok: true });
    await database.db
      .update(chatRooms)
      .set({ archivedAt: chatNow })
      .where(eq(chatRooms.id, actors.roomId));
    expect(await actions().setReaction({ ...input, on: false })).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    await database.db
      .update(chatRooms)
      .set({ archivedAt: null })
      .where(eq(chatRooms.id, actors.roomId));
    await actions().deleteMessage({ messageId: message.id });
    expect(await actions().setReaction(input)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await actions().setReaction({ ...input, on: false })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
  });

  it("limits reactions to thirty requests per ten seconds including idempotent attempts", async () => {
    const message = await sent();
    let now = chatNow.getTime();
    const api = actions(actors.member, {
      limiter: createMemoryRateLimiter(() => now),
    });
    const input = { messageId: message.id, emoji: "check", on: true };
    for (let index = 0; index < 30; index++)
      expect(await api.setReaction(input)).toMatchObject({ ok: true });
    expect(await api.setReaction(input)).toEqual({
      ok: false,
      code: "LIMIT_EXCEEDED",
      message: "reaction_rate",
    });
    now += 10_000;
    expect(await api.setReaction(input)).toMatchObject({ ok: true });
    expect(await database.db.select().from(messageReactions)).toHaveLength(1);
    expect(delivered).toHaveLength(1);
  });

  it("exposes counts, bounded names and each viewer's own reaction without email or user lists", async () => {
    const message = await sent();
    expect(
      await actions().setReaction({
        messageId: message.id,
        emoji: "pray",
        on: true,
      }),
    ).toMatchObject({ ok: true });
    const mine = (await page()).messages[0]?.reactions;
    expect(mine).toEqual([
      { emoji: "pray", count: 1, mine: true, names: [actors.member.name] },
    ]);
    const theirs = (await page(actors.admin)).messages[0]?.reactions;
    expect(theirs).toEqual([
      { emoji: "pray", count: 1, mine: false, names: [actors.member.name] },
    ]);
    expect(JSON.stringify({ mine, theirs })).not.toContain(actors.member.email);
    expect(JSON.stringify({ mine, theirs })).not.toContain(
      actors.member.userId,
    );
  });

  it("locks the user before the room and shares the live message row before inserting", async () => {
    const message = await sent();
    queries.length = 0;
    expect(
      await actions().setReaction({
        messageId: message.id,
        emoji: "heart",
        on: true,
      }),
    ).toMatchObject({ ok: true });
    const userLock = queries.findIndex(
      ({ text }) => /from "users"/i.test(text) && /for key share/i.test(text),
    );
    const roomLock = queries.findIndex(
      ({ text }) => /from "chat_rooms"/i.test(text) && /for update/i.test(text),
    );
    const messageLock = queries.findIndex(
      ({ text }) => /from "messages"/i.test(text) && /for share/i.test(text),
    );
    expect(userLock).toBeGreaterThan(-1);
    expect(roomLock).toBeGreaterThan(userLock);
    expect(messageLock).toBeGreaterThan(roomLock);
    const insert = queries.find(({ text }) =>
      /^insert into "message_reactions"/i.test(text),
    );
    expect(insert?.text).toMatch(/"deleted_at" is null/i);
    expect(insert?.text).toMatch(/for share/i);
    expect(insert?.text).toMatch(/on conflict do nothing/i);
  });

  it("rejects a message removed between access confirmation and reaction insertion", async () => {
    const message = await sent();
    const setReaction = reactionDal.setMessageReaction;
    vi.spyOn(reactionDal, "setMessageReaction").mockImplementationOnce(
      async (input, transaction) => {
        await transaction
          .update(messages)
          .set({
            body: "",
            deletedAt: chatNow,
            deletedBy: actors.member.userId,
          })
          .where(eq(messages.id, input.messageId));
        return setReaction(input, transaction);
      },
    );
    expect(
      await actions().setReaction({
        messageId: message.id,
        emoji: "heart",
        on: true,
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await database.db.select().from(messageReactions)).toEqual([]);
    expect(delivered).toEqual([]);
  });

  it("removes a reaction inserted immediately before message deletion", async () => {
    const message = await sent();
    const removeMessage = messageWrite.deleteChatMessage;
    vi.spyOn(messageWrite, "deleteChatMessage").mockImplementationOnce(
      async (input, transaction) => {
        await reactionDal.setMessageReaction(
          {
            messageId: input.id,
            userId: actors.admin.userId,
            emoji: "heart",
            on: true,
            now: chatNow,
          },
          transaction,
        );
        expect(await transaction.select().from(messageReactions)).toHaveLength(
          1,
        );
        return removeMessage(input, transaction);
      },
    );
    expect(
      await actions().deleteMessage({ messageId: message.id }),
    ).toMatchObject({ ok: true });
    expect(await database.db.select().from(messageReactions)).toEqual([]);
    expect((await page()).messages[0]).toMatchObject({
      body: "",
      deletedAt: chatNow.toISOString(),
      reactions: [],
    });
  });

  it("rolls back a stored reaction and never publishes when a later operation fails", async () => {
    const message = await sent();
    const setReaction = reactionDal.setMessageReaction;
    vi.spyOn(reactionDal, "setMessageReaction").mockImplementationOnce(
      async (...args) => {
        await setReaction(...args);
        throw new Error("private reaction SQL failure");
      },
    );
    expect(
      await actions().setReaction({
        messageId: message.id,
        emoji: "heart",
        on: true,
      }),
    ).toEqual({ ok: false, code: "INTERNAL" });
    expect(await database.db.select().from(messageReactions)).toEqual([]);
    expect(delivered).toEqual([]);
    expect(JSON.stringify(logError.mock.calls)).not.toContain(
      "private reaction SQL failure",
    );
  });

  it("preserves the committed reaction when its realtime event fails", async () => {
    const message = await sent();
    const publish = vi.fn(async () => {
      throw new Error("private realtime failure");
    });
    const api = actions(actors.member, {
      publisher: { publish, publishMany: publish },
    });
    expect(
      await api.setReaction({
        messageId: message.id,
        emoji: "heart",
        on: true,
      }),
    ).toMatchObject({ ok: true, data: { count: 1, mine: true } });
    expect(await database.db.select().from(messageReactions)).toHaveLength(1);
    expect(logError).toHaveBeenCalled();
    expect(JSON.stringify(logError.mock.calls)).not.toContain(
      "private realtime failure",
    );
  });
});

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
import { createChatActions } from "@/features/chat/action-factory";
import { createChatQueries } from "@/features/chat/query-factory";
import { emptyMessageDetails } from "@/features/chat/types";
import { avatarColorFor } from "@/lib/avatar";
import * as readDal from "@/lib/dal/chat-reads";
import * as schema from "@/lib/db/schema";
import {
  chatRoomReads,
  chatRooms,
  messageMentions,
  messageReactions,
  messages,
  teamMembers,
  users,
} from "@/lib/db/schema";
import { createMemoryRateLimiter } from "@/lib/rate-limit/memory";
import {
  roomChannel,
  spaceChannel,
  userChannel,
} from "@/lib/realtime/channels";
import { createMemoryRealtime } from "@/lib/realtime/memory";
import type { RealtimeEvent } from "@/lib/realtime/types";
import { chatNow, seedChatActors, type ChatActors } from "./chat-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

describe("message replies and mentions", () => {
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
      spaceChannel(actors.spaceId),
      ...[actors.admin, actors.member, actors.outsider, actors.operator].map(
        ({ userId }) => userChannel(userId),
      ),
    ])
      realtime.subscribe(channel, (event) =>
        delivered.push({ channel, event }),
      );
  });

  const actions = (session = actors.member) =>
    createChatActions({
      database: database.db,
      getSession: async () => session,
      now: () => chatNow,
      limiter: createMemoryRateLimiter(() => chatNow.getTime()),
      publisher: realtime,
      logError,
    });
  const input = (
    body: string,
    extra: { roomId?: string; replyToId?: string } = {},
  ) => ({
    roomId: actors.roomId,
    clientId: crypto.randomUUID(),
    body,
    ...extra,
  });
  const read = (session = actors.member) =>
    createChatQueries({
      database: database.db,
      requireSession: async () => session,
      now: () => chatNow,
      limiter: createMemoryRateLimiter(() => chatNow.getTime()),
    });
  async function sent(
    body: string,
    session = actors.member,
    extra: { roomId?: string; replyToId?: string } = {},
  ) {
    const result = await actions(session).sendMessage(input(body, extra));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected send failure: ${result.code}`);
    return result.data;
  }
  const mentions = () =>
    delivered.filter(({ event }) => event.type === "mention.created");

  it("returns the same complete reply details in the action, page, channel and event", async () => {
    const original = await sent("검토할 원문이에요", actors.admin);
    const reply = await sent("답장이에요", actors.member, {
      replyToId: original.id,
    });
    expect(reply).toEqual({
      ...emptyMessageDetails(),
      id: expect.any(String),
      seq: 2,
      authorId: actors.member.userId,
      authorName: actors.member.name,
      authorAvatar: {
        color: avatarColorFor(actors.member.userId, null),
        photoUrl: null,
      },
      kind: "text",
      body: "답장이에요",
      clientId: expect.any(String),
      createdAt: chatNow.toISOString(),
      replyTo: {
        attachmentSummary: null,
        id: original.id,
        authorName: actors.admin.name,
        excerpt: "검토할 원문이에요",
        deleted: false,
      },
    });
    const page = await read().getRoomMessagesPage(actors.roomId, {
      after: "0",
    });
    expect(page.messages[1]).toEqual(reply);
    const view = await read().getChannelView(actors.spaceId, actors.roomId);
    expect(view).not.toBeNull();
    if (!view) throw new Error("Expected readable channel");
    expect(view.messages[1]).toEqual(reply);
    expect(delivered).toContainEqual({
      channel: roomChannel(actors.roomId),
      event: { type: "message.created", roomId: actors.roomId, ...reply },
    });
    for (const actor of [actors.admin, actors.member]) {
      expect(JSON.stringify(page)).not.toContain(actor.email);
      expect(JSON.stringify(delivered)).not.toContain(actor.email);
    }
  });

  it("rejects a missing or different-room reply without allocating a sequence", async () => {
    const other = await sent("다른 방 원문", actors.member, {
      roomId: actors.secondRoomId,
    });
    delivered.length = 0;
    for (const replyToId of [other.id, crypto.randomUUID()])
      expect(await actions().sendMessage(input("답장", { replyToId }))).toEqual(
        {
          ok: false,
          code: "INVALID_INPUT",
        },
      );
    const [room] = await database.db
      .select()
      .from(chatRooms)
      .where(eq(chatRooms.id, actors.roomId));
    expect(room?.lastSeq).toBe(0);
    expect(await database.db.select().from(messages)).toHaveLength(1);
    expect(delivered).toEqual([]);
  });

  it("aggregates bounded reaction names and viewer-specific flags without additional page queries", async () => {
    const original = await sent("원문", actors.admin);
    const reply = await sent(
      `<@${actors.admin.userId}> 확인했어요`,
      actors.member,
      { replyToId: original.id },
    );
    const reactingUsers = await database.db
      .insert(users)
      .values(
        Array.from({ length: 11 }, (_, index) => ({
          name: `반응자${index}`,
          email: `reaction-${index}@example.test`,
        })),
      )
      .returning();
    await database.db
      .insert(teamMembers)
      .values(
        reactingUsers.map(({ id }) => ({ teamId: actors.teamId, userId: id })),
      );
    const reactionActors = [
      { id: actors.member.userId, name: actors.member.name },
      ...reactingUsers,
    ];
    await database.db.insert(messageReactions).values(
      reactionActors.map(({ id }, index) => ({
        messageId: reply.id,
        userId: id,
        emoji: "heart" as const,
        createdAt: new Date(chatNow.getTime() + index),
      })),
    );
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      const page = await read().getRoomMessagesPage(actors.roomId, {
        before: "3",
      });
      expect(meter.stop()).toEqual({ stages: 1, statements: 2, perStage: [2] });
      expect(page.messages[1]).toEqual({
        ...reply,
        reactions: [
          {
            emoji: "heart",
            count: 12,
            mine: true,
            names: reactionActors.slice(0, 10).map(({ name }) => name),
          },
        ],
      });
      meter.start();
      const adminPage = await read(actors.admin).getRoomMessagesPage(
        actors.roomId,
        { before: "3" },
      );
      expect(meter.stop()).toEqual({ stages: 1, statements: 2, perStage: [2] });
      expect(adminPage.messages[1]).toEqual({
        ...page.messages[1],
        clientId: null,
        reactions: [{ ...page.messages[1]!.reactions[0], mine: false }],
      });
      for (const user of reactingUsers)
        expect(JSON.stringify(page)).not.toContain(user.email);
      for (const actor of [actors.admin, actors.member])
        expect(JSON.stringify(page)).not.toContain(actor.email);
      expect(Object.keys(page.messages[1]!).sort()).toEqual(
        [
          "attachments",
          "authorAvatar",
          "id",
          "systemData",
          "seq",
          "authorId",
          "authorName",
          "kind",
          "body",
          "createdAt",
          "clientId",
          "replyTo",
          "mentions",
          "mentionsEveryone",
          "editedAt",
          "deletedAt",
          "reactions",
        ].sort(),
      );
    } finally {
      meter.restore();
    }
  });

  it("allows replying to a deleted message without disclosing its former body", async () => {
    const original = await sent("삭제 전 비공개 원문", actors.admin);
    await database.db
      .update(messages)
      .set({ body: "", deletedAt: chatNow, deletedBy: actors.admin.userId })
      .where(eq(messages.id, original.id));
    delivered.length = 0;
    const reply = await sent("삭제된 글에 답장", actors.member, {
      replyToId: original.id,
    });
    expect(reply.replyTo).toMatchObject({ id: original.id, deleted: true });
    const page = await read().getRoomMessagesPage(actors.roomId, {
      after: "0",
    });
    expect(page.messages[1]?.replyTo).toEqual(reply.replyTo);
    expect(JSON.stringify({ reply, page, delivered })).not.toContain(
      "삭제 전 비공개 원문",
    );
  });

  it("deduplicates mentions and excludes the sender and users outside the room", async () => {
    const body = `<@${actors.admin.userId}> <@${actors.admin.userId}> <@${actors.member.userId}> <@${actors.outsider.userId}>`;
    const message = await sent(body);
    expect(message.body).toBe(body);
    expect(message.mentions).toEqual([
      { userId: actors.admin.userId, name: actors.admin.name },
    ]);
    expect(
      await database.db
        .select({ userId: messageMentions.userId })
        .from(messageMentions),
    ).toEqual([{ userId: actors.admin.userId }]);
    expect(mentions()).toHaveLength(1);
    expect(mentions()[0]).toMatchObject({
      channel: userChannel(actors.admin.userId),
      event: {
        type: "mention.created",
        messageId: message.id,
        authorName: actors.member.name,
      },
    });
    expect(
      delivered.filter(
        ({ channel }) => channel === userChannel(actors.outsider.userId),
      ),
    ).toEqual([]);
  });

  it("enforces twenty distinct mention tokens before membership filtering", async () => {
    const ids = Array.from({ length: 21 }, () => crypto.randomUUID());
    const body = ids.map((id) => `<@${id}>`).join(" ");
    expect(await actions().sendMessage(input(body))).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect(await database.db.select().from(messages)).toEqual([]);
    expect(delivered).toEqual([]);
    const allowed = await sent(
      ids
        .slice(0, 20)
        .map((id) => `<@${id}>`)
        .join(" "),
    );
    expect(allowed.mentions).toEqual([]);
    const repeated = await sent(
      Array.from({ length: 25 }, () => `<@${actors.admin.userId}>`).join(" "),
    );
    expect(repeated.mentions).toEqual([
      { userId: actors.admin.userId, name: actors.admin.name },
    ]);
  });

  it("treats a member's everyone token as text, while admin everyone and direct mention notify each peer once", async () => {
    const plain = await sent("<@everyone> 공지예요");
    expect(plain.mentionsEveryone).toBe(false);
    expect(plain.body).toContain("<@everyone>");
    expect(mentions()).toEqual([]);
    delivered.length = 0;
    const adminMessage = await sent(
      `<@everyone> <@${actors.member.userId}> <@${actors.admin.userId}> 공지예요`,
      actors.admin,
    );
    expect(adminMessage.mentionsEveryone).toBe(true);
    expect(adminMessage.mentions).toEqual([
      { userId: actors.member.userId, name: actors.member.name },
    ]);
    expect(mentions()).toHaveLength(1);
    expect(mentions()[0]?.channel).toBe(userChannel(actors.member.userId));
    expect(
      await database.db
        .select({ userId: messageMentions.userId })
        .from(messageMentions),
    ).toEqual([{ userId: actors.member.userId }]);
  });

  it("locks all users in UUID order before the room and does not relock duplicate mentions", async () => {
    const [third] = await database.db
      .insert(users)
      .values({ name: "추가 팀원", email: "third@example.test" })
      .returning();
    if (!third) throw new Error("Missing test actor");
    await database.db
      .insert(teamMembers)
      .values({ teamId: actors.teamId, userId: third.id });
    queries.length = 0;
    await sent(`<@${third.id}> <@${actors.admin.userId}> <@${third.id}>`);
    const userLocks = queries.filter(
      ({ text }) => /from "users"/i.test(text) && /for key share/i.test(text),
    );
    const ids = [actors.member.userId, actors.admin.userId, third.id];
    const lockedIds = userLocks.flatMap(({ params }) =>
      params
        .flat()
        .filter(
          (value): value is string =>
            typeof value === "string" && ids.includes(value),
        ),
    );
    expect(lockedIds).toEqual([...ids].sort());
    const roomLock = queries.findIndex(
      ({ text }) => /from "chat_rooms"/i.test(text) && /for update/i.test(text),
    );
    expect(roomLock).toBeGreaterThan(-1);
    for (const lock of userLocks)
      expect(queries.indexOf(lock)).toBeLessThan(roomLock);
  });

  it("rolls back the message, mentions, room sequence and read cursor together", async () => {
    const advance = readDal.advanceRoomRead;
    vi.spyOn(readDal, "advanceRoomRead").mockImplementationOnce(
      async (cursor, transaction) => {
        if (!transaction) throw new Error("Expected transaction");
        expect(await transaction.select().from(messageMentions)).toHaveLength(
          1,
        );
        await advance(cursor, transaction);
        throw new Error("private transaction failure");
      },
    );
    expect(
      await actions().sendMessage(
        input(`<@${actors.admin.userId}> 함께 확인해 주세요`),
      ),
    ).toEqual({ ok: false, code: "INTERNAL" });
    expect(await database.db.select().from(messages)).toEqual([]);
    expect(await database.db.select().from(messageMentions)).toEqual([]);
    expect(await database.db.select().from(chatRoomReads)).toEqual([]);
    const [room] = await database.db
      .select()
      .from(chatRooms)
      .where(eq(chatRooms.id, actors.roomId));
    expect(room).toMatchObject({ lastSeq: 0, lastMessageAt: null });
    expect(delivered).toEqual([]);
    expect(JSON.stringify(logError.mock.calls)).not.toContain(
      "private transaction failure",
    );
  });
});

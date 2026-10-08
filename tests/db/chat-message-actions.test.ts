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
import * as schema from "@/lib/db/schema";
import {
  chatRooms,
  messageMentions,
  messageReactions,
  messages,
  teamMembers,
} from "@/lib/db/schema";
import { createMemoryRateLimiter } from "@/lib/rate-limit/memory";
import { roomChannel, userChannel } from "@/lib/realtime/channels";
import { createMemoryRealtime } from "@/lib/realtime/memory";
import type { RealtimeEvent } from "@/lib/realtime/types";
import { chatNow, seedChatActors, type ChatActors } from "./chat-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("message edit and deletion", () => {
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
  const mentionEvents = () =>
    delivered.filter(({ event }) => event.type === "mention.created");

  it("edits only the author's live message and keeps its identity and sequence", async () => {
    const message = await sent();
    for (const actor of [actors.admin, actors.outsider])
      expect(
        await actions(actor).editMessage({
          messageId: message.id,
          body: "변경",
        }),
      ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(
      await actions().editMessage({
        messageId: message.id,
        body: " 바꾼 메시지 ",
      }),
    ).toMatchObject({ ok: true });
    const [saved] = await database.db
      .select()
      .from(messages)
      .where(eq(messages.id, message.id));
    expect(saved).toMatchObject({
      id: message.id,
      seq: message.seq,
      body: "바꾼 메시지",
      editedAt: chatNow,
      authorId: actors.member.userId,
    });
    expect(delivered).toEqual([
      {
        channel: roomChannel(actors.roomId),
        event: {
          type: "message.updated",
          roomId: actors.roomId,
          id: message.id,
          seq: message.seq,
          body: "바꾼 메시지",
          mentions: [],
          mentionsEveryone: false,
          editedAt: chatNow.toISOString(),
        },
      },
    ]);
    await database.db
      .update(chatRooms)
      .set({ archivedAt: chatNow })
      .where(eq(chatRooms.id, actors.roomId));
    expect(
      await actions().editMessage({ messageId: message.id, body: "읽기 전용" }),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("replaces mention rows and notifies only newly mentioned unread recipients", async () => {
    await database.db
      .insert(teamMembers)
      .values({
        teamId: actors.teamId,
        userId: actors.outsider.userId,
        createdAt: new Date("2026-10-01T00:00:00Z"),
      });
    const message = await sent(`<@${actors.member.userId}> 원문`, actors.admin);
    expect(
      await actions(actors.admin).editMessage({
        messageId: message.id,
        body: `<@${actors.member.userId}> <@${actors.outsider.userId}> 새 내용`,
      }),
    ).toMatchObject({ ok: true });
    expect(mentionEvents()).toHaveLength(1);
    expect(mentionEvents()[0]?.channel).toBe(
      userChannel(actors.outsider.userId),
    );
    expect(
      (
        await database.db
          .select({ userId: messageMentions.userId })
          .from(messageMentions)
      )
        .map(({ userId }) => userId)
        .sort(),
    ).toEqual([actors.member.userId, actors.outsider.userId].sort());
    delivered.length = 0;
    expect(
      await actions(actors.admin).editMessage({
        messageId: message.id,
        body: `<@${actors.outsider.userId}> 한 사람만`,
      }),
    ).toMatchObject({ ok: true });
    expect(mentionEvents()).toEqual([]);
    expect(
      await database.db
        .select({ userId: messageMentions.userId })
        .from(messageMentions),
    ).toEqual([{ userId: actors.outsider.userId }]);
  });

  it("does not notify a newly mentioned user who already read the edited sequence", async () => {
    const message = await sent("알림 없는 원문", actors.admin);
    expect(
      await actions().markRoomRead({ roomId: actors.roomId, seq: message.seq }),
    ).toMatchObject({ ok: true });
    delivered.length = 0;
    expect(
      await actions(actors.admin).editMessage({
        messageId: message.id,
        body: `<@${actors.member.userId}> 바뀐 글`,
      }),
    ).toMatchObject({ ok: true });
    expect(mentionEvents()).toEqual([]);
    expect(
      await database.db
        .select({ userId: messageMentions.userId })
        .from(messageMentions),
    ).toEqual([{ userId: actors.member.userId }]);
  });

  it("does not notify a new member about a message created before they joined", async () => {
    const message = await sent("가입 전 원문", actors.admin);
    await database.db
      .insert(teamMembers)
      .values({
        teamId: actors.teamId,
        userId: actors.outsider.userId,
        createdAt: new Date(chatNow.getTime() + 1),
      });
    expect(
      await actions(actors.admin).editMessage({
        messageId: message.id,
        body: `<@${actors.outsider.userId}> 예전 글 수정`,
      }),
    ).toMatchObject({ ok: true });
    expect(mentionEvents()).toEqual([]);
    expect(
      await database.db
        .select({ userId: messageMentions.userId })
        .from(messageMentions),
    ).toEqual([{ userId: actors.outsider.userId }]);
  });

  it("only notifies on a newly enabled admin everyone mention and deduplicates direct mentions", async () => {
    const message = await sent("원문", actors.admin);
    const body = `<@everyone> <@${actors.member.userId}> 공지`;
    expect(
      await actions(actors.admin).editMessage({ messageId: message.id, body }),
    ).toMatchObject({ ok: true });
    expect(mentionEvents()).toHaveLength(1);
    expect(mentionEvents()[0]?.channel).toBe(userChannel(actors.member.userId));
    delivered.length = 0;
    expect(
      await actions(actors.admin).editMessage({
        messageId: message.id,
        body: body + " 수정",
      }),
    ).toMatchObject({ ok: true });
    expect(mentionEvents()).toEqual([]);
    expect(
      await actions(actors.admin).editMessage({
        messageId: message.id,
        body: "멘션 없음",
      }),
    ).toMatchObject({ ok: true });
    expect(mentionEvents()).toEqual([]);
    expect((await page()).messages[0]?.mentionsEveryone).toBe(false);
  });

  it("shares the send rate between sends and edits, and validates before allocating writes", async () => {
    const message = await sent();
    let now = chatNow.getTime();
    const api = actions(actors.member, {
      limiter: createMemoryRateLimiter(() => now),
    });
    for (let index = 0; index < 5; index++) {
      expect(
        await api.sendMessage({
          roomId: actors.roomId,
          clientId: crypto.randomUUID(),
          body: "새 글",
        }),
      ).toMatchObject({ ok: true });
      expect(
        await api.editMessage({ messageId: message.id, body: `수정 ${index}` }),
      ).toMatchObject({ ok: true });
    }
    expect(
      await api.editMessage({ messageId: message.id, body: "다음" }),
    ).toEqual({ ok: false, code: "LIMIT_EXCEEDED", message: "send_rate" });
    now += 10_000;
    expect(
      await api.editMessage({ messageId: message.id, body: "다음" }),
    ).toMatchObject({ ok: true });
    for (const body of [
      " ",
      "😀".repeat(4001),
      Array.from({ length: 21 }, () => `<@${crypto.randomUUID()}>`).join(" "),
    ])
      expect(
        await api.editMessage({ messageId: message.id, body }),
      ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect((await page()).messages[0]?.body).toBe("다음");
  });

  it("deletes content, reactions and mentions atomically without leaking the former body", async () => {
    const message = await sent(`<@${actors.admin.userId}> 비공개 원문`);
    const reply = await sent("답장이에요", actors.admin, message.id);
    await database.db.insert(messageReactions).values({
      messageId: message.id,
      userId: actors.admin.userId,
      emoji: "heart",
    });
    expect(
      await actions().deleteMessage({ messageId: message.id }),
    ).toMatchObject({ ok: true });
    expect(delivered).toEqual([
      {
        channel: roomChannel(actors.roomId),
        event: {
          type: "message.deleted",
          roomId: actors.roomId,
          id: message.id,
          seq: message.seq,
        },
      },
    ]);
    expect(await database.db.select().from(messageMentions)).toEqual([]);
    expect(await database.db.select().from(messageReactions)).toEqual([]);
    const result = await page();
    expect(result.messages[0]).toMatchObject({
      id: message.id,
      seq: message.seq,
      body: "",
      mentions: [],
      reactions: [],
      mentionsEveryone: false,
      deletedAt: chatNow.toISOString(),
    });
    expect(result.messages[1]).toMatchObject({
      id: reply.id,
      replyTo: { id: message.id, excerpt: "삭제된 메시지예요", deleted: true },
    });
    expect(JSON.stringify({ result, delivered })).not.toContain("비공개 원문");
    delivered.length = 0;
    expect(
      await actions().deleteMessage({ messageId: message.id }),
    ).toMatchObject({ ok: true });
    expect(delivered).toEqual([]);
    expect(
      await actions().editMessage({ messageId: message.id, body: "되살리기" }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("permits owner and admin deletion in archived rooms but hides unauthorized targets", async () => {
    const memberMessage = await sent("팀원 글");
    const adminMessage = await sent("관리자 글", actors.admin);
    expect(
      await actions().deleteMessage({ messageId: adminMessage.id }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(
      await actions(actors.outsider).deleteMessage({
        messageId: memberMessage.id,
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    await database.db
      .update(chatRooms)
      .set({ archivedAt: chatNow })
      .where(eq(chatRooms.id, actors.roomId));
    expect(
      await actions(actors.admin).deleteMessage({
        messageId: memberMessage.id,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await actions(actors.admin).deleteMessage({ messageId: adminMessage.id }),
    ).toMatchObject({ ok: true });
    expect(
      await actions().deleteMessage({ messageId: adminMessage.id }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("rolls back edited content and previous mentions if a later mention insert fails", async () => {
    await database.db
      .insert(teamMembers)
      .values({
        teamId: actors.teamId,
        userId: actors.outsider.userId,
        createdAt: new Date("2026-10-01T00:00:00Z"),
      });
    const body = `<@${actors.admin.userId}> 원문`;
    const message = await sent(body);
    await database.db.execute(
      sql`create function pg_temp.reject_chat_mention() returns trigger language plpgsql as $$ begin raise exception 'private failure'; end $$`,
    );
    await database.db.execute(
      sql`create trigger reject_chat_mention before insert on message_mentions for each row execute function pg_temp.reject_chat_mention()`,
    );
    try {
      expect(
        await actions().editMessage({
          messageId: message.id,
          body: `<@${actors.outsider.userId}> 바꾸기`,
        }),
      ).toEqual({ ok: false, code: "INTERNAL" });
      const [saved] = await database.db
        .select()
        .from(messages)
        .where(eq(messages.id, message.id));
      expect(saved).toMatchObject({ body, editedAt: null });
      expect(
        await database.db
          .select({ userId: messageMentions.userId })
          .from(messageMentions),
      ).toEqual([{ userId: actors.admin.userId }]);
      expect(delivered).toEqual([]);
      expect(JSON.stringify(logError.mock.calls)).not.toContain(
        "private failure",
      );
    } finally {
      await database.db.execute(
        sql`drop trigger reject_chat_mention on message_mentions`,
      );
    }
  });

  it("locks users before room/message mutations for edit and delete writes", async () => {
    const message = await sent();
    for (const perform of [
      () =>
        actions().editMessage({
          messageId: message.id,
          body: `<@${actors.admin.userId}> 수정`,
        }),
      () => actions().deleteMessage({ messageId: message.id }),
    ]) {
      queries.length = 0;
      expect(await perform()).toMatchObject({ ok: true });
      const firstUserLock = queries.findIndex(
        ({ text }) => /from "users"/i.test(text) && /for key share/i.test(text),
      );
      const firstRoomLock = queries.findIndex(
        ({ text }) =>
          /from "chat_rooms"/i.test(text) &&
          /for (?:update|key share)/i.test(text),
      );
      expect(firstUserLock).toBeGreaterThan(-1);
      expect(firstRoomLock).toBeGreaterThan(firstUserLock);
      const lastUserLock = queries.findLastIndex(
        ({ text }) => /from "users"/i.test(text) && /for key share/i.test(text),
      );
      expect(lastUserLock).toBeLessThan(firstRoomLock);
      const update = queries.find(({ text }) =>
        /^update "messages"/i.test(text),
      );
      expect(update?.text).toMatch(/"deleted_at" is null/i);
      expect(update?.text).toMatch(/returning/i);
      expect(update?.params).toContain(actors.member.userId);
    }
  });

  it("keeps edits and deletions committed when realtime publication fails", async () => {
    const message = await sent();
    const publish = vi.fn(async () => {
      throw new Error("private publication failure");
    });
    const api = actions(actors.member, {
      publisher: { publish, publishMany: publish },
    });
    expect(
      await api.editMessage({ messageId: message.id, body: "저장된 변경" }),
    ).toMatchObject({ ok: true });
    expect((await page()).messages[0]?.body).toBe("저장된 변경");
    expect(await api.deleteMessage({ messageId: message.id })).toMatchObject({
      ok: true,
    });
    expect((await page()).messages[0]?.body).toBe("");
    expect(logError).toHaveBeenCalled();
    expect(JSON.stringify(logError.mock.calls)).not.toContain(
      "private publication failure",
    );
  });
});

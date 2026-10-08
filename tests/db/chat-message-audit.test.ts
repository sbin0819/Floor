import { and, eq, sql } from "drizzle-orm";
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
import { mergeChatMessages } from "@/features/chat/components/message-state";
import type { ChatMessage } from "@/features/chat/types";
import * as writes from "@/lib/dal/chat-write";
import {
  chatRooms,
  messageMentions,
  messageReactions,
  messages,
  teamMembers,
} from "@/lib/db/schema";
import { createMemoryRateLimiter } from "@/lib/rate-limit/memory";
import { roomChannel } from "@/lib/realtime/channels";
import { createMemoryRealtime } from "@/lib/realtime/memory";
import type { RealtimeEvent } from "@/lib/realtime/types";
import { chatNow, seedChatActors, type ChatActors } from "./chat-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("message mutation security and lock-window regressions", () => {
  let database: TestDatabase;
  let actors: ChatActors;
  let realtime: ReturnType<typeof createMemoryRealtime>;
  const events: RealtimeEvent[] = [];
  const logError = vi.fn();
  beforeAll(async () => {
    database = await createTestDatabase();
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
    events.length = 0;
    realtime.subscribe(roomChannel(actors.roomId), (event) =>
      events.push(event),
    );
  });
  function actions(
    session = actors.member,
    extra: ChatActionDependencies = {},
  ) {
    return createChatActions({
      database: database.db,
      getSession: async () => session,
      now: () => chatNow,
      limiter: createMemoryRateLimiter(() => chatNow.getTime()),
      publisher: realtime,
      logError,
      ...extra,
    });
  }
  async function sent(
    body = "원문",
    session = actors.member,
  ): Promise<ChatMessage> {
    const result = await actions(session).sendMessage({
      roomId: actors.roomId,
      body,
      clientId: crypto.randomUUID(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected send failure: ${result.code}`);
    events.length = 0;
    return result.data;
  }

  it("hides someone else's edit target even when the readable room is admin-only or archived", async () => {
    const target = await sent("관리자 원문", actors.admin);
    await database.db
      .update(chatRooms)
      .set({ adminOnly: true })
      .where(eq(chatRooms.id, actors.roomId));
    expect(
      await actions().editMessage({ messageId: target.id, body: "변경 시도" }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    await database.db
      .update(chatRooms)
      .set({ archivedAt: chatNow })
      .where(eq(chatRooms.id, actors.roomId));
    expect(
      await actions().editMessage({ messageId: target.id, body: "변경 시도" }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(events).toEqual([]);
  });

  it("hides a deleted own edit target in a read-only room, while a live own target is forbidden", async () => {
    const removed = await sent();
    const live = await sent("살아 있는 원문");
    expect(
      await actions().deleteMessage({ messageId: removed.id }),
    ).toMatchObject({ ok: true });
    events.length = 0;
    await database.db
      .update(chatRooms)
      .set({ archivedAt: chatNow })
      .where(eq(chatRooms.id, actors.roomId));
    expect(
      await actions().editMessage({ messageId: removed.id, body: "복원 시도" }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(
      await actions().editMessage({ messageId: live.id, body: "변경 시도" }),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(events).toEqual([]);
  });

  it("rechecks write access after the room lock instead of trusting its initial result", async () => {
    const target = await sent();
    const lockRoom = writes.lockRoomForMessage;
    vi.spyOn(writes, "lockRoomForMessage").mockImplementationOnce(
      async (roomId, tx) => {
        const locked = await lockRoom(roomId, tx);
        await tx
          .update(chatRooms)
          .set({ adminOnly: true })
          .where(eq(chatRooms.id, roomId));
        return locked;
      },
    );
    expect(
      await actions().editMessage({
        messageId: target.id,
        body: "권한이 사라진 변경",
      }),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(
      await database.db
        .select({ body: messages.body, editedAt: messages.editedAt })
        .from(messages),
    ).toEqual([{ body: "원문", editedAt: null }]);
    expect(events).toEqual([]);
  });

  it("rechecks admin deletion permission after the room lock", async () => {
    const target = await sent();
    const lockRoom = writes.lockRoomForMessage;
    vi.spyOn(writes, "lockRoomForMessage").mockImplementationOnce(
      async (roomId, tx) => {
        const locked = await lockRoom(roomId, tx);
        await tx
          .update(teamMembers)
          .set({ role: "member" })
          .where(
            and(
              eq(teamMembers.teamId, actors.teamId),
              eq(teamMembers.userId, actors.admin.userId),
            ),
          );
        return locked;
      },
    );
    expect(
      await actions(actors.admin).deleteMessage({ messageId: target.id }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(
      await database.db
        .select({ body: messages.body, deletedAt: messages.deletedAt })
        .from(messages),
    ).toEqual([{ body: "원문", deletedAt: null }]);
    expect(events).toEqual([]);
  });

  it("rechecks reaction access after the room becomes archived in the lock window", async () => {
    const target = await sent();
    const lockRoom = writes.lockRoomForMessage;
    vi.spyOn(writes, "lockRoomForMessage").mockImplementationOnce(
      async (roomId, tx) => {
        const locked = await lockRoom(roomId, tx);
        await tx
          .update(chatRooms)
          .set({ archivedAt: chatNow })
          .where(eq(chatRooms.id, roomId));
        return locked;
      },
    );
    expect(
      await actions().setReaction({
        messageId: target.id,
        emoji: "heart",
        on: true,
      }),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(await database.db.select().from(messageReactions)).toEqual([]);
    expect(events).toEqual([]);
  });

  it("rolls back deleted content and reaction cleanup if subsequent mention cleanup fails", async () => {
    const target = await sent(`<@${actors.admin.userId}> 보존해야 하는 원문`);
    await database.db
      .insert(messageReactions)
      .values({
        messageId: target.id,
        userId: actors.admin.userId,
        emoji: "heart",
      });
    await database.db.execute(
      sql`create function pg_temp.reject_chat_mention_delete() returns trigger language plpgsql as $$ begin raise exception 'private cleanup failure'; end $$`,
    );
    await database.db.execute(
      sql`create trigger reject_chat_mention_delete before delete on message_mentions for each row execute function pg_temp.reject_chat_mention_delete()`,
    );
    try {
      expect(await actions().deleteMessage({ messageId: target.id })).toEqual({
        ok: false,
        code: "INTERNAL",
      });
      expect(
        await database.db
          .select({
            body: messages.body,
            deletedAt: messages.deletedAt,
            deletedBy: messages.deletedBy,
          })
          .from(messages),
      ).toEqual([{ body: target.body, deletedAt: null, deletedBy: null }]);
      expect(await database.db.select().from(messageReactions)).toHaveLength(1);
      expect(await database.db.select().from(messageMentions)).toHaveLength(1);
      expect(events).toEqual([]);
      expect(JSON.stringify(logError.mock.calls)).not.toContain(
        "private cleanup failure",
      );
      expect(JSON.stringify(logError.mock.calls)).not.toContain(
        "보존해야 하는 원문",
      );
    } finally {
      await database.db.execute(
        sql`drop trigger reject_chat_mention_delete on message_mentions`,
      );
    }
  });

  it("keeps edit timestamps increasing when an older-started edit obtains the room lock last", async () => {
    const target = await sent();
    const priorTime = new Date(chatNow.getTime() + 2_000);
    const previous: ChatMessage = {
      ...target,
      body: "먼저 커밋한 편집",
      editedAt: priorTime.toISOString(),
    };
    const lockRoom = writes.lockRoomForMessage;
    // 단일 연결에서 잠금 대기 동안 먼저 커밋된 행을 주입한다. 다중 연결 교착 검사는 아니다.
    vi.spyOn(writes, "lockRoomForMessage").mockImplementationOnce(
      async (roomId, tx) => {
        const locked = await lockRoom(roomId, tx);
        await tx
          .update(messages)
          .set({ body: previous.body, editedAt: priorTime })
          .where(eq(messages.id, target.id));
        return locked;
      },
    );
    const result = await actions(actors.member, {
      now: () => new Date(chatNow.getTime() + 1_000),
    }).editMessage({ messageId: target.id, body: "마지막에 커밋한 편집" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected edit failure: ${result.code}`);
    expect(Date.parse(result.data.editedAt!)).toBeGreaterThan(
      priorTime.getTime(),
    );
    expect(
      mergeChatMessages([previous], [result.data], actors.member.userId)[0]
        ?.body,
    ).toBe("마지막에 커밋한 편집");
    expect(events).toEqual([
      expect.objectContaining({
        type: "message.updated",
        editedAt: result.data.editedAt,
        body: result.data.body,
      }),
    ]);
  });

  it("keeps consecutive edits distinct even when they share the same injected millisecond", async () => {
    const target = await sent();
    const first = await actions().editMessage({
      messageId: target.id,
      body: "첫 편집",
    });
    const second = await actions().editMessage({
      messageId: target.id,
      body: "다음 편집",
    });
    if (!first.ok || !second.ok) throw new Error("Expected successful edits");
    expect(Date.parse(second.data.editedAt!)).toBeGreaterThan(
      Date.parse(first.data.editedAt!),
    );
    expect(
      mergeChatMessages([second.data], [first.data], actors.member.userId)[0]
        ?.body,
    ).toBe("다음 편집");
  });
});

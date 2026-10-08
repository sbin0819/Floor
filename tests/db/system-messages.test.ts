import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createChatActions } from "@/features/chat/action-factory";
import { createChatQueries } from "@/features/chat/query-factory";
import { chatRoomReads, chatRooms, messages } from "@/lib/db/schema";
import {
  insertSystemMessage,
  lockRoomForMessage,
  lockUsersForKeyShare,
} from "@/lib/dal/chat-write";
import { createMemoryRateLimiter } from "@/lib/rate-limit/memory";
import { noopRealtime } from "@/lib/realtime/noop";
import { chatNow, seedChatActors, type ChatActors } from "./chat-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("system messages with real migrations", () => {
  let database: TestDatabase;
  let actors: ChatActors;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    await database.db.execute(sql`truncate users, branches cascade`);
    actors = await seedChatActors(database);
  });
  const created = (
    actorId: string | null = actors.admin.userId,
    roomId = actors.roomId,
  ) =>
    database.db.transaction(async (tx) => {
      await lockUsersForKeyShare(actorId ? [actorId] : [], tx);
      await lockRoomForMessage(roomId, tx);
      return insertSystemMessage(
        {
          roomId,
          actorId,
          data: { type: "group_created", actorName: actors.admin.name },
          now: chatNow,
        },
        tx,
      );
    });
  const queries = (session = actors.member) =>
    createChatQueries({
      database: database.db,
      requireSession: async () => session,
      now: () => chatNow,
    });
  const actions = (session = actors.member) =>
    createChatActions({
      database: database.db,
      getSession: async () => session,
      now: () => chatNow,
      limiter: createMemoryRateLimiter(() => chatNow.getTime()),
      publisher: noopRealtime,
    });

  it("increments the room cursor and timestamp, returns the persisted snapshot, and advances only its actor", async () => {
    const message = await created();
    expect(message).toMatchObject({
      seq: 1,
      kind: "system",
      authorId: null,
      authorName: null,
      body: "관리자 님이 그룹을 만들었어요",
      systemData: { type: "group_created", actorName: "관리자" },
      createdAt: chatNow.toISOString(),
    });
    expect(
      (
        await database.db
          .select()
          .from(chatRooms)
          .where(eq(chatRooms.id, actors.roomId))
      )[0],
    ).toMatchObject({ lastSeq: 1, lastMessageAt: chatNow });
    expect(await database.db.select().from(chatRoomReads)).toMatchObject([
      { userId: actors.admin.userId, lastReadSeq: 1 },
    ]);
    const page = await queries().getRoomMessagesPage(actors.roomId, {
      after: "0",
    });
    expect(page.messages).toEqual([message]);
    expect(page.firstUnreadSeq).toBe(1);
    expect(
      (
        await queries(actors.admin).getRoomMessagesPage(actors.roomId, {
          after: "0",
        })
      ).firstUnreadSeq,
    ).toBeNull();
    const view = await queries().getChannelView(actors.spaceId, actors.roomId);
    expect(view?.messages).toEqual([message]);
  });

  it("preserves mute preferences and never decreases an existing read cursor", async () => {
    await database.db.insert(chatRoomReads).values({
      roomId: actors.roomId,
      userId: actors.admin.userId,
      lastReadSeq: 8,
      muted: true,
      updatedAt: chatNow,
    });
    await created();
    expect((await database.db.select().from(chatRoomReads))[0]).toMatchObject({
      lastReadSeq: 8,
      muted: true,
    });
    expect((await created()).seq).toBe(2);
  });

  it("does not create a read marker for an actor who has left", async () => {
    await created(null);
    expect(await database.db.select().from(chatRoomReads)).toEqual([]);
  });

  it("advances a new group's creator without expanding public group access prematurely", async () => {
    const [room] = await database.db
      .insert(chatRooms)
      .values({ kind: "group_dm" })
      .returning();
    const message = await created(actors.admin.userId, room!.id);
    expect(message.seq).toBe(1);
    expect((await database.db.select().from(chatRoomReads))[0]).toMatchObject({
      roomId: room!.id,
      userId: actors.admin.userId,
      lastReadSeq: 1,
    });
    expect(await queries().getDirectMessageView(room!.id)).toBeNull();
  });

  it("rolls back room, message and read changes together", async () => {
    await expect(
      database.db.transaction(async (tx) => {
        await lockUsersForKeyShare([actors.admin.userId], tx);
        await lockRoomForMessage(actors.roomId, tx);
        await insertSystemMessage(
          {
            roomId: actors.roomId,
            actorId: actors.admin.userId,
            data: { type: "member_left", name: actors.admin.name },
            now: chatNow,
          },
          tx,
        );
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await database.db.select().from(messages)).toEqual([]);
    expect(await database.db.select().from(chatRoomReads)).toEqual([]);
    expect(
      (
        await database.db
          .select()
          .from(chatRooms)
          .where(eq(chatRooms.id, actors.roomId))
      )[0],
    ).toMatchObject({ lastSeq: 0, lastMessageAt: null });
  });

  it("returns only a null parsed snapshot and the existing body for malformed stored system data", async () => {
    const message = await created();
    await database.db.execute(
      sql`update messages set system_data = '{"type":"group_created","actorName":"관리자","email":"private@floor.test"}'::jsonb where id = ${message.id}`,
    );
    const page = await queries().getRoomMessagesPage(actors.roomId, {
      after: "0",
    });
    expect(page.messages[0]?.systemData).toBeNull();
    expect(page.messages[0]?.body).toBe(message.body);
    expect(JSON.stringify(page)).not.toContain("private@floor.test");
  });

  it("rejects reactions and replies but keeps edit/delete and outsider errors private", async () => {
    const message = await created();
    expect(
      await actions().setReaction({
        messageId: message.id,
        emoji: "thumbs_up",
        on: true,
      }),
    ).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(
      await actions().sendMessage({
        roomId: actors.roomId,
        clientId: crypto.randomUUID(),
        body: "답장",
        replyToId: message.id,
      }),
    ).toEqual({ ok: false, code: "INVALID_INPUT" });
    for (const session of [actors.admin, actors.member, actors.outsider]) {
      expect(
        await actions(session).editMessage({
          messageId: message.id,
          body: "수정",
        }),
      ).toEqual({ ok: false, code: "NOT_FOUND" });
      expect(
        await actions(session).deleteMessage({ messageId: message.id }),
      ).toEqual({ ok: false, code: "NOT_FOUND" });
    }
    expect(
      await actions(actors.outsider).setReaction({
        messageId: message.id,
        emoji: "thumbs_up",
        on: true,
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await database.db.select().from(messages)).toHaveLength(1);
  });
});

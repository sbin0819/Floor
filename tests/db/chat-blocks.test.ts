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
import { canReadRoom, canWriteRoom } from "@/lib/dal/chat-access";
import { directPeerAccess } from "@/lib/dal/direct";
import { messageMentions, messages, userBlocks, users } from "@/lib/db/schema";
import { createMemoryRateLimiter } from "@/lib/rate-limit/memory";
import type { RealtimeItem } from "@/lib/realtime/types";
import { createTestDatabase, type TestDatabase } from "./helper";
import { chatNow, seedChatActors, type ChatActors } from "./chat-helper";
import { createQueryMeter } from "./query-meter";

describe("chat block boundaries", () => {
  let database: TestDatabase;
  let actors: ChatActors;
  const publisher = {
    publish: vi.fn(),
    publishMany: vi
      .fn<(events: readonly RealtimeItem[]) => Promise<void>>()
      .mockResolvedValue(undefined),
  };
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
  const actions = (session = actors.admin) =>
    createChatActions({
      database: database.db,
      getSession: async () => session,
      now: () => chatNow,
      publisher,
      limiter: createMemoryRateLimiter(),
    });
  const queries = (session = actors.member) =>
    createChatQueries({
      database: database.db,
      requireSession: async () => session,
      now: () => chatNow,
    });
  const mentions = () =>
    publisher.publishMany.mock.calls.flatMap(([events]) =>
      events.filter(({ event }) => event.type === "mention.created"),
    );
  const block = (reverse = false) =>
    database.db.insert(userBlocks).values({
      blockerId: reverse ? actors.admin.userId : actors.member.userId,
      blockedId: reverse ? actors.member.userId : actors.admin.userId,
    });
  async function sent(body: string, roomId = actors.roomId) {
    const result = await actions().sendMessage({
      roomId,
      body,
      clientId: crypto.randomUUID(),
    });
    if (!result.ok) throw new Error(`Unexpected ${result.code}`);
    return result.data;
  }

  it.each([false, true])(
    "blocks DM open/write in either direction (%s) without hiding existing history",
    async (reverse) => {
      const opened = await actions().openDirectMessage({
        userId: actors.member.userId,
      });
      if (!opened.ok) throw new Error(opened.code);
      const message = await sent("원래 있던 대화", opened.data.roomId);
      await block(reverse);
      for (const [me, peer] of [
        [actors.admin, actors.member],
        [actors.member, actors.admin],
      ] as const) {
        expect(
          await directPeerAccess(me.userId, peer.userId, database.db),
        ).toEqual({
          existsVerified: true,
          canOpen: false,
          blocked: true,
          related: true,
        });
        expect(
          await actions(me).openDirectMessage({ userId: peer.userId }),
        ).toEqual({ ok: false, code: "FORBIDDEN" });
        expect(
          await canReadRoom(me.userId, opened.data.roomId, database.db),
        ).not.toBeNull();
        expect(
          (await canWriteRoom(me.userId, opened.data.roomId, database.db))
            .canWrite,
        ).toBe(false);
        expect(
          await actions(me).sendMessage({
            roomId: opened.data.roomId,
            clientId: crypto.randomUUID(),
            body: "차단 뒤",
          }),
        ).toEqual({ ok: false, code: "FORBIDDEN" });
        expect(
          (await queries(me).getDirectMessageView(opened.data.roomId))
            ?.messages,
        ).toHaveLength(1);
      }
      expect(
        await actions().editMessage({
          messageId: message.id,
          body: "차단 뒤 수정",
        }),
      ).toEqual({ ok: false, code: "FORBIDDEN" });
    },
  );

  it.each(["personal", "everyone"])(
    "does not store or deliver %s mentions to a person who blocked the author",
    async (kind) => {
      await block();
      const body =
        kind === "personal"
          ? `안녕하세요 <@${actors.member.userId}>`
          : "<@everyone> 공지";
      const message = await sent(body);
      expect(message.mentions).toEqual([]);
      expect(await database.db.select().from(messageMentions)).toEqual([]);
      expect(mentions()).toEqual([]);
      expect(message.mentionsEveryone).toBe(kind === "everyone");
      const view = await queries().getChannelView(
        actors.spaceId,
        actors.roomId,
      );
      expect(view?.messages).toHaveLength(1);
      expect(view?.room.unreadMentions).toBe(0);
      expect(view?.firstUnreadSeq).toBe(1);
    },
  );

  it("does not invert the one-way mention rule when only the author blocks the recipient", async () => {
    await block(true);
    const message = await sent(`안녕하세요 <@${actors.member.userId}>`);
    expect(message.mentions).toEqual([
      { userId: actors.member.userId, name: actors.member.name },
    ]);
    expect(mentions()).toHaveLength(1);
    expect(
      (await queries().getChannelView(actors.spaceId, actors.roomId))?.room
        .unreadMentions,
    ).toBe(1);
  });

  it.each(["personal", "everyone"])(
    "ignores existing %s mentions after blocking, without changing normal unread data or SQL budget",
    async (kind) => {
      const body =
        kind === "personal"
          ? `<@${actors.member.userId}> 공지`
          : "<@everyone> 공지";
      await sent(body);
      expect(
        (await queries().getChannelView(actors.spaceId, actors.roomId))?.room
          .unreadMentions,
      ).toBe(1);
      await block();
      const meter = createQueryMeter(database.client);
      try {
        meter.start();
        const view = await queries().getChannelView(
          actors.spaceId,
          actors.roomId,
        );
        expect(meter.stop().perStage).toEqual([1, 2]);
        expect(view?.room.unreadMentions).toBe(0);
        expect(view?.firstUnreadSeq).toBe(1);
        expect(
          view?.members.map((member) => Object.keys(member).sort()),
        ).toEqual([
          ["admin", "id", "name"],
          ["admin", "id", "name"],
        ]);
        meter.start();
        const nav = await queries().getMyChatNav();
        expect(meter.stop().perStage).toEqual([2]);
        expect(nav.spaces[0]?.unread).toBe(true);
        expect(nav.spaces[0]?.unreadMentions).toBe(0);
      } finally {
        meter.restore();
      }
      await database.db.delete(userBlocks);
      expect(
        (await queries().getChannelView(actors.spaceId, actors.roomId))?.room
          .unreadMentions,
      ).toBe(1);
    },
  );

  it("removes blocked personal mentions on edit and never sends new everyone alerts to that recipient", async () => {
    const message = await sent(`<@${actors.member.userId}> 이전 문구`);
    await block();
    publisher.publishMany.mockClear();
    const updated = await actions().editMessage({
      messageId: message.id,
      body: `<@${actors.member.userId}> <@everyone> 새 문구`,
    });
    expect(updated).toMatchObject({
      ok: true,
      data: { mentions: [], mentionsEveryone: true },
    });
    expect(await database.db.select().from(messageMentions)).toEqual([]);
    expect(mentions()).toEqual([]);
    expect(
      (
        await database.db
          .select()
          .from(messages)
          .where(eq(messages.id, message.id))
      )[0]?.body,
    ).toContain("새 문구");
  });
});

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
import { createChatQueries } from "@/features/chat/query-factory";
import { saveRoomMuted, saveSpaceMuted } from "@/lib/dal/chat-reads";
import {
  chatRoomReads,
  chatRooms,
  chatSpaces,
  chatSpacePrefs,
  messages,
  messageMentions,
  teamMembers,
} from "@/lib/db/schema";
import { createTestDatabase, type TestDatabase } from "./helper";
import { chatNow, seedChatActors, type ChatActors } from "./chat-helper";
import { createQueryMeter } from "./query-meter";

describe("unread mentions and mute preferences", () => {
  let database: TestDatabase;
  let actors: ChatActors;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    await database.db.execute(sql`truncate users, branches cascade`);
    actors = await seedChatActors(database);
  });
  const queries = (session = actors.member) =>
    createChatQueries({
      database: database.db,
      requireSession: async () => session,
      now: () => chatNow,
    });
  const actions = (
    session = actors.member,
    extra: ChatActionDependencies = {},
  ) =>
    createChatActions({
      database: database.db,
      getSession: async () => session,
      now: () => chatNow,
      ...extra,
    });
  async function message(
    seq: number,
    extra: {
      everyone?: boolean;
      mention?: string;
      own?: boolean;
      deleted?: boolean;
      at?: Date;
      roomId?: string;
    } = {},
  ) {
    const [row] = await database.db
      .insert(messages)
      .values({
        roomId: extra.roomId ?? actors.roomId,
        seq,
        authorId: extra.own ? actors.member.userId : actors.admin.userId,
        body: extra.deleted ? "" : "가상 메시지",
        mentionsEveryone: extra.everyone ?? false,
        deletedAt: extra.deleted ? chatNow : null,
        deletedBy: extra.deleted ? actors.admin.userId : null,
        createdAt: extra.at ?? chatNow,
      })
      .returning();
    if (extra.mention)
      await database.db
        .insert(messageMentions)
        .values({ messageId: row!.id, userId: extra.mention });
    await database.db
      .update(chatRooms)
      .set({ lastSeq: seq, lastMessageAt: extra.at ?? chatNow })
      .where(eq(chatRooms.id, extra.roomId ?? actors.roomId));
    return row!;
  }
  async function expectCount(count: number) {
    const nav = (await queries().getMyChatNav()).spaces;
    expect(nav[0]!.unreadMentions).toBe(count);
    expect(
      nav[0]!.channels.find((room) => room.id === actors.roomId)
        ?.unreadMentions,
    ).toBe(count);
    const view = await queries().getChannelView(actors.spaceId, actors.roomId);
    expect(view?.room.unreadMentions).toBe(count);
  }

  it("counts each mentioned message once and excludes old, self, deleted and unmentioned messages", async () => {
    await message(1, { everyone: true, at: new Date("2026-09-30T23:59:59Z") });
    await message(2, {
      mention: actors.member.userId,
      at: new Date("2026-10-01T00:00:00Z"),
    });
    await message(3, { everyone: true, own: true });
    await message(4, { mention: actors.member.userId, deleted: true });
    await message(5);
    await message(6, { everyone: true, mention: actors.member.userId });
    await message(7, { everyone: true });
    await message(8, { mention: actors.member.userId });
    await message(9, { mention: actors.outsider.userId });
    await expectCount(3);
    await actions().markRoomRead({ roomId: actors.roomId, seq: 6 });
    await expectCount(2);
    await actions().markRoomRead({ roomId: actors.roomId, seq: 9 });
    await expectCount(0);
  });
  it("checks the joined-at boundary even with an old saved read cursor", async () => {
    await message(1, { everyone: true });
    await actions().markRoomRead({ roomId: actors.roomId, seq: 0 });
    await database.db
      .update(teamMembers)
      .set({ createdAt: chatNow })
      .where(
        and(
          eq(teamMembers.teamId, actors.teamId),
          eq(teamMembers.userId, actors.member.userId),
        ),
      );
    await expectCount(0);
    await message(2, { everyone: true, at: new Date(chatNow.getTime() + 1) });
    await expectCount(1);
  });
  it("returns real counts above badge limits and isolates each user's mention and mute state", async () => {
    await database.db.insert(messages).values(
      Array.from({ length: 101 }, (_, index) => ({
        roomId: actors.roomId,
        seq: index + 1,
        authorId: actors.admin.userId,
        body: "모두 멘션",
        mentionsEveryone: true,
        createdAt: chatNow,
      })),
    );
    await database.db
      .update(chatRooms)
      .set({ lastSeq: 101, lastMessageAt: chatNow })
      .where(eq(chatRooms.id, actors.roomId));
    await expectCount(101);
    await actions().setRoomMuted({ roomId: actors.roomId, muted: true });
    const adminNav = (await queries(actors.admin).getMyChatNav()).spaces;
    expect(
      adminNav[0]!.channels.find((room) => room.id === actors.roomId),
    ).toMatchObject({ muted: false, unreadMentions: 0 });
  });
  it("defaults missing preferences to false and counts to zero, including a space without active rooms", async () => {
    expect((await queries().getMyChatNav()).spaces[0]).toMatchObject({
      muted: false,
      unreadMentions: 0,
      unread: false,
      channels: [
        { muted: false, unreadMentions: 0 },
        { muted: false, unreadMentions: 0 },
      ],
    });
    await database.db
      .update(chatRooms)
      .set({ archivedAt: chatNow })
      .where(eq(chatRooms.spaceId, actors.spaceId));
    expect((await queries().getMyChatNav()).spaces).toEqual([
      expect.objectContaining({
        muted: false,
        unreadMentions: 0,
        unread: false,
        channels: [],
      }),
    ]);
  });
  it("mutes raw unread messages without hiding mentions and preserves a channel's own preference when space mute changes", async () => {
    await message(1, { mention: actors.member.userId });
    expect(
      await actions().setRoomMuted({ roomId: actors.roomId, muted: true }),
    ).toEqual({ ok: true, data: { muted: true } });
    let nav = (await queries().getMyChatNav()).spaces[0]!;
    expect(nav).toMatchObject({
      muted: false,
      unread: false,
      unreadMentions: 1,
    });
    expect(
      nav.channels.find((room) => room.id === actors.roomId),
    ).toMatchObject({ muted: true, unread: true, unreadMentions: 1 });
    expect(
      await actions().setSpaceMuted({ spaceId: actors.spaceId, muted: true }),
    ).toEqual({ ok: true, data: { muted: true } });
    expect(
      await queries().getChannelView(actors.spaceId, actors.roomId),
    ).toMatchObject({
      space: { muted: true },
      room: { muted: true, unreadMentions: 1 },
      firstUnreadSeq: 1,
      lastReadSeq: 0,
    });
    await actions().setSpaceMuted({ spaceId: actors.spaceId, muted: false });
    nav = (await queries().getMyChatNav()).spaces[0]!;
    expect(nav.unread).toBe(false);
    await actions().setRoomMuted({ roomId: actors.roomId, muted: false });
    expect((await queries().getMyChatNav()).spaces[0]!.unread).toBe(true);
  });
  it("space mute excludes all its rooms from the rail dot while returning their raw unread state", async () => {
    await message(1, { everyone: true });
    await actions().setSpaceMuted({ spaceId: actors.spaceId, muted: true });
    const nav = (await queries().getMyChatNav()).spaces[0]!;
    expect(nav).toMatchObject({
      muted: true,
      unread: false,
      unreadMentions: 1,
    });
    expect(
      nav.channels.find((room) => room.id === actors.roomId),
    ).toMatchObject({ muted: false, unread: true, unreadMentions: 1 });
  });
  it("initial mute starts at zero and repeated changes preserve the read cursor and creation times", async () => {
    await message(5, { everyone: true });
    await actions().setRoomMuted({ roomId: actors.roomId, muted: true });
    let [row] = await database.db.select().from(chatRoomReads);
    expect(row).toMatchObject({
      lastReadSeq: 0,
      muted: true,
      createdAt: chatNow,
    });
    await actions().markRoomRead({ roomId: actors.roomId, seq: 3 });
    const later = new Date(chatNow.getTime() + 1_000);
    for (const muted of [true, true, false])
      await actions(actors.member, { now: () => later }).setRoomMuted({
        roomId: actors.roomId,
        muted,
      });
    [row] = await database.db.select().from(chatRoomReads);
    expect(row).toMatchObject({
      lastReadSeq: 3,
      muted: false,
      createdAt: chatNow,
      updatedAt: later,
    });
    await actions().setSpaceMuted({ spaceId: actors.spaceId, muted: true });
    await actions(actors.member, { now: () => later }).setSpaceMuted({
      spaceId: actors.spaceId,
      muted: false,
    });
    expect(await database.db.select().from(chatSpacePrefs)).toEqual([
      expect.objectContaining({
        muted: false,
        createdAt: chatNow,
        updatedAt: later,
      }),
    ]);
    expect(await database.db.select().from(chatRoomReads)).toHaveLength(1);
  });
  it("allows readable archived or admin-only room mute without granting write access", async () => {
    await database.db
      .update(chatRooms)
      .set({ archivedAt: chatNow, adminOnly: true })
      .where(eq(chatRooms.id, actors.roomId));
    expect(
      await actions().setRoomMuted({ roomId: actors.roomId, muted: true }),
    ).toEqual({ ok: true, data: { muted: true } });
    expect(
      await queries().getChannelView(actors.spaceId, actors.roomId),
    ).toMatchObject({ room: { muted: true }, canWrite: false });
  });
  it("authenticates before parsing and rejects forged user ids, invalid booleans and unreadable targets", async () => {
    expect(
      await actions(actors.member, {
        getSession: async () => null,
      }).setRoomMuted(null),
    ).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect(
      await actions(actors.member, {
        getSession: async () => null,
      }).setSpaceMuted(null),
    ).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    for (const muted of [null, "true", 1, undefined]) {
      expect(
        await actions().setRoomMuted({ roomId: actors.roomId, muted }),
      ).toMatchObject({ code: "INVALID_INPUT" });
      expect(
        await actions().setSpaceMuted({ spaceId: actors.spaceId, muted }),
      ).toMatchObject({ code: "INVALID_INPUT" });
    }
    expect(
      await actions().setRoomMuted({
        roomId: actors.roomId,
        muted: true,
        userId: actors.admin.userId,
      }),
    ).toMatchObject({ code: "INVALID_INPUT" });
    for (const session of [actors.outsider, actors.operator]) {
      expect(
        await actions(session).setRoomMuted({
          roomId: actors.roomId,
          muted: true,
        }),
      ).toEqual({ ok: false, code: "NOT_FOUND" });
      expect(
        await actions(session).setSpaceMuted({
          spaceId: actors.spaceId,
          muted: true,
        }),
      ).toEqual({ ok: false, code: "NOT_FOUND" });
    }
    expect(
      await actions().setRoomMuted({
        roomId: crypto.randomUUID(),
        muted: true,
      }),
    ).toMatchObject({ code: "NOT_FOUND" });
    expect(
      await actions().setSpaceMuted({
        spaceId: crypto.randomUUID(),
        muted: true,
      }),
    ).toMatchObject({ code: "NOT_FOUND" });
    expect(await database.db.select().from(chatRoomReads)).toHaveLength(0);
    expect(await database.db.select().from(chatSpacePrefs)).toHaveLength(0);
  });
  it("rechecks readable membership in the INSERT SELECT and writes nothing after access is removed", async () => {
    await database.db
      .delete(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, actors.teamId),
          eq(teamMembers.userId, actors.member.userId),
        ),
      );
    expect(
      await saveRoomMuted(
        {
          roomId: actors.roomId,
          userId: actors.member.userId,
          muted: true,
          now: chatNow,
        },
        database.db,
      ),
    ).toBeNull();
    expect(
      await saveSpaceMuted(
        {
          spaceId: actors.spaceId,
          userId: actors.member.userId,
          muted: true,
          now: chatNow,
        },
        database.db,
      ),
    ).toBeNull();
    expect(await database.db.select().from(chatRoomReads)).toHaveLength(0);
    expect(await database.db.select().from(chatSpacePrefs)).toHaveLength(0);
  });
  it("hides soft-deleted spaces and excludes archived room counts from nav", async () => {
    await message(1, { everyone: true });
    await database.db
      .update(chatRooms)
      .set({ archivedAt: chatNow })
      .where(eq(chatRooms.id, actors.roomId));
    expect((await queries().getMyChatNav()).spaces[0]).toMatchObject({
      unreadMentions: 0,
      unread: false,
    });
    expect(
      (await queries().getChannelView(actors.spaceId, actors.roomId))?.room
        .unreadMentions,
    ).toBe(1);
    await database.db
      .update(chatSpaces)
      .set({ deletedAt: chatNow })
      .where(eq(chatSpaces.id, actors.spaceId));
    expect(
      await actions().setSpaceMuted({ spaceId: actors.spaceId, muted: true }),
    ).toMatchObject({ code: "NOT_FOUND" });
    expect(
      await actions().setRoomMuted({ roomId: actors.roomId, muted: true }),
    ).toMatchObject({ code: "NOT_FOUND" });
    expect((await queries().getMyChatNav()).spaces).toEqual([]);
  });
  it("locks user before room/space before preference rows in one write statement", async () => {
    const statements = vi.spyOn(database.client, "query");
    await actions().setRoomMuted({ roomId: actors.roomId, muted: true });
    await actions().setSpaceMuted({ spaceId: actors.spaceId, muted: true });
    const writes = statements.mock.calls
      .map(([statement]) => statement)
      .filter((statement) =>
        /insert into "chat_(room_reads|space_prefs)"/i.test(statement),
      );
    expect(writes).toHaveLength(2);
    expect(writes[0]).toMatch(
      /locked_user as materialized[\s\S]*from users[\s\S]*for key share[\s\S]*locked_room as materialized[\s\S]*cross join locked_user[\s\S]*for key share of r[\s\S]*on conflict/i,
    );
    expect(writes[1]).toMatch(
      /locked_user as materialized[\s\S]*from users[\s\S]*for key share[\s\S]*locked_space as materialized[\s\S]*cross join locked_user[\s\S]*for key share of s[\s\S]*on conflict/i,
    );
    expect(writes[0]?.split(/do update set/i)[1]).not.toContain(
      "last_read_seq",
    );
  });
  it("retains nav [1], channel [1,2] and message page [2] SQL budgets with many channels", async () => {
    await database.db.insert(chatRooms).values(
      Array.from({ length: 25 }, (_, index) => ({
        kind: "text" as const,
        spaceId: actors.spaceId,
        name: `채널 ${index}`,
      })),
    );
    await message(1, { everyone: true, mention: actors.member.userId });
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      const nav = (await queries().getMyChatNav()).spaces;
      expect(meter.stop()).toMatchObject({
        stages: 1,
        statements: 2,
        perStage: [2],
      });
      expect(nav[0]!.unreadMentions).toBe(1);
      meter.start();
      await queries().getChannelView(actors.spaceId, actors.roomId);
      expect(meter.stop()).toMatchObject({
        stages: 2,
        statements: 3,
        perStage: [1, 2],
      });
      meter.start();
      await queries().getRoomMessagesPage(actors.roomId, { after: "0" });
      expect(meter.stop()).toMatchObject({
        stages: 1,
        statements: 2,
        perStage: [2],
      });
    } finally {
      meter.restore();
    }
  });
});

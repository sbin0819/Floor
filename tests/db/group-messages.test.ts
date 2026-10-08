import { and, eq, sql } from "drizzle-orm";
import { avatarColorFor } from "@/lib/avatar";
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
import { canReadRoom, canWriteRoom } from "@/lib/dal/chat-access";
import * as groups from "@/lib/dal/group-dm";
import * as writes from "@/lib/dal/chat-write";
import * as schema from "@/lib/db/schema";
import {
  chatRoomMembers,
  chatRoomReads,
  chatRooms,
  chatSpaces,
  friendships,
  messageMentions,
  messages,
  teamMembers,
  userBlocks,
  users,
} from "@/lib/db/schema";
import { createMemoryRateLimiter } from "@/lib/rate-limit/memory";
import type { RealtimeItem } from "@/lib/realtime/types";
import { chatNow, seedChatActors, type ChatActors } from "./chat-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

describe("group direct messages", () => {
  let database: TestDatabase;
  let actors: ChatActors;
  const now = new Date(chatNow.getTime() + 60_000);
  const later = new Date(now.getTime() + 60_000);
  const events: RealtimeItem[] = [];
  const statements: { text: string; params: unknown[] }[] = [];
  const publisher = {
    publish: vi.fn(),
    publishMany: vi.fn(async (items: readonly RealtimeItem[]) => {
      events.push(...items);
    }),
  };
  beforeAll(async () => {
    database = await createTestDatabase();
    database.db = drizzle({
      client: database.client,
      schema,
      logger: { logQuery: (text, params) => statements.push({ text, params }) },
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
  const queries = (session = actors.member) =>
    createChatQueries({
      database: database.db,
      requireSession: async () => session,
      now: () => later,
      limiter: createMemoryRateLimiter(),
    });
  async function create(
    ids = [actors.admin.userId, actors.outsider.userId],
    name?: string,
  ) {
    const result = await actions().createGroupDm({ userIds: ids, name });
    if (!result.ok) throw new Error(`create failed: ${result.code}`);
    return result.data.roomId;
  }
  async function extraPeople(count: number) {
    const rows = Array.from({ length: count }, (_, index) => ({
      id: crypto.randomUUID(),
      name: `새 회원 ${index}`,
      email: `${crypto.randomUUID()}@test.com`,
      emailVerified: true,
    }));
    await database.db.insert(users).values(rows);
    await database.db
      .insert(teamMembers)
      .values(rows.map(({ id }) => ({ teamId: actors.teamId, userId: id })));
    return rows.map(({ id }) => id);
  }
  const room = async (id: string) =>
    (
      await database.db.select().from(chatRooms).where(eq(chatRooms.id, id))
    )[0]!;
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
  const rowMessages = (roomId: string) =>
    database.db
      .select()
      .from(messages)
      .where(eq(messages.roomId, roomId))
      .orderBy(messages.seq);
  const send = (roomId: string, body: string, session = actors.member) =>
    actions(session, later).sendMessage({
      roomId,
      clientId: crypto.randomUUID(),
      body,
    });

  it("creates a fresh group and system message with no unread rows at the join boundary", async () => {
    const roomId = await create(
      [
        actors.admin.userId,
        actors.outsider.userId,
        actors.admin.userId.toUpperCase(),
      ],
      "  점심 메뉴  ",
    );
    expect(await room(roomId)).toMatchObject({
      kind: "group_dm",
      name: "점심 메뉴",
      lastSeq: 1,
      lastMessageAt: now,
      spaceId: null,
    });
    expect(await rowMessages(roomId)).toMatchObject([
      {
        kind: "system",
        authorId: null,
        seq: 1,
        systemData: { type: "group_created", actorName: actors.member.name },
      },
    ]);
    for (const actor of [actors.member, actors.admin, actors.outsider]) {
      expect(await membership(roomId, actor.userId)).toMatchObject({
        status: "active",
        joinedAt: now,
      });
      expect(
        (await queries(actor).getMyChatNav()).directMessages,
      ).toMatchObject([
        {
          kind: "group_dm",
          roomId,
          memberCount: 3,
          unread: false,
          unreadCount: 0,
        },
      ]);
    }
    expect(events.map(({ channel, event }) => [channel, event.type])).toEqual([
      [`user:${actors.admin.userId}`, "room.activity"],
      [`user:${actors.outsider.userId}`, "room.activity"],
    ]);
    expect(
      events.every(
        ({ event }) =>
          event.type === "room.activity" && event.preview?.authorName === null,
      ),
    ).toBe(true);
    expect(await create()).not.toBe(roomId);
  });

  it("validates member bounds, own ID, name length and missing-user priority", async () => {
    const ids = await extraPeople(9);
    for (const userIds of [
      [actors.admin.userId],
      [actors.member.userId, actors.admin.userId],
      [...ids, actors.admin.userId],
    ]) {
      expect(await actions().createGroupDm({ userIds })).toMatchObject({
        ok: false,
        code: "INVALID_INPUT",
      });
    }
    expect(
      await actions().createGroupDm({ userIds: ids, name: "😀".repeat(31) }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(
      await actions().createGroupDm({
        userIds: [actors.operator.userId, crypto.randomUUID()],
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(
      await database.db
        .select()
        .from(chatRooms)
        .where(eq(chatRooms.kind, "group_dm")),
    ).toEqual([]);
    expect(
      (await queries().getDirectMessageView(await create(ids)))?.kind,
    ).toBe("group_dm");
  });

  it.each(["stranger", "unverified", "blocked-by-me", "blocked-by-peer"])(
    "rejects %s candidates before writing",
    async (reason) => {
      const target = reason === "stranger" ? actors.operator : actors.outsider;
      if (reason === "unverified")
        await database.db
          .update(users)
          .set({ emailVerified: false })
          .where(eq(users.id, target.userId));
      if (reason.startsWith("blocked"))
        await database.db.insert(userBlocks).values({
          blockerId:
            reason === "blocked-by-me" ? actors.member.userId : target.userId,
          blockedId:
            reason === "blocked-by-me" ? target.userId : actors.member.userId,
        });
      expect(
        await actions().createGroupDm({
          userIds: [actors.admin.userId, target.userId],
        }),
      ).toEqual({
        ok: false,
        code: reason === "unverified" ? "NOT_FOUND" : "FORBIDDEN",
      });
      expect(events).toEqual([]);
    },
  );

  it("ignores existing members and enforces ten-member capacity without partial insertions", async () => {
    const roomId = await create();
    const ids = await extraPeople(8);
    events.length = 0;
    expect(
      await actions().addGroupMembers({
        roomId,
        userIds: [actors.member.userId, actors.admin.userId],
      }),
    ).toEqual({ ok: true, data: {} });
    expect(events).toEqual([]);
    expect(
      await actions().addGroupMembers({
        roomId,
        userIds: [actors.admin.userId, ...ids.slice(0, 7)],
      }),
    ).toMatchObject({ ok: true });
    expect(await actions().addGroupMembers({ roomId, userIds: ids })).toEqual({
      ok: false,
      code: "LIMIT_EXCEEDED",
    });
    expect(
      (await queries().getDirectMessageView(roomId))?.members,
    ).toHaveLength(10);
    const nav = (await queries().getMyChatNav()).directMessages[0];
    expect(nav).toMatchObject({ kind: "group_dm", memberCount: 10 });
    expect(nav?.kind === "group_dm" && nav.members).toHaveLength(3);
    expect(await rowMessages(roomId)).toHaveLength(2);
    expect(
      await actions().addGroupMembers({
        roomId,
        userIds: [actors.operator.userId, crypto.randomUUID()],
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("rejoins a left member with a new unread boundary while keeping all history readable", async () => {
    const roomId = await create();
    await send(roomId, "이전 대화");
    await actions(actors.outsider, later).leaveGroupDm({ roomId });
    events.length = 0;
    const rejoin = new Date(later.getTime() + 60_000);
    expect(
      await actions(actors.member, rejoin).addGroupMembers({
        roomId,
        userIds: [actors.outsider.userId],
      }),
    ).toMatchObject({ ok: true });
    expect(await membership(roomId, actors.outsider.userId)).toMatchObject({
      status: "active",
      joinedAt: rejoin,
      statusChangedAt: rejoin,
    });
    const view = await queries(actors.outsider).getDirectMessageView(roomId);
    expect(view?.messages).toHaveLength(4);
    expect(view?.firstUnreadSeq).toBeNull();
    expect(
      (await queries(actors.outsider).getMyChatNav()).directMessages[0],
    ).toMatchObject({ unreadCount: 0 });
    expect(events.map(({ event }) => event.type)).toEqual([
      "room.changed",
      "room.activity",
      "room.activity",
    ]);
  });

  it.each(["left", "capacity"])(
    "rechecks %s while the room lock is obtained",
    async (change) => {
      const roomId = await create();
      const ids = await extraPeople(8);
      const original = groups.lockedGroup;
      vi.spyOn(groups, "lockedGroup").mockImplementationOnce(async (id, tx) => {
        if (change === "left")
          await tx
            .update(chatRoomMembers)
            .set({ status: "left" })
            .where(
              and(
                eq(chatRoomMembers.roomId, id),
                eq(chatRoomMembers.userId, actors.member.userId),
              ),
            );
        else await groups.activateGroupMembers(id, ids.slice(0, 7), now, tx);
        return original(id, tx);
      });
      events.length = 0;
      expect(
        await actions().addGroupMembers({ roomId, userIds: [ids[7]!] }),
      ).toEqual({
        ok: false,
        code: change === "left" ? "NOT_FOUND" : "LIMIT_EXCEEDED",
      });
      expect(await rowMessages(roomId)).toHaveLength(1);
      expect(events).toEqual([]);
    },
  );

  it("renames exactly once, advances only the actor cursor and preserves mute", async () => {
    const roomId = await create();
    await actions().setRoomMuted({ roomId, muted: true });
    events.length = 0;
    expect(
      await actions(actors.member, later).renameGroupDm({
        roomId,
        name: "  회의  ",
      }),
    ).toMatchObject({ ok: true });
    expect(await room(roomId)).toMatchObject({ name: "회의", lastSeq: 2 });
    expect(
      await database.db
        .select()
        .from(chatRoomReads)
        .where(eq(chatRoomReads.roomId, roomId)),
    ).toMatchObject([
      { userId: actors.member.userId, lastReadSeq: 2, muted: true },
    ]);
    expect(
      (await queries(actors.admin).getMyChatNav()).directMessages[0],
    ).toMatchObject({ unread: true, unreadCount: 1 });
    expect(events.map(({ event }) => event.type)).toEqual([
      "room.changed",
      "room.activity",
      "room.activity",
    ]);
    events.length = 0;
    await actions().renameGroupDm({ roomId, name: "회의" });
    expect(events).toEqual([]);
    await actions().renameGroupDm({ roomId, name: "   " });
    expect(await room(roomId)).toMatchObject({ name: null, lastSeq: 3 });
  });

  it("removes access on leaving and archives after the final active member leaves", async () => {
    const roomId = await create();
    events.length = 0;
    expect(
      await actions(actors.member, later).leaveGroupDm({ roomId }),
    ).toMatchObject({ ok: true });
    expect(await queries().getDirectMessageView(roomId)).toBeNull();
    expect(
      await canReadRoom(actors.member.userId, roomId, database.db),
    ).toBeNull();
    expect(await send(roomId, "나간 뒤")).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await actions().setRoomMuted({ roomId, muted: true })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await actions().leaveGroupDm({ roomId })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(
      (
        await database.db
          .select()
          .from(chatRoomReads)
          .where(eq(chatRoomReads.roomId, roomId))
      )[0]?.lastReadSeq,
    ).toBe(1);
    expect(events.map(({ event }) => event.type)).toEqual([
      "room.changed",
      "room.activity",
      "room.activity",
      "realtime.reauth",
    ]);
    await actions(actors.admin, later).leaveGroupDm({ roomId });
    events.length = 0;
    await actions(actors.outsider, later).leaveGroupDm({ roomId });
    expect(await room(roomId)).toMatchObject({ archivedAt: later, lastSeq: 4 });
    expect(events.map(({ event }) => event.type)).toEqual([
      "room.changed",
      "realtime.reauth",
    ]);
  });

  it("forbids archived writes and hides every read/write from nonmembers", async () => {
    const roomId = await create();
    expect(
      await queries(actors.operator).getDirectMessageView(roomId),
    ).toBeNull();
    for (const action of [
      actions(actors.operator).renameGroupDm({ roomId, name: "권한 없음" }),
      actions(actors.operator).addGroupMembers({
        roomId,
        userIds: [actors.operator.userId],
      }),
      actions(actors.operator).leaveGroupDm({ roomId }),
    ])
      expect(await action).toEqual({ ok: false, code: "NOT_FOUND" });
    await database.db
      .update(chatRooms)
      .set({ archivedAt: later })
      .where(eq(chatRooms.id, roomId));
    expect(
      (await canWriteRoom(actors.member.userId, roomId, database.db)).canWrite,
    ).toBe(false);
    expect(await actions().renameGroupDm({ roomId, name: "새 이름" })).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(
      await actions().addGroupMembers({
        roomId,
        userIds: [actors.admin.userId],
      }),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("keeps shared-group messages writable despite a block but omits recipient mentions", async () => {
    const roomId = await create();
    await database.db.insert(userBlocks).values({
      blockerId: actors.outsider.userId,
      blockedId: actors.member.userId,
    });
    events.length = 0;
    const result = await send(
      roomId,
      `<@everyone> <@${actors.outsider.userId}> 안녕하세요`,
    );
    expect(result).toMatchObject({
      ok: true,
      data: { mentionsEveryone: true, mentions: [] },
    });
    if (!result.ok) return;
    expect(await database.db.select().from(messageMentions)).toEqual([]);
    expect(
      events
        .filter(({ event }) => event.type === "room.activity")
        .map(({ channel }) => channel)
        .sort(),
    ).toEqual(
      [`user:${actors.admin.userId}`, `user:${actors.outsider.userId}`].sort(),
    );
    expect(
      events.filter(({ event }) => event.type === "mention.created"),
    ).toMatchObject([
      {
        channel: `user:${actors.admin.userId}`,
        event: {
          roomName: [actors.member.name, actors.outsider.name]
            .sort((a, b) => a.localeCompare(b, "ko"))
            .join(", "),
        },
      },
    ]);
    expect(
      (await queries(actors.outsider).getMyChatNav()).directMessages[0],
    ).toMatchObject({ unreadCount: 1, unreadMentions: 0 });
    expect(
      await actions(actors.admin).deleteMessage({ messageId: result.data.id }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(
      await actions().editMessage({ messageId: result.data.id, body: "수정" }),
    ).toMatchObject({ ok: true });
    events.length = 0;
    await actions(actors.admin).markRoomRead({ roomId, seq: result.data.seq });
    expect(events.some(({ event }) => event.type === "room.read")).toBe(false);
  });

  it("returns a discriminated, minimal group view and sharesSpace without trusting friendship", async () => {
    const roomId = await create();
    const view = await queries().getDirectMessageView(roomId);
    expect(view).toMatchObject({
      kind: "group_dm",
      name: null,
      members: expect.arrayContaining([
        {
          userId: actors.admin.userId,
          avatar: {
            color: avatarColorFor(actors.admin.userId, null),
            photoUrl: null,
          },
          name: actors.admin.name,
          username: null,
          sharesSpace: true,
        },
        {
          userId: actors.outsider.userId,
          avatar: {
            color: avatarColorFor(actors.outsider.userId, null),
            photoUrl: null,
          },
          name: actors.outsider.name,
          username: null,
          sharesSpace: false,
        },
      ]),
    });
    expect(view).not.toHaveProperty("other");
    expect(view).not.toHaveProperty("peerReadSeq");
    expect(view).not.toHaveProperty("request");
    await database.db
      .update(chatSpaces)
      .set({ deletedAt: later })
      .where(eq(chatSpaces.id, actors.spaceId));
    const next = await queries().getDirectMessageView(roomId);
    expect(
      next?.kind === "group_dm" &&
        next.members.find(({ userId }) => userId === actors.admin.userId)
          ?.sharesSpace,
    ).toBe(false);
  });

  it("keeps mixed navigation and group views within the existing fixed query budgets", async () => {
    const first = await create();
    const dm = await actions().openDirectMessage({
      userId: actors.admin.userId,
    });
    if (!dm.ok) throw new Error("DM setup failed");
    await send(dm.data.roomId, "DM");
    for (let i = 0; i < 50; i++) await create();
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      const nav = await queries().getMyChatNav();
      expect(meter.stop().perStage).toEqual([4]);
      expect(nav.directMessages).toHaveLength(50);
      expect(nav.directMessages.some(({ kind }) => kind === "dm")).toBe(true);
      expect(
        nav.directMessages
          .filter(({ kind }) => kind === "group_dm")
          .every(
            (item) =>
              Object.keys(item).sort().join() ===
              [
                "kind",
                "roomId",
                "name",
                "lastSeq",
                "lastMessageAt",
                "memberCount",
                "members",
                "unread",
                "unreadCount",
                "unreadMentions",
                "muted",
              ]
                .sort()
                .join(),
          ),
      ).toBe(true);
      meter.start();
      await queries().getDirectMessageView(first);
      expect(meter.stop().perStage).toEqual([1, 2]);
      meter.start();
      await queries().getRoomMessagesPage(first, { before: "999" });
      expect(meter.stop().perStage).toEqual([2]);
    } finally {
      meter.restore();
    }
  });

  it("locks sorted users before room and member rows", async () => {
    const roomId = await create();
    const [id] = await extraPeople(1);
    statements.length = 0;
    await actions().addGroupMembers({ roomId, userIds: [id!] });
    const locks = statements.filter(({ text }) =>
      /for (key share|update)/i.test(text),
    );
    expect(locks[0]?.text).toMatch(
      /from "users".*order by "users"\."id".*for key share/i,
    );
    expect(locks[1]?.text).toMatch(/from "chat_rooms".*for update/i);
    expect(locks[2]?.text).toMatch(
      /from "chat_room_members".*order by.*for update/i,
    );
  });

  it("rolls back group creation and membership changes when the system insert fails", async () => {
    const roomId = await create();
    const [newId] = await extraPeople(1);
    const original = writes.insertSystemMessage;
    vi.spyOn(writes, "insertSystemMessage").mockImplementation(
      async (...args) => {
        await original(...args);
        throw new Error("injected after insert");
      },
    );
    events.length = 0;
    expect(
      await actions().createGroupDm({
        userIds: [actors.admin.userId, actors.outsider.userId],
      }),
    ).toEqual({ ok: false, code: "INTERNAL" });
    expect(
      await actions().addGroupMembers({ roomId, userIds: [newId!] }),
    ).toEqual({ ok: false, code: "INTERNAL" });
    expect(await actions().renameGroupDm({ roomId, name: "실패" })).toEqual({
      ok: false,
      code: "INTERNAL",
    });
    expect(await actions().leaveGroupDm({ roomId })).toEqual({
      ok: false,
      code: "INTERNAL",
    });
    expect(await room(roomId)).toMatchObject({ name: null, lastSeq: 1 });
    expect(await membership(roomId, actors.member.userId)).toMatchObject({
      status: "active",
    });
    expect(await membership(roomId, newId!)).toBeUndefined();
    expect(
      await database.db
        .select()
        .from(chatRooms)
        .where(eq(chatRooms.kind, "group_dm")),
    ).toHaveLength(1);
    expect(events).toEqual([]);
  });
});

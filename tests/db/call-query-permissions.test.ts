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
import { createCallQueries } from "@/features/calls/query-factory";
import {
  createChatQueries,
  type ChatQueryDependencies,
} from "@/features/chat/query-factory";
import * as schema from "@/lib/db/schema";
import {
  bookings,
  branches,
  callParticipants,
  callSessions,
  chatRoomMembers,
  chatRooms,
  floors,
  spaces,
  userBlocks,
} from "@/lib/db/schema";
import { chatNow, seedChatActors, type ChatActors } from "./chat-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

describe("call query permission boundaries", () => {
  let database: TestDatabase;
  let actors: ChatActors;
  let now: Date;
  const statements: { text: string; params: unknown[] }[] = [];
  beforeAll(async () => {
    database = await createTestDatabase();
    database.db = drizzle({
      client: database.client,
      schema,
      logger: {
        logQuery: (text, params) => statements.push({ text, params }),
      },
    });
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    await database.db.execute(sql`truncate users, branches cascade`);
    actors = await seedChatActors(database);
    now = new Date(chatNow);
    statements.length = 0;
  });
  const dependencies = (
    user = actors.member,
    extra: ChatQueryDependencies = {},
  ): ChatQueryDependencies => ({
    database: database.db,
    requireSession: async () => user,
    now: () => now,
    callsEnabled: true,
    ...extra,
  });
  const queries = (user = actors.member, extra: ChatQueryDependencies = {}) =>
    createChatQueries(dependencies(user, extra));
  const voiceQueries = (
    user = actors.member,
    extra: ChatQueryDependencies = {},
  ) => createCallQueries(dependencies(user, extra));
  async function voice() {
    const [room] = await database.db
      .select()
      .from(chatRooms)
      .where(
        and(eq(chatRooms.spaceId, actors.spaceId), eq(chatRooms.kind, "voice")),
      );
    if (!room) throw new Error("Missing voice fixture");
    return room;
  }
  async function direct(
    status: "active" | "requested" | "declined" = "active",
    group = false,
  ) {
    const [low, high] = [actors.member.userId, actors.admin.userId].sort();
    const [room] = await database.db
      .insert(chatRooms)
      .values(
        group
          ? { kind: "group_dm", name: "가상 통화 그룹" }
          : { kind: "dm", dmLowUserId: low!, dmHighUserId: high! },
      )
      .returning();
    if (!room) throw new Error("Missing direct fixture");
    await database.db.insert(chatRoomMembers).values(
      [actors.member, actors.admin].map((person) => ({
        roomId: room.id,
        userId: person.userId,
        status: person === actors.admin ? status : ("active" as const),
        requestedAt: status === "active" ? null : now,
        joinedAt: now,
        statusChangedAt: now,
      })),
    );
    return room;
  }
  async function meeting() {
    const [branch] = await database.db
      .insert(branches)
      .values({ name: "가상 통화 검사 지점" })
      .returning();
    const [floor] = await database.db
      .insert(floors)
      .values({ branchId: branch!.id, level: 1, name: "1F" })
      .returning();
    const [space] = await database.db
      .insert(spaces)
      .values({ floorId: floor!.id, type: "meeting_room", name: "통화 회의실" })
      .returning();
    const start = new Date(chatNow.getTime() + 600_000);
    const end = new Date(chatNow.getTime() + 3_600_000);
    const [booking] = await database.db
      .insert(bookings)
      .values({
        userId: actors.member.userId,
        spaceId: space!.id,
        during: { start, end },
        title: "가상 회의",
      })
      .returning();
    const [room] = await database.db
      .insert(chatRooms)
      .values({ kind: "meeting", bookingId: booking!.id })
      .returning();
    if (!booking || !room) throw new Error("Missing meeting fixture");
    return { booking, room, start, end };
  }
  async function open(roomId: string, kind: "huddle" | "voice" = "huddle") {
    const [session] = await database.db
      .insert(callSessions)
      .values({ roomId, kind, startedAt: now })
      .returning();
    if (!session) throw new Error("Missing call fixture");
    await database.db.insert(callParticipants).values({
      sessionId: session.id,
      userId: actors.admin.userId,
      joinedAt: now,
      lastSeenAt: now,
    });
    return session;
  }

  it.each(["navigation", "channel", "voice", "direct", "meeting"] as const)(
    "independently rejects a missing session in %s before input or DAL access",
    async (kind) => {
      const denial = new Error("no session");
      const requireSession = vi.fn().mockRejectedValue(denial);
      const api = queries(actors.member, { requireSession });
      const request = {
        navigation: () => api.getMyChatNav(),
        channel: () => api.getChannelView("invalid", "invalid"),
        voice: () =>
          voiceQueries(actors.member, { requireSession }).getVoiceChannelView(
            "invalid",
            "invalid",
          ),
        direct: () => api.getDirectMessageView("invalid"),
        meeting: () => api.getMeetingView("invalid"),
      }[kind];
      await expect(request()).rejects.toBe(denial);
      expect(requireSession).toHaveBeenCalledOnce();
      expect(statements).toEqual([]);
    },
  );
  it("rejects malformed voice parents or room ids before any SQL", async () => {
    for (const [spaceId, roomId] of [
      ["invalid", actors.roomId],
      [actors.spaceId, "invalid"],
      ["", ""],
    ])
      expect(
        await voiceQueries().getVoiceChannelView(spaceId!, roomId!),
      ).toBeNull();
    expect(statements).toEqual([]);
  });
  it("does not load messages or a roster for a valid voice room under the wrong parent", async () => {
    const room = await voice();
    await open(room.id, "voice");
    statements.length = 0;
    expect(
      await queries().getChannelView(actors.otherSpace.spaceId, room.id),
    ).toBeNull();
    expect(statements).toHaveLength(1);
    expect(
      await voiceQueries().getVoiceChannelView(
        actors.otherSpace.spaceId,
        room.id,
      ),
    ).toBeNull();
    expect(statements).toHaveLength(2);
    for (const statement of statements)
      expect(statement.text).not.toMatch(/from "messages"|from "team_members"/);
  });
  it("keeps foreign voice rooms hidden from a known nonmember", async () => {
    const room = await voice();
    await open(room.id, "voice");
    expect(
      await voiceQueries(actors.outsider).getVoiceChannelView(
        actors.spaceId,
        room.id,
      ),
    ).toBeNull();
    expect(
      await queries(actors.outsider).getChannelView(actors.spaceId, room.id),
    ).toBeNull();
    const nav = await queries(actors.outsider).getMyChatNav();
    expect(JSON.stringify(nav)).not.toContain(actors.spaceId);
    expect(JSON.stringify(nav)).not.toContain(actors.admin.name);
  });
  it("uses the voice kind explicitly while keeping text-only helpers separate", async () => {
    const room = await voice();
    expect(
      await voiceQueries().getVoiceChannelView(actors.spaceId, actors.roomId),
    ).toBeNull();
    expect(
      await queries().getChannelView(actors.spaceId, room.id),
    ).toMatchObject({
      room: { id: room.id, kind: "voice" },
      canWrite: true,
      canCall: true,
    });
    expect(
      await voiceQueries().getVoiceChannelView(
        actors.spaceId.toUpperCase(),
        room.id.toUpperCase(),
      ),
    ).toMatchObject({ room: { id: room.id }, canCall: true });
  });
  it.each(["active", "requested", "declined"] as const)(
    "only allows an established active DM to offer calling (%s)",
    async (status) => {
      const room = await direct(status);
      const sender = await queries().getDirectMessageView(room.id);
      expect(sender?.canCall).toBe(status === "active");
      expect(sender?.kind).toBe("dm");
      const recipient = await queries(actors.admin).getDirectMessageView(
        room.id,
      );
      if (status === "declined") expect(recipient).toBeNull();
      else expect(recipient?.canCall).toBe(status === "active");
    },
  );
  it.each(["self", "peer"])(
    "does not offer a call when a DM is blocked by %s",
    async (by) => {
      const room = await direct();
      const [blockerId, blockedId] =
        by === "self"
          ? [actors.member.userId, actors.admin.userId]
          : [actors.admin.userId, actors.member.userId];
      await database.db
        .insert(userBlocks)
        .values({ blockerId: blockerId!, blockedId: blockedId! });
      const view = await queries().getDirectMessageView(room.id);
      expect(view).toMatchObject({ canWrite: false, canCall: false });
      expect(view?.kind === "dm" && view.blockedByMe).toBe(by === "self");
    },
  );
  it("does not reveal a group's call or roster to a member who left", async () => {
    const room = await direct("active", true);
    await open(room.id);
    expect(await queries().getDirectMessageView(room.id)).toMatchObject({
      canCall: true,
    });
    await database.db
      .update(chatRoomMembers)
      .set({ status: "left" })
      .where(
        and(
          eq(chatRoomMembers.roomId, room.id),
          eq(chatRoomMembers.userId, actors.member.userId),
        ),
      );
    expect(await queries().getDirectMessageView(room.id)).toBeNull();
    expect((await queries().getMyChatNav()).calls).toEqual([]);
  });
  it.each([
    [-1, false],
    [0, true],
    [3_599_999, true],
    [3_600_000, false],
  ] as const)(
    "uses meeting join boundaries at offset %i",
    async (offset, allowed) => {
      const { booking } = await meeting();
      now = new Date(chatNow.getTime() + offset);
      expect((await queries().getMeetingView(booking.id))?.canCall).toBe(
        allowed,
      );
    },
  );
  it("keeps a cancelled meeting readable without offering a new call", async () => {
    const { booking } = await meeting();
    await database.db
      .update(bookings)
      .set({
        status: "cancelled",
        cancelledAt: now,
        cancelledBy: actors.member.userId,
      })
      .where(eq(bookings.id, booking.id));
    expect(await queries().getMeetingView(booking.id)).toMatchObject({
      canCall: false,
      canWrite: false,
      readOnlyReason: "cancelled",
    });
  });
  it("does not expose a meeting call to a user outside its reservation", async () => {
    const { booking, room } = await meeting();
    await open(room.id);
    expect(
      await queries(actors.outsider).getMeetingView(booking.id),
    ).toBeNull();
    expect((await queries(actors.outsider).getMyChatNav()).calls).toEqual([]);
  });
  it("does not offer admin-only or archived channel calls even to an admin", async () => {
    await database.db
      .update(chatRooms)
      .set({ adminOnly: true })
      .where(eq(chatRooms.id, actors.roomId));
    expect(
      await queries(actors.admin).getChannelView(actors.spaceId, actors.roomId),
    ).toMatchObject({ canWrite: true, canCall: false });
    const room = await voice();
    await database.db
      .update(chatRooms)
      .set({ archivedAt: now })
      .where(eq(chatRooms.id, room.id));
    expect(
      await voiceQueries().getVoiceChannelView(actors.spaceId, room.id),
    ).toMatchObject({ canCall: false, room: { archived: true } });
    expect(
      await queries().getChannelView(actors.spaceId, room.id),
    ).toMatchObject({ canCall: false, canWrite: false });
  });
  it("uses one session and fixed clock per view and does not offer calls when disabled", async () => {
    const room = await direct();
    const { booking } = await meeting();
    const voiceRoom = await voice();
    const clock = vi.fn(() => now);
    const readSession = vi.fn(async () => actors.member);
    const extra = {
      now: clock,
      requireSession: readSession,
      callsEnabled: false,
    };
    const api = queries(actors.member, extra);
    for (const read of [
      () => api.getChannelView(actors.spaceId, actors.roomId),
      () => api.getChannelView(actors.spaceId, voiceRoom.id),
      () => api.getDirectMessageView(room.id),
      () => api.getMeetingView(booking.id),
      () =>
        voiceQueries(actors.member, extra).getVoiceChannelView(
          actors.spaceId,
          voiceRoom.id,
        ),
    ]) {
      readSession.mockClear();
      clock.mockClear();
      expect(await read()).toMatchObject({
        call: null,
        canCall: false,
        now: now.toISOString(),
      });
      expect(readSession).toHaveBeenCalledOnce();
      expect(clock).toHaveBeenCalledOnce();
    }
  });
  it("joins call snapshots into the permission SQL without adding stages or standalone call reads", async () => {
    const room = await direct();
    const voiceRoom = await voice();
    const { booking } = await meeting();
    const meter = createQueryMeter(database.client);
    try {
      for (const [read, budget] of [
        [() => queries().getChannelView(actors.spaceId, actors.roomId), [1, 2]],
        [() => queries().getChannelView(actors.spaceId, voiceRoom.id), [1, 2]],
        [() => queries().getDirectMessageView(room.id), [1, 2]],
        [() => queries().getMeetingView(booking.id), [1, 2]],
        [
          () =>
            voiceQueries().getVoiceChannelView(actors.spaceId, voiceRoom.id),
          [1],
        ],
      ] as const) {
        statements.length = 0;
        meter.start();
        expect(await read()).not.toBeNull();
        expect(meter.stop().perStage).toEqual(budget);
        expect(statements[0]!.text).toMatch(/left join lateral/i);
        expect(statements[0]!.text).toContain("call_sessions");
        expect(
          statements.filter(({ text }) => text.includes("call_sessions")),
        ).toHaveLength(1);
        expect(
          statements[0]!.params.some(
            (value) =>
              value instanceof Date &&
              value.getTime() === now.getTime() - 120_000,
          ),
        ).toBe(true);
      }
    } finally {
      meter.restore();
    }
  });
});

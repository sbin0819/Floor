import { and, asc, eq, isNull, sql } from "drizzle-orm";
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
import { createCallActions } from "@/features/calls/action-factory";
import {
  createCallService,
  type CallDependencies,
} from "@/features/calls/service";
import type { Session } from "@/lib/auth/types";
import type { LiveKitServer } from "@/lib/calls/types";
import { canStayInCall } from "@/lib/dal/call-access";
import * as callWrites from "@/lib/dal/call-write";
import * as chatAccess from "@/lib/dal/chat-access";
import * as chatWrites from "@/lib/dal/chat-write";
import * as schema from "@/lib/db/schema";
import {
  bookings,
  branches,
  callParticipants,
  callSessions,
  chatRoomMembers,
  chatRooms,
  chatSpaceMembers,
  floors,
  messages,
  roleSettings,
  spaces,
  userBlocks,
  users,
} from "@/lib/db/schema";
import { createMemoryRateLimiter } from "@/lib/rate-limit/memory";
import {
  roomChannel,
  spaceChannel,
  userChannel,
} from "@/lib/realtime/channels";
import { createMemoryRealtime } from "@/lib/realtime/memory";
import type { RealtimeItem } from "@/lib/realtime/types";
import { chatNow, seedChatActors, type ChatActors } from "./chat-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("call actions and participant lifecycle", () => {
  let database: TestDatabase;
  let actors: ChatActors;
  let now: Date;
  let livekit: LiveKitServer;
  let limiter: ReturnType<typeof createMemoryRateLimiter>;
  let memory: ReturnType<typeof createMemoryRealtime>;
  const events: RealtimeItem[] = [];
  const queries: { text: string; params: unknown[] }[] = [];
  const logError = vi.fn();
  const publisher = {
    publish: vi.fn(async (channel: string, event: RealtimeItem["event"]) =>
      memory.publish(channel, event),
    ),
    publishMany: vi.fn(async (items: readonly RealtimeItem[]) => {
      events.push(...items);
      await memory.publishMany([...items]);
    }),
  };
  beforeAll(async () => {
    database = await createTestDatabase();
    database.db = drizzle({
      client: database.client,
      schema,
      logger: { logQuery: (text, params) => queries.push({ text, params }) },
    });
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await database.db.execute(sql`truncate users, branches cascade`);
    actors = await seedChatActors(database);
    now = new Date(chatNow);
    limiter = createMemoryRateLimiter(() => now.getTime());
    memory = createMemoryRealtime();
    livekit = {
      serverUrl: "wss://calls.example.test",
      issueToken: vi
        .fn<LiveKitServer["issueToken"]>()
        .mockResolvedValue("fake-token"),
      removeParticipant: vi
        .fn<LiveKitServer["removeParticipant"]>()
        .mockResolvedValue(),
      verifyWebhook: vi
        .fn<LiveKitServer["verifyWebhook"]>()
        .mockResolvedValue({ event: "ignored" }),
    };
    queries.length = 0;
    events.length = 0;
  });
  const dependencies = (extra: CallDependencies = {}): CallDependencies => ({
    database: database.db,
    now: () => now,
    livekit,
    limiter,
    publisher,
    logError,
    ...extra,
  });
  const actions = (
    session: Session | null = actors.member,
    extra: CallDependencies = {},
  ) =>
    createCallActions({
      ...dependencies(extra),
      getSession: async () => session,
    });
  const service = (extra: CallDependencies = {}) =>
    createCallService(dependencies(extra));
  async function join(
    roomId = actors.roomId,
    session = actors.member,
    extra: CallDependencies = {},
  ) {
    const result = await actions(session, extra).joinCall({ roomId });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Join failed: ${result.code}`);
    return result.data;
  }
  async function voice(capacity = 10) {
    const [room] = await database.db
      .select()
      .from(chatRooms)
      .where(
        and(eq(chatRooms.spaceId, actors.spaceId), eq(chatRooms.kind, "voice")),
      );
    if (!room) throw new Error("Missing default voice room");
    await database.db
      .update(chatRooms)
      .set({ voiceCapacity: capacity })
      .where(eq(chatRooms.id, room.id));
    return room.id;
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
          ? { kind: "group_dm", name: "가상 그룹" }
          : { kind: "dm", dmLowUserId: low!, dmHighUserId: high! },
      )
      .returning();
    await database.db.insert(chatRoomMembers).values(
      [actors.member, actors.admin].map((person) => ({
        roomId: room!.id,
        userId: person.userId,
        status:
          person.userId === actors.admin.userId ? status : ("active" as const),
        requestedAt: status === "active" ? null : now,
        joinedAt: now,
        statusChangedAt: now,
      })),
    );
    return room!.id;
  }
  async function meeting() {
    const [branch] = await database.db
      .insert(branches)
      .values({ name: "가상 회의 지점" })
      .returning();
    const [floor] = await database.db
      .insert(floors)
      .values({ branchId: branch!.id, level: 1, name: "1F" })
      .returning();
    const [space] = await database.db
      .insert(spaces)
      .values({ floorId: floor!.id, type: "meeting_room", name: "회의 공간" })
      .returning();
    const start = new Date(chatNow.getTime() + 600_000),
      end = new Date(chatNow.getTime() + 3_600_000);
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
    return { roomId: room!.id, bookingId: booking!.id, start, end };
  }
  async function messageData(roomId = actors.roomId) {
    return database.db
      .select({
        kind: messages.kind,
        body: messages.body,
        systemData: messages.systemData,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.roomId, roomId))
      .orderBy(asc(messages.seq));
  }
  async function participant(id: string) {
    const [row] = await database.db
      .select()
      .from(callParticipants)
      .where(eq(callParticipants.id, id));
    return row!;
  }
  async function session(id: string) {
    const [row] = await database.db
      .select()
      .from(callSessions)
      .where(eq(callSessions.id, id));
    return row!;
  }
  const callEvents = () =>
    events.filter(({ event }) => event.type === "call.changed");

  it("requires a session before input validation and checks disabled state without touching DB", async () => {
    expect(await actions(null).joinCall({ roomId: "bad" })).toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    expect(await actions().joinCall({ roomId: "bad" })).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect(
      await actions(actors.member, { livekit: null }).joinCall({
        roomId: actors.roomId,
      }),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(
      await service({ livekit: null }).heartbeat({
        userId: actors.member.userId,
        participantId: crypto.randomUUID(),
      }),
    ).toBe(false);
    expect(
      await service({ livekit: null }).leave({
        userId: actors.member.userId,
        participantId: crypto.randomUUID(),
      }),
    ).toBe(false);
    expect(queries).toHaveLength(0);
    expect(livekit.issueToken).not.toHaveBeenCalled();
  });
  it("returns the same not-found code for an absent or inaccessible room", async () => {
    for (const roomId of [crypto.randomUUID(), actors.otherSpace.roomId])
      expect(await actions().joinCall({ roomId })).toEqual({
        ok: false,
        code: "NOT_FOUND",
      });
    expect(await database.db.select().from(callSessions)).toEqual([]);
    expect(events).toEqual([]);
  });
  it.each(["archived", "admin-only"] as const)(
    "does not join a %s text room even as its administrator",
    async (kind) => {
      await database.db
        .update(chatRooms)
        .set(kind === "archived" ? { archivedAt: now } : { adminOnly: true })
        .where(eq(chatRooms.id, actors.roomId));
      expect(
        await actions(actors.admin).joinCall({ roomId: actors.roomId }),
      ).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(livekit.issueToken).not.toHaveBeenCalled();
    },
  );
  it("creates a voice call with no system messages and uses the room's capacity", async () => {
    const roomId = await voice(2);
    const joined = await join(roomId);
    expect(joined).toEqual({
      participantId: expect.any(String),
      sessionId: expect.any(String),
      serverUrl: livekit.serverUrl,
      token: "fake-token",
      room: `call:${roomId}`,
      kind: "voice",
    });
    expect(await session(joined.sessionId)).toMatchObject({
      kind: "voice",
      startedBy: null,
      startedAt: now,
      endedAt: null,
    });
    expect(await participant(joined.participantId)).toMatchObject({
      userId: actors.member.userId,
      joinedAt: now,
      lastSeenAt: now,
      leftAt: null,
    });
    expect(livekit.issueToken).toHaveBeenCalledExactlyOnceWith({
      participantId: joined.participantId,
      userId: actors.member.userId,
      name: actors.member.name,
      room: `call:${roomId}`,
      maxParticipants: 2,
    });
    expect(await messageData(roomId)).toEqual([]);
  });
  it.each([false, true])(
    "creates a %s DM huddle only for active members",
    async (group) => {
      const roomId = await direct("active", group);
      const joined = await join(roomId);
      expect(joined.kind).toBe("huddle");
      expect(await messageData(roomId)).toMatchObject([
        {
          kind: "system",
          systemData: { type: "huddle_started", actorName: actors.member.name },
        },
      ]);
      expect(livekit.issueToken).toHaveBeenCalledWith(
        expect.objectContaining({ maxParticipants: 10 }),
      );
    },
  );
  it.each(["requested", "declined"] as const)(
    "denies calls from both sides of a %s DM",
    async (status) => {
      const roomId = await direct(status);
      for (const person of [actors.member, actors.admin]) {
        const result = await actions(person).joinCall({ roomId });
        expect(result).toEqual({
          ok: false,
          code:
            status === "declined" && person === actors.admin
              ? "NOT_FOUND"
              : "FORBIDDEN",
        });
      }
      expect(events).toEqual([]);
      expect(livekit.issueToken).not.toHaveBeenCalled();
    },
  );
  it.each(["caller", "peer"] as const)(
    "denies a DM blocked by its %s",
    async (blocker) => {
      const roomId = await direct();
      const [one, two] =
        blocker === "caller"
          ? [actors.member, actors.admin]
          : [actors.admin, actors.member];
      await database.db
        .insert(userBlocks)
        .values({ blockerId: one.userId, blockedId: two.userId });
      expect(await actions().joinCall({ roomId })).toEqual({
        ok: false,
        code: "FORBIDDEN",
      });
      expect(events).toEqual([]);
    },
  );
  it.each([
    [-1, false],
    [0, true],
    [3_599_999, true],
    [3_600_000, false],
  ] as const)("checks a meeting at opening + %ims", async (offset, allowed) => {
    const data = await meeting();
    now = new Date(chatNow.getTime() + offset);
    const result = await actions().joinCall({ roomId: data.roomId });
    expect(result.ok).toBe(allowed);
    if (!allowed) expect(result).toEqual({ ok: false, code: "FORBIDDEN" });
  });
  it("denies cancelled meetings but lets an existing confirmed meeting call continue after its end", async () => {
    const data = await meeting();
    const joined = await join(data.roomId);
    now = new Date(data.end.getTime() + 48 * 3_600_000);
    expect(
      await canStayInCall(actors.member.userId, data.roomId, database.db),
    ).toBe(true);
    expect(
      await service().heartbeat({
        userId: actors.member.userId,
        participantId: joined.participantId,
      }),
    ).toBe(true);
    await database.db
      .update(bookings)
      .set({ status: "cancelled", cancelledAt: now })
      .where(eq(bookings.id, data.bookingId));
    expect(await actions().joinCall({ roomId: data.roomId })).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(
      await canStayInCall(actors.member.userId, data.roomId, database.db),
    ).toBe(false);
  });
  it("allows lounge voice despite disabled chat.lounge but denies its text huddle", async () => {
    const [branch] = await database.db
      .insert(branches)
      .values({ name: "가상 라운지" })
      .returning();
    const lounge = await chatWrites.createBranchLounge(branch!.id, database.db);
    await database.db.insert(chatSpaceMembers).values({
      spaceId: lounge.spaceId,
      userId: actors.member.userId,
      role: "member",
      status: "active",
      joinedAt: now,
      statusChangedAt: now,
    });
    await database.db
      .insert(roleSettings)
      .values({ branchId: branch!.id, role: "user", permissions: [] });
    const [voiceRoom] = await database.db
      .select()
      .from(chatRooms)
      .where(
        and(eq(chatRooms.spaceId, lounge.spaceId), eq(chatRooms.kind, "voice")),
      );
    expect((await join(voiceRoom!.id)).kind).toBe("voice");
    const [textRoom] = await database.db
      .select()
      .from(chatRooms)
      .where(
        and(
          eq(chatRooms.spaceId, lounge.spaceId),
          eq(chatRooms.name, "라운지"),
        ),
      );
    expect(await actions().joinCall({ roomId: textRoom!.id })).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(
      callEvents().every(
        ({ event }) =>
          event.type === "call.changed" && event.participants.length === 0,
      ),
    ).toBe(true);
  });
  it.each([119_999, 120_000, 120_001])(
    "counts the two-minute boundary at %ims when admitting a third caller",
    async (age) => {
      const roomId = await voice(2);
      const member = await join(roomId),
        admin = await join(roomId, actors.admin);
      await database.db
        .update(callParticipants)
        .set({ lastSeenAt: new Date(now.getTime() - age) })
        .where(eq(callParticipants.id, admin.participantId));
      await database.db
        .insert(schema.teamMembers)
        .values({ teamId: actors.teamId, userId: actors.operator.userId });
      const result = await actions(actors.operator).joinCall({ roomId });
      if (age < 120_000)
        expect(result).toEqual({
          ok: false,
          code: "LIMIT_EXCEEDED",
          message: "call_full",
        });
      else
        expect(result).toMatchObject({
          ok: true,
          data: { sessionId: member.sessionId },
        });
      expect(await participant(member.participantId)).toMatchObject({
        leftAt: null,
      });
    },
  );
  it("does not replace an existing caller if the room is already over capacity", async () => {
    const roomId = await voice(3);
    const first = await join(roomId);
    await join(roomId, actors.admin);
    await database.db
      .insert(schema.teamMembers)
      .values({ teamId: actors.teamId, userId: actors.operator.userId });
    await join(roomId, actors.operator);
    await database.db
      .update(chatRooms)
      .set({ voiceCapacity: 2 })
      .where(eq(chatRooms.id, roomId));
    expect(await actions().joinCall({ roomId })).toEqual({
      ok: false,
      code: "LIMIT_EXCEEDED",
      message: "call_full",
    });
    expect((await participant(first.participantId)).leftAt).toBeNull();
  });
  it("enforces the huddle limit of ten independently from voice capacity", async () => {
    const extra: Session[] = Array.from({ length: 9 }, (_, index) => ({
      userId: crypto.randomUUID(),
      name: `가상 사용자 ${index}`,
      email: `person-${index}@call.test`,
    }));
    await database.db
      .insert(users)
      .values(
        extra.map(({ userId, name, email }) => ({ id: userId, name, email })),
      );
    await database.db
      .insert(schema.teamMembers)
      .values(extra.map(({ userId }) => ({ teamId: actors.teamId, userId })));
    await join();
    for (const person of extra) await join(actors.roomId, person);
    expect(
      await actions(actors.admin).joinCall({ roomId: actors.roomId }),
    ).toEqual({ ok: false, code: "LIMIT_EXCEEDED", message: "call_full" });
    expect(
      await database.db
        .select()
        .from(callParticipants)
        .where(isNull(callParticipants.leftAt)),
    ).toHaveLength(10);
  });
  it("denies an archived voice channel", async () => {
    const roomId = await voice();
    await database.db
      .update(chatRooms)
      .set({ archivedAt: now })
      .where(eq(chatRooms.id, roomId));
    expect(await actions().joinCall({ roomId })).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(livekit.issueToken).not.toHaveBeenCalled();
  });
  it("rechecks call eligibility after acquiring the room lock", async () => {
    const original = chatWrites.lockRoomForMessage;
    vi.spyOn(chatWrites, "lockRoomForMessage").mockImplementation(
      async (roomId, tx) => {
        const room = await original(roomId, tx);
        await tx!
          .update(chatRooms)
          .set({ adminOnly: true })
          .where(eq(chatRooms.id, roomId));
        return room;
      },
    );
    expect(await actions().joinCall({ roomId: actors.roomId })).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(await database.db.select().from(callSessions)).toEqual([]);
    expect(livekit.issueToken).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
  it.each(["text", "voice"] as const)(
    "rechecks a deleted space after acquiring its admission lock for %s",
    async (kind) => {
      const roomId = kind === "voice" ? await voice() : actors.roomId;
      const original = chatAccess.lockMessageSpace;
      const locked = vi
        .spyOn(chatAccess, "lockMessageSpace")
        .mockImplementation(async (spaceId, tx) => {
          // 첫 권한 조회 뒤, 입장 잠금을 얻기 전에 삭제가 커밋된 상태를 재현한다.
          await tx
            .update(schema.chatSpaces)
            .set({ deletedAt: now })
            .where(eq(schema.chatSpaces.id, actors.spaceId));
          await original(spaceId, tx);
        });
      expect(await actions().joinCall({ roomId })).toEqual({
        ok: false,
        code: "NOT_FOUND",
      });
      expect(locked).toHaveBeenCalledOnce();
      expect(locked.mock.calls[0]![0]).toBe(actors.spaceId);
      expect(await database.db.select().from(callSessions)).toEqual([]);
      expect(await database.db.select().from(callParticipants)).toEqual([]);
      expect(livekit.issueToken).not.toHaveBeenCalled();
      expect(events).toEqual([]);
    },
  );
  it.each([false, true])(
    "replaces only its old participant and preserves the solo huddle even when stale=%s",
    async (stale) => {
      const first = await join();
      if (stale) now = new Date(now.getTime() + 300_000);
      events.length = 0;
      const next = await join();
      expect(next.sessionId).toBe(first.sessionId);
      expect(next.participantId).not.toBe(first.participantId);
      expect((await participant(first.participantId)).leftAt).toEqual(now);
      expect((await participant(next.participantId)).leftAt).toBeNull();
      expect(await messageData()).toHaveLength(1);
      expect(livekit.removeParticipant).toHaveBeenCalledWith(
        `call:${actors.roomId}`,
        first.participantId,
      );
      expect(events).toContainEqual({
        channel: userChannel(actors.member.userId),
        event: { type: "call.replaced", participantId: first.participantId },
      });
      expect(
        await service().leave({
          userId: actors.member.userId,
          participantId: first.participantId,
        }),
      ).toBe(true);
      expect(
        await service().heartbeat({
          userId: actors.member.userId,
          participantId: first.participantId,
        }),
      ).toBe(false);
      expect((await participant(next.participantId)).leftAt).toBeNull();
    },
  );
  it("ends an abandoned huddle at its last activity before starting a new session", async () => {
    const old = await join(actors.roomId, actors.admin);
    const lastSeenAt = new Date(now.getTime() + 80_000);
    await database.db
      .update(callParticipants)
      .set({ lastSeenAt })
      .where(eq(callParticipants.id, old.participantId));
    now = new Date(now.getTime() + 600_000);
    const next = await join();
    expect(next.sessionId).not.toBe(old.sessionId);
    expect((await session(old.sessionId)).endedAt).toEqual(lastSeenAt);
    expect((await participant(old.participantId)).leftAt).toEqual(lastSeenAt);
    expect((await messageData()).map(({ systemData }) => systemData)).toEqual([
      { type: "huddle_started", actorName: actors.admin.name },
      { type: "huddle_ended", durationMinutes: 1 },
      { type: "huddle_started", actorName: actors.member.name },
    ]);
  });
  it("moves between rooms using separate single-room transactions and closes the old huddle", async () => {
    const first = await join();
    const lock = chatWrites.lockRoomForMessage;
    const roomsByTransaction = new Map<object, Set<string>>();
    vi.spyOn(chatWrites, "lockRoomForMessage").mockImplementation(
      async (roomId, tx) => {
        const rooms = roomsByTransaction.get(tx!) ?? new Set();
        rooms.add(roomId);
        roomsByTransaction.set(tx!, rooms);
        return lock(roomId, tx);
      },
    );
    now = new Date(now.getTime() + 90_000);
    const next = await join(actors.secondRoomId);
    expect(
      [...roomsByTransaction.values()].map((roomIds) => [...roomIds]),
    ).toEqual([[actors.roomId], [actors.secondRoomId]]);
    expect((await participant(first.participantId)).leftAt).toEqual(now);
    expect((await session(first.sessionId)).endedAt).toEqual(now);
    expect((await participant(next.participantId)).leftAt).toBeNull();
    expect(livekit.removeParticipant).toHaveBeenCalledWith(
      `call:${actors.roomId}`,
      first.participantId,
    );
    expect((await messageData()).at(-1)?.systemData).toEqual({
      type: "huddle_ended",
      durationMinutes: 1,
    });
  });
  it("serializes two joiners into one open session in the PGlite transaction queue", async () => {
    const [one, two] = await Promise.all([
      join(),
      join(actors.roomId, actors.admin),
    ]);
    expect(one.sessionId).toBe(two.sessionId);
    expect(
      await database.db
        .select()
        .from(callSessions)
        .where(isNull(callSessions.endedAt)),
    ).toHaveLength(1);
    expect(
      await database.db
        .select()
        .from(callParticipants)
        .where(isNull(callParticipants.leftAt)),
    ).toHaveLength(2);
    expect(await messageData()).toHaveLength(1);
  });
  it("retains only one active participant for two parallel joins by one user", async () => {
    await Promise.all([join(), join(actors.secondRoomId)]);
    const active = await database.db
      .select()
      .from(callParticipants)
      .where(isNull(callParticipants.leftAt));
    expect(active).toHaveLength(1);
    expect(active[0]?.userId).toBe(actors.member.userId);
  });
  it("completes opposite room moves without holding two room locks in one transaction", async () => {
    await join();
    await join(actors.secondRoomId, actors.admin);
    const lock = chatWrites.lockRoomForMessage;
    const locks = new Map<object, Set<string>>();
    vi.spyOn(chatWrites, "lockRoomForMessage").mockImplementation(
      async (roomId, tx) => {
        const rooms = locks.get(tx!) ?? new Set();
        rooms.add(roomId);
        locks.set(tx!, rooms);
        return lock(roomId, tx);
      },
    );
    await Promise.all([
      join(actors.secondRoomId),
      join(actors.roomId, actors.admin),
    ]);
    const active = await database.db
      .select({ userId: callParticipants.userId, roomId: callSessions.roomId })
      .from(callParticipants)
      .innerJoin(callSessions, eq(callSessions.id, callParticipants.sessionId))
      .where(isNull(callParticipants.leftAt));
    expect(active).toEqual(
      expect.arrayContaining([
        { userId: actors.member.userId, roomId: actors.secondRoomId },
        { userId: actors.admin.userId, roomId: actors.roomId },
      ]),
    );
    expect(active).toHaveLength(2);
    expect(locks.size).toBeGreaterThanOrEqual(4);
    expect([...locks.values()].every((rooms) => rooms.size === 1)).toBe(true);
  });
  it("heartbeats in one conditional SQL and rejects missing, foreign and ended participants", async () => {
    const joined = await join();
    now = new Date(now.getTime() + 30_000);
    queries.length = 0;
    expect(
      await service().heartbeat({
        userId: actors.member.userId,
        participantId: joined.participantId,
      }),
    ).toBe(true);
    expect(queries).toHaveLength(1);
    expect(queries[0]!.text).toMatch(
      /^update "call_participants"[\s\S]*"user_id" = [\s\S]*"left_at" is null[\s\S]*returning/,
    );
    expect((await participant(joined.participantId)).lastSeenAt).toEqual(now);
    for (const input of [
      { userId: actors.admin.userId, participantId: joined.participantId },
      { userId: actors.member.userId, participantId: crypto.randomUUID() },
    ]) {
      expect(await service().heartbeat(input)).toBe(false);
      expect(await service().leave(input)).toBe(false);
    }
    await service().leave({
      userId: actors.member.userId,
      participantId: joined.participantId,
    });
    expect(
      await service().heartbeat({
        userId: actors.member.userId,
        participantId: joined.participantId,
      }),
    ).toBe(false);
  });
  it("keeps a call open while another active participant remains and ends it once", async () => {
    const one = await join(),
      two = await join(actors.roomId, actors.admin);
    now = new Date(now.getTime() + 61_000);
    expect(
      await service().leave({
        userId: actors.member.userId,
        participantId: one.participantId,
      }),
    ).toBe(true);
    expect((await session(one.sessionId)).endedAt).toBeNull();
    expect(await messageData()).toHaveLength(1);
    expect(
      await service().leave({
        userId: actors.admin.userId,
        participantId: two.participantId,
      }),
    ).toBe(true);
    expect((await session(one.sessionId)).endedAt).toEqual(now);
    expect((await messageData()).at(-1)?.systemData).toEqual({
      type: "huddle_ended",
      durationMinutes: 1,
    });
    const count = events.length;
    expect(
      await service().leave({
        userId: actors.admin.userId,
        participantId: two.participantId,
      }),
    ).toBe(true);
    expect(events).toHaveLength(count);
    expect(await messageData()).toHaveLength(2);
    expect(callEvents().at(-1)?.event).toMatchObject({
      sessionId: null,
      kind: null,
      participantCount: 0,
      participants: [],
    });
  });
  it("closes stale peers at their last-seen time when the last active person leaves", async () => {
    const one = await join(),
      two = await join(actors.roomId, actors.admin);
    const lastSeenAt = now;
    now = new Date(now.getTime() + 180_000);
    await service().heartbeat({
      userId: actors.member.userId,
      participantId: one.participantId,
    });
    await service().leave({
      userId: actors.member.userId,
      participantId: one.participantId,
    });
    expect((await participant(two.participantId)).leftAt).toEqual(lastSeenAt);
    expect((await session(one.sessionId)).endedAt).toEqual(now);
  });
  it("ends a voice session without huddle messages", async () => {
    const roomId = await voice(),
      joined = await join(roomId);
    await service().leave({
      userId: actors.member.userId,
      participantId: joined.participantId,
    });
    expect((await session(joined.sessionId)).endedAt).toEqual(now);
    expect(await messageData(roomId)).toEqual([]);
  });
  it("rings only the peer of a new DM huddle at most once per 30 seconds", async () => {
    const roomId = await direct();
    const first = await join(roomId);
    const rings = () =>
      events.filter(({ event }) => event.type === "call.ringing");
    expect(rings()).toEqual([
      {
        channel: userChannel(actors.admin.userId),
        event: {
          type: "call.ringing",
          roomId,
          sessionId: first.sessionId,
          callerId: actors.member.userId,
          callerName: actors.member.name,
        },
      },
    ]);
    await join(roomId);
    expect(rings()).toHaveLength(1);
    const current = await database.db
      .select()
      .from(callParticipants)
      .where(isNull(callParticipants.leftAt));
    await service().leave({
      userId: actors.member.userId,
      participantId: current[0]!.id,
    });
    now = new Date(chatNow.getTime() + 29_999);
    const second = await join(roomId);
    expect(rings()).toHaveLength(1);
    await service().leave({
      userId: actors.member.userId,
      participantId: second.participantId,
    });
    now = new Date(chatNow.getTime() + 30_000);
    await join(roomId);
    expect(rings()).toHaveLength(2);
  });
  it("declines only an active peer's DM huddle, publishes to both users, and changes no call rows", async () => {
    const roomId = await direct(),
      joined = await join(roomId);
    const before = await database.db.select().from(callSessions);
    events.length = 0;
    expect(
      await actions(actors.admin).declineCall({ sessionId: joined.sessionId }),
    ).toEqual({ ok: true, data: {} });
    expect(events).toEqual(
      [actors.member, actors.admin].map(({ userId }) => ({
        channel: userChannel(userId),
        event: { type: "call.declined", sessionId: joined.sessionId, roomId },
      })),
    );
    expect(await database.db.select().from(callSessions)).toEqual(before);
    for (const person of [actors.member, actors.outsider])
      expect(
        await actions(person).declineCall({ sessionId: joined.sessionId }),
      ).toEqual({ ok: false, code: "NOT_FOUND" });
    await service().leave({
      userId: actors.member.userId,
      participantId: joined.participantId,
    });
    expect(
      await actions(actors.admin).declineCall({ sessionId: joined.sessionId }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
  });
  it("rejects decline for non-DM calls and unknown sessions", async () => {
    const joined = await join();
    for (const sessionId of [joined.sessionId, crypto.randomUUID()])
      expect(await actions(actors.admin).declineCall({ sessionId })).toEqual({
        ok: false,
        code: "NOT_FOUND",
      });
  });
  it("issues a token after commit, using the stored name rather than session data", async () => {
    const transaction = vi.spyOn(database.db, "transaction");
    vi.mocked(livekit.issueToken).mockImplementation(async (input) => {
      expect(transaction.mock.settledResults.at(-1)?.type).toBe("fulfilled");
      expect(await participant(input.participantId)).toMatchObject({
        userId: actors.member.userId,
        leftAt: null,
      });
      return "signed-after-commit";
    });
    const joined = await join(actors.roomId, {
      ...actors.member,
      name: "stale-name",
    });
    expect(joined.token).toBe("signed-after-commit");
    expect(livekit.issueToken).toHaveBeenCalledWith(
      expect.objectContaining({ name: actors.member.name }),
    );
    expect(JSON.stringify({ joined, events })).not.toContain("@example.test");
  });
  it("rolls back participant/session/message changes together on an injected mid-transaction failure", async () => {
    const original = callWrites.beginCallParticipant;
    vi.spyOn(callWrites, "beginCallParticipant").mockImplementation(
      async (...args) => {
        await original(...args);
        throw new Error("secret-token private@example.test");
      },
    );
    expect(await actions().joinCall({ roomId: actors.roomId })).toEqual({
      ok: false,
      code: "INTERNAL",
    });
    expect(await database.db.select().from(callSessions)).toEqual([]);
    expect(await database.db.select().from(callParticipants)).toEqual([]);
    expect(await messageData()).toEqual([]);
    expect(livekit.issueToken).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    expect(JSON.stringify(logError.mock.calls)).not.toContain("secret-token");
  });
  it("cleans up the committed participant after token issuance failure without leaking its exception", async () => {
    vi.mocked(livekit.issueToken).mockRejectedValue(
      new Error("private token failure"),
    );
    expect(await actions().joinCall({ roomId: actors.roomId })).toEqual({
      ok: false,
      code: "INTERNAL",
    });
    const people = await database.db.select().from(callParticipants),
      sessions = await database.db.select().from(callSessions);
    expect(people).toHaveLength(1);
    expect(people[0]!.leftAt).toEqual(now);
    expect(sessions[0]!.endedAt).toEqual(now);
    expect(
      (await messageData()).map(({ systemData }) => systemData?.type),
    ).toEqual(["huddle_started", "huddle_ended"]);
    expect(livekit.removeParticipant).toHaveBeenCalledWith(
      `call:${actors.roomId}`,
      people[0]!.id,
    );
    expect(JSON.stringify(logError.mock.calls)).not.toContain(
      "private token failure",
    );
  });
  it("rolls back a leave failure without removing LiveKit participants or publishing an end", async () => {
    const joined = await join();
    const original = callWrites.closeCallParticipant;
    vi.spyOn(callWrites, "closeCallParticipant").mockImplementation(
      async (...args) => {
        await original(...args);
        throw new Error("injected leave rollback");
      },
    );
    events.length = 0;
    await expect(
      service().leave({
        userId: actors.member.userId,
        participantId: joined.participantId,
      }),
    ).rejects.toThrow("injected leave rollback");
    expect((await participant(joined.participantId)).leftAt).toBeNull();
    expect((await session(joined.sessionId)).endedAt).toBeNull();
    expect(await messageData()).toHaveLength(1);
    expect(livekit.removeParticipant).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
  it("keeps committed writes successful if publication or participant removal fails", async () => {
    publisher.publishMany.mockRejectedValueOnce(
      new Error("private publish failure"),
    );
    const joined = await join();
    expect((await participant(joined.participantId)).leftAt).toBeNull();
    vi.mocked(livekit.removeParticipant).mockRejectedValue(
      new Error("private sdk failure"),
    );
    expect(
      await service().leave({
        userId: actors.member.userId,
        participantId: joined.participantId,
      }),
    ).toBe(true);
    expect((await participant(joined.participantId)).leftAt).toEqual(now);
    expect(logError).toHaveBeenCalledWith("Call realtime publication failed.");
    expect(logError).toHaveBeenCalledWith("Call participant removal failed.");
    expect(JSON.stringify(logError.mock.calls)).not.toContain("private");
  });
  it("takes user then room then session then participant locks and publishes to the memory channels", async () => {
    const listener = vi.fn();
    memory.subscribe(roomChannel(actors.roomId), listener);
    queries.length = 0;
    const joined = await join();
    const locks = queries.filter(({ text }) => /for update/i.test(text));
    expect(
      locks.map(({ text }) => /from "([^"]+)"/.exec(text)?.[1]).slice(0, 3),
    ).toEqual(["users", "chat_rooms", "call_sessions"]);
    const admissionLocks = queries.filter(({ text }) =>
      /for (update|key share)/i.test(text),
    );
    expect(
      admissionLocks.slice(0, 4).map(({ text }) => ({
        table: /from "([^"]+)"/.exec(text)?.[1],
        strength: /for (update|key share)/i.exec(text)?.[1],
      })),
    ).toEqual([
      { table: "users", strength: "update" },
      { table: "chat_spaces", strength: "key share" },
      { table: "chat_rooms", strength: "update" },
      { table: "call_sessions", strength: "update" },
    ]);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "call.changed",
        sessionId: joined.sessionId,
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        channel: spaceChannel(actors.spaceId),
        event: expect.objectContaining({ type: "room.activity" }),
      }),
    );
    queries.length = 0;
    await service().leave({
      userId: actors.member.userId,
      participantId: joined.participantId,
    });
    const leaveLocks = queries
      .filter(({ text }) => /for update/i.test(text))
      .map(({ text }) => /from "([^"]+)"/.exec(text)?.[1]);
    expect(leaveLocks.slice(0, 4)).toEqual([
      "users",
      "chat_rooms",
      "call_sessions",
      "call_participants",
    ]);
  });
});

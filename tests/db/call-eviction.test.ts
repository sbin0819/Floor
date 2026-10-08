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
import { createCallService } from "@/features/calls/service";
import { createGroupActions } from "@/features/chat/group-actions";
import { createDirectActions } from "@/features/chat/direct-actions";
import { createModerationActions } from "@/features/people/moderation-actions";
import { createSpaceActions } from "@/features/chat/space-action-factory";
import { createChannelActions } from "@/features/chat/channel-actions";
import { createCancelBookingAction } from "@/features/bookings/cancel-booking-factory";
import { createLeaveBookingAction } from "@/features/bookings/leave-booking-factory";
import { createUpdateBookingAction } from "@/features/bookings/update-booking-factory";
import { evictCalls, evictTargetCalls } from "@/lib/calls/evict";
import type { LiveKitServer } from "@/lib/calls/types";
import * as callWrites from "@/lib/dal/call-write";
import * as schema from "@/lib/db/schema";
import {
  bookingParticipants,
  bookings,
  branches,
  callParticipants,
  callSessions,
  chatRoomMembers,
  chatRooms,
  chatSpaceMembers,
  floors,
  messages,
  spaces,
  users,
} from "@/lib/db/schema";
import type { RealtimeItem } from "@/lib/realtime/types";
import { chatNow, seedChatActors, type ChatActors } from "./chat-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("post-commit call permission eviction", () => {
  let database: TestDatabase;
  let actors: ChatActors;
  let now: Date;
  const logError = vi.fn();
  const statements: string[] = [];
  const events: RealtimeItem[] = [];
  const publisher = {
    publish: vi.fn(async () => {}),
    publishMany: vi.fn(async (items: readonly RealtimeItem[]) => {
      events.push(...items);
    }),
  };
  const removeParticipant = vi.fn<LiveKitServer["removeParticipant"]>();
  const livekit: LiveKitServer = {
    serverUrl: "wss://fake.invalid",
    issueToken: async () => "fake-token",
    removeParticipant,
    verifyWebhook: async () => ({ event: "ignored" }),
  };
  beforeAll(async () => {
    database = await createTestDatabase();
    database.db = drizzle({
      client: database.client,
      schema,
      logger: { logQuery: (text) => statements.push(text) },
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
    await database.db.update(users).set({ emailVerified: true });
    now = new Date(chatNow);
    events.length = 0;
    statements.length = 0;
    removeParticipant.mockResolvedValue();
  });
  const deps = (session = actors.member) => ({
    database: database.db,
    now: () => now,
    livekit,
    publisher,
    chatPublisher: publisher,
    logError,
    getSession: async () => session,
  });
  const join = (roomId: string, person = actors.member) =>
    createCallService(deps(person)).join(person, roomId);
  const row = async (id: string) =>
    (
      await database.db
        .select()
        .from(callParticipants)
        .where(eq(callParticipants.id, id))
    )[0]!;
  async function direct(group = false) {
    const pair = [actors.member.userId, actors.admin.userId].sort();
    const [room] = await database.db
      .insert(chatRooms)
      .values(
        group
          ? { kind: "group_dm", name: "가상 그룹" }
          : { kind: "dm", dmLowUserId: pair[0]!, dmHighUserId: pair[1]! },
      )
      .returning();
    await database.db.insert(chatRoomMembers).values(
      [actors.member, actors.admin].map((person) => ({
        roomId: room!.id,
        userId: person.userId,
        status: "active" as const,
        joinedAt: now,
        statusChangedAt: now,
      })),
    );
    return room!.id;
  }
  async function community() {
    const result = await createSpaceActions(
      deps(actors.admin),
    ).createCommunitySpace({ name: "가상 커뮤니티", iconColor: "green" });
    if (!result.ok) throw new Error(result.code);
    await database.db.insert(chatSpaceMembers).values({
      spaceId: result.data.spaceId,
      userId: actors.member.userId,
      joinedAt: now,
      statusChangedAt: now,
    });
    return result.data;
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
      .values({
        floorId: floor!.id,
        type: "meeting_room",
        name: "회의 공간",
        capacity: 10,
        bookable: true,
      })
      .returning();
    const during = {
      start: new Date(chatNow.getTime() + 600_000),
      end: new Date(chatNow.getTime() + 3_600_000),
    };
    const [booking] = await database.db
      .insert(bookings)
      .values({
        userId: actors.admin.userId,
        spaceId: space!.id,
        during,
        title: "가상 회의",
      })
      .returning();
    await database.db.insert(bookingParticipants).values({
      bookingId: booking!.id,
      userId: actors.member.userId,
      createdAt: chatNow,
    });
    const [room] = await database.db
      .insert(chatRooms)
      .values({ kind: "meeting", bookingId: booking!.id })
      .returning();
    return { booking: booking!, roomId: room!.id };
  }
  async function assertRemoved(participantId: string, roomId: string) {
    expect((await row(participantId)).leftAt).toEqual(now);
    expect(removeParticipant).toHaveBeenCalledWith(
      `call:${roomId}`,
      participantId,
    );
    expect(
      events.some(
        ({ event }) => event.type === "call.changed" && event.roomId === roomId,
      ),
    ).toBe(true);
  }

  it("evicts the user after group leave while retaining another participant", async () => {
    const roomId = await direct(true);
    const leaving = await join(roomId);
    const staying = await join(roomId, actors.admin);
    const result = await createGroupActions(deps()).leaveGroupDm({ roomId });
    expect(result).toEqual({ ok: true, data: {} });
    await assertRemoved(leaving.participantId, roomId);
    expect((await row(staying.participantId)).leftAt).toBeNull();
  });
  it("evicts both participants after blocking", async () => {
    const roomId = await direct();
    const mine = await join(roomId);
    const peer = await join(roomId, actors.admin);
    const result = await createModerationActions(deps()).blockUser({
      userId: actors.admin.userId,
    });
    expect(result).toEqual({ ok: true, data: {} });
    await assertRemoved(mine.participantId, roomId);
    await assertRemoved(peer.participantId, roomId);
    expect((await database.db.select().from(callSessions))[0]?.endedAt).toEqual(
      now,
    );
  });
  it("closes both lingering participants after a message request is declined", async () => {
    const roomId = await direct();
    const mine = await join(roomId);
    const peer = await join(roomId, actors.admin);
    await database.db
      .update(chatRoomMembers)
      .set({ status: "requested", requestedAt: now })
      .where(
        and(
          eq(chatRoomMembers.roomId, roomId),
          eq(chatRoomMembers.userId, actors.member.userId),
        ),
      );
    const result = await createDirectActions(deps()).respondMessageRequest({
      roomId,
      accept: false,
    });
    expect(result).toEqual({ ok: true, data: {} });
    await assertRemoved(mine.participantId, roomId);
    await assertRemoved(peer.participantId, roomId);
  });
  it("does not remove either participant from a shared group call merely because they block each other", async () => {
    const roomId = await direct(true);
    const mine = await join(roomId);
    const peer = await join(roomId, actors.admin);
    expect(
      await createModerationActions(deps()).blockUser({
        userId: actors.admin.userId,
      }),
    ).toEqual({ ok: true, data: {} });
    expect((await row(mine.participantId)).leftAt).toBeNull();
    expect((await row(peer.participantId)).leftAt).toBeNull();
    expect(removeParticipant).not.toHaveBeenCalled();
  });
  it("evicts a read-only lounge voice participant after leaving the lounge", async () => {
    const [branch] = await database.db
      .insert(branches)
      .values({ name: "가상 라운지 지점" })
      .returning();
    const result = await createSpaceActions(deps()).joinLounge({
      branchId: branch!.id,
    });
    if (!result.ok) throw new Error(result.code);
    const [voice] = await database.db
      .select()
      .from(chatRooms)
      .where(
        and(
          eq(chatRooms.spaceId, result.data.spaceId),
          eq(chatRooms.kind, "voice"),
        ),
      );
    const joined = await join(voice!.id);
    expect(
      await createSpaceActions(deps()).leaveSpace({
        spaceId: result.data.spaceId,
      }),
    ).toEqual({ ok: true, data: {} });
    await assertRemoved(joined.participantId, voice!.id);
  });
  it.each(["leave", "ban"])(
    "evicts the removed community participant after %s",
    async (operation) => {
      const space = await community();
      const participant = await join(space.roomId);
      const result =
        operation === "leave"
          ? await createSpaceActions(deps()).leaveSpace({
              spaceId: space.spaceId,
            })
          : await createChannelActions(deps(actors.admin)).banSpaceMember({
              spaceId: space.spaceId,
              userId: actors.member.userId,
            });
      expect(result).toEqual({ ok: true, data: {} });
      await assertRemoved(participant.participantId, space.roomId);
    },
  );
  it("deletes a space then evicts all participants from different rooms one room per transaction", async () => {
    const space = await community();
    const extra = await createChannelActions(deps(actors.admin)).createChannel({
      spaceId: space.spaceId,
      name: "자료",
    });
    if (!extra.ok) throw new Error(extra.code);
    const member = await join(space.roomId);
    const admin = await join(extra.data.roomId, actors.admin);
    const result = await createSpaceActions(deps(actors.admin)).deleteSpace({
      spaceId: space.spaceId,
      confirmName: "가상 커뮤니티",
    });
    expect(result).toEqual({ ok: true, data: {} });
    await assertRemoved(member.participantId, space.roomId);
    await assertRemoved(admin.participantId, extra.data.roomId);
  });
  it("archives a text channel then evicts its call participants", async () => {
    const participant = await join(actors.secondRoomId);
    const result = await createChannelActions(
      deps(actors.admin),
    ).archiveChannel({ roomId: actors.secondRoomId });
    expect(result).toEqual({ ok: true, data: {} });
    await assertRemoved(participant.participantId, actors.secondRoomId);
  });
  it("does not evict before a rejected mutation commits", async () => {
    const participant = await join(actors.secondRoomId);
    expect(
      await createChannelActions(deps()).archiveChannel({
        roomId: actors.secondRoomId,
      }),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
    expect((await row(participant.participantId)).leftAt).toBeNull();
    expect(removeParticipant).not.toHaveBeenCalled();
  });
  it.each(["leave", "remove", "cancel"])(
    "evicts affected meeting members after booking %s",
    async (operation) => {
      const target = await meeting();
      const member = await join(target.roomId);
      const owner = await join(target.roomId, actors.admin);
      const input = { bookingId: target.booking.id };
      const result =
        operation === "leave"
          ? await createLeaveBookingAction(deps())(input)
          : operation === "cancel"
            ? await createCancelBookingAction(deps(actors.admin))(input)
            : await createUpdateBookingAction(deps(actors.admin))({
                ...input,
                start: target.booking.during.start.toISOString(),
                end: target.booking.during.end.toISOString(),
                title: target.booking.title,
                attendeeCount: null,
                participants: [],
                participantIdsAtLoad: [actors.member.userId],
              });
      expect(result).toMatchObject({ ok: true });
      await assertRemoved(member.participantId, target.roomId);
      if (operation === "cancel")
        await assertRemoved(owner.participantId, target.roomId);
      else expect((await row(owner.participantId)).leftAt).toBeNull();
    },
  );
  it("keeps an ended meeting call after unrelated permission changes", async () => {
    const target = await meeting();
    const participant = await join(target.roomId);
    now = new Date(target.booking.during.end.getTime() + 25 * 3_600_000);
    await evictCalls(actors.member.userId, deps());
    expect((await row(participant.participantId)).leftAt).toBeNull();
    expect(removeParticipant).not.toHaveBeenCalled();
  });
  it("does nothing while disabled, and does not evict a valid member on unrelated changes", async () => {
    const participant = await join(actors.roomId);
    statements.length = 0;
    await evictCalls(actors.member.userId, { ...deps(), livekit: null });
    await evictTargetCalls(
      { spaceId: actors.spaceId },
      { ...deps(), livekit: null },
    );
    expect(statements).toEqual([]);
    await evictCalls(actors.member.userId, deps());
    expect((await row(participant.participantId)).leftAt).toBeNull();
    expect(removeParticipant).not.toHaveBeenCalled();
  });
  it("commits group leave and participant closure before removing the exact LiveKit identity, even when services fail", async () => {
    const roomId = await direct(true);
    const participant = await join(roomId);
    removeParticipant.mockImplementation(async (room, identity) => {
      expect(room).toBe(`call:${roomId}`);
      expect(identity).toBe(participant.participantId);
      expect((await row(identity)).leftAt).toEqual(now);
      const membership = (
        await database.db
          .select()
          .from(chatRoomMembers)
          .where(
            and(
              eq(chatRoomMembers.roomId, roomId),
              eq(chatRoomMembers.userId, actors.member.userId),
            ),
          )
      )[0]!;
      expect(membership.status).toBe("left");
      throw new Error("private service error");
    });
    publisher.publishMany.mockRejectedValueOnce(new Error("private event"));
    expect(await createGroupActions(deps()).leaveGroupDm({ roomId })).toEqual({
      ok: true,
      data: {},
    });
    expect(logError.mock.calls.flat().join(" ")).not.toContain("private");
    const count = events.length;
    await evictCalls(actors.member.userId, deps());
    expect(removeParticipant).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(count);
  });
  it("preserves original success and rolls back call changes if eviction storage fails", async () => {
    const roomId = await direct(true);
    const participant = await join(roomId);
    vi.spyOn(callWrites, "closeCallParticipant").mockRejectedValueOnce(
      new Error("private database"),
    );
    expect(await createGroupActions(deps()).leaveGroupDm({ roomId })).toEqual({
      ok: true,
      data: {},
    });
    expect((await row(participant.participantId)).leftAt).toBeNull();
    expect(removeParticipant).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledExactlyOnceWith("Call eviction failed.");
  });
  it("uses user → one room → session → participant locks before ending messages", async () => {
    const roomId = await direct(true);
    await join(roomId);
    await database.db
      .update(chatRoomMembers)
      .set({ status: "left" })
      .where(
        and(
          eq(chatRoomMembers.roomId, roomId),
          eq(chatRoomMembers.userId, actors.member.userId),
        ),
      );
    statements.length = 0;
    await evictCalls(actors.member.userId, deps());
    const locks = statements.filter((statement) =>
      statement.includes("for update"),
    );
    expect(locks[0]).toContain('from "users"');
    expect(locks[1]).toContain('from "chat_rooms"');
    expect(locks[2]).toContain('from "call_sessions"');
    expect(locks[3]).toContain('from "call_participants"');
    expect(
      locks.filter((statement) => statement.includes('from "chat_rooms"')),
    ).toHaveLength(1);
    expect(
      (await database.db.select().from(messages)).some(
        (message) => message.systemData?.type === "huddle_ended",
      ),
    ).toBe(true);
  });
});

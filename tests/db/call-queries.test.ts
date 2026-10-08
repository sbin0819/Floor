import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createChatQueries } from "@/features/chat/query-factory";
import { createCallQueries } from "@/features/calls/query-factory";
import { createBranchLounge } from "@/lib/dal/chat-write";
import {
  branches,
  callParticipants,
  callSessions,
  chatRooms,
  chatSpaceMembers,
  users,
  teamMembers,
} from "@/lib/db/schema";
import { createTestDatabase, type TestDatabase } from "./helper";
import { seedChatActors, chatNow, type ChatActors } from "./chat-helper";
import { createQueryMeter } from "./query-meter";

describe("call navigation and room query privacy", () => {
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
  const queries = (user = actors.member, enabled = true) =>
    createChatQueries({
      database: database.db,
      requireSession: async () => user,
      now: () => chatNow,
      callsEnabled: enabled,
    });
  const voiceQueries = (user = actors.member, enabled = true) =>
    createCallQueries({
      database: database.db,
      requireSession: async () => user,
      now: () => chatNow,
      callsEnabled: enabled,
    });
  async function open(
    roomId = actors.roomId,
    kind: "huddle" | "voice" = "huddle",
  ) {
    const [session] = await database.db
      .insert(callSessions)
      .values({ roomId, kind, startedAt: chatNow })
      .returning();
    if (!session) throw new Error("Missing fixture call");
    return session;
  }
  async function person(
    sessionId: string,
    userId = actors.admin.userId,
    seconds = 0,
    left = false,
  ) {
    const [participant] = await database.db
      .insert(callParticipants)
      .values({
        sessionId,
        userId,
        joinedAt: new Date(chatNow.getTime() - 180_000),
        lastSeenAt: new Date(chatNow.getTime() - seconds * 1_000),
        leftAt: left ? chatNow : null,
      })
      .returning();
    return participant!;
  }
  async function voice(spaceId = actors.spaceId) {
    const [room] = await database.db
      .select()
      .from(chatRooms)
      .where(and(eq(chatRooms.spaceId, spaceId), eq(chatRooms.kind, "voice")));
    if (!room) throw new Error("Missing voice fixture");
    return room;
  }

  it("adds voice rows without mixing them into text channels, even when calls are disabled", async () => {
    const room = await voice();
    for (const enabled of [true, false]) {
      const nav = await queries(actors.member, enabled).getMyChatNav();
      expect(nav.callsEnabled).toBe(enabled);
      expect(nav.calls).toEqual([]);
      expect(nav.myCall).toBeNull();
      expect(nav.spaces[0]!.voiceChannels).toEqual([
        {
          id: room.id,
          name: room.name,
          capacity: 10,
          participantCount: 0,
          participants: [],
        },
      ]);
      expect(
        nav.spaces[0]!.channels.some((channel) => channel.id === room.id),
      ).toBe(false);
    }
  });
  it.each([0, 119, 120, 121])(
    "counts only active participants at %i seconds",
    async (seconds) => {
      const session = await open();
      await person(session.id, actors.admin.userId, seconds);
      const nav = await queries().getMyChatNav();
      const view = await queries().getChannelView(
        actors.spaceId,
        actors.roomId,
      );
      const count = seconds < 120 ? 1 : 0;
      expect(nav.calls).toEqual([
        { roomId: actors.roomId, participantCount: count },
      ]);
      expect(view!.call).toEqual({
        sessionId: session.id,
        kind: "huddle",
        startedAt: chatNow.toISOString(),
        participantCount: count,
        participants: count
          ? [{ userId: actors.admin.userId, name: actors.admin.name }]
          : [],
      });
      expect(view!.canCall).toBe(true);
      expect(JSON.stringify({ nav, view })).not.toContain("@");
    },
  );
  it("does not count ended participants or ended calls", async () => {
    const session = await open();
    await person(session.id, actors.admin.userId, 0, true);
    expect((await queries().getMyChatNav()).calls[0]!.participantCount).toBe(0);
    await database.db
      .update(callSessions)
      .set({ endedAt: chatNow })
      .where(eq(callSessions.id, session.id));
    expect((await queries().getMyChatNav()).calls).toEqual([]);
    expect(
      (await queries().getChannelView(actors.spaceId, actors.roomId))!.call,
    ).toBeNull();
  });
  it.each([119, 120, 121])(
    "returns my participant and stale status at %i seconds",
    async (seconds) => {
      const session = await open();
      const participant = await person(
        session.id,
        actors.member.userId,
        seconds,
      );
      expect((await queries().getMyChatNav()).myCall).toEqual({
        participantId: participant.id,
        sessionId: session.id,
        roomId: actors.roomId,
        kind: "huddle",
        joinedAt: participant.joinedAt.toISOString(),
        stale: seconds >= 120,
      });
    },
  );
  it("hides all foreign calls, archived voice channels and revoked memberships", async () => {
    const foreign = await open(actors.otherSpace.roomId);
    await person(foreign.id, actors.outsider.userId);
    const room = await voice();
    await database.db
      .update(chatRooms)
      .set({ archivedAt: chatNow })
      .where(eq(chatRooms.id, room.id));
    expect((await queries().getMyChatNav()).calls).toEqual([]);
    expect((await queries().getMyChatNav()).spaces[0]!.voiceChannels).toEqual(
      [],
    );
    await database.db
      .delete(teamMembers)
      .where(eq(teamMembers.userId, actors.member.userId));
    expect((await queries().getMyChatNav()).spaces).toEqual([]);
    expect(
      await voiceQueries().getVoiceChannelView(actors.spaceId, room.id),
    ).toBeNull();
  });
  it("sorts roster names and caps roster reads at 25 without changing count", async () => {
    const room = await voice();
    const session = await open(room.id, "voice");
    const members = Array.from({ length: 26 }, (_, index) => ({
      id: crypto.randomUUID(),
      name: `가상${String(index).padStart(2, "0")}`,
      email: `roster${index}@example.test`,
    }));
    await database.db.insert(users).values(members);
    await database.db.insert(callParticipants).values(
      members.map((user) => ({
        sessionId: session.id,
        userId: user.id,
        joinedAt: chatNow,
        lastSeenAt: chatNow,
      })),
    );
    const row = (await queries().getMyChatNav()).spaces[0]!.voiceChannels[0]!;
    expect(row.participantCount).toBe(26);
    expect(row.participants.map((user) => user.name)).toEqual(
      members.slice(0, 25).map((user) => user.name),
    );
  });
  it("returns lounge counts but roster names only to an active participant in the room view", async () => {
    const [branch] = await database.db
      .insert(branches)
      .values({ name: "가상 통화 지점" })
      .returning();
    const lounge = await createBranchLounge(branch!.id, database.db);
    await database.db.insert(chatSpaceMembers).values(
      [actors.member, actors.admin].map((user) => ({
        spaceId: lounge.spaceId,
        userId: user.userId,
        joinedAt: chatNow,
        statusChangedAt: chatNow,
      })),
    );
    const room = await voice(lounge.spaceId);
    const session = await open(room.id, "voice");
    await person(session.id, actors.admin.userId);
    const nav = await queries().getMyChatNav();
    expect(
      nav.spaces.find((space) => space.id === lounge.spaceId)!.voiceChannels[0],
    ).toMatchObject({ participantCount: 1, participants: [] });
    expect(
      (await voiceQueries().getVoiceChannelView(lounge.spaceId, room.id))!.call!
        .participants,
    ).toEqual([]);
    const joined = await person(session.id, actors.member.userId);
    expect(
      (await voiceQueries().getVoiceChannelView(lounge.spaceId, room.id))!.call!
        .participants,
    ).toHaveLength(2);
    expect(
      (await queries().getMyChatNav()).spaces.find(
        (space) => space.id === lounge.spaceId,
      )!.voiceChannels[0]!.participants,
    ).toEqual([]);
    await database.db
      .update(callParticipants)
      .set({ lastSeenAt: new Date(chatNow.getTime() - 120_000) })
      .where(eq(callParticipants.id, joined.id));
    expect(
      (await voiceQueries().getVoiceChannelView(lounge.spaceId, room.id))!.call!
        .participants,
    ).toEqual([]);
  });
  it("keeps navigation at four parallel SQL statements and room lookup at three", async () => {
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      await queries().getMyChatNav();
      expect(meter.stop().perStage).toEqual([4]);
      meter.start();
      await queries().getChannelView(actors.spaceId, actors.roomId);
      expect(meter.stop().perStage).toEqual([1, 2]);
      const room = await voice();
      meter.start();
      await voiceQueries().getVoiceChannelView(actors.spaceId, room.id);
      expect(meter.stop().perStage).toEqual([1]);
    } finally {
      meter.restore();
    }
  });
});

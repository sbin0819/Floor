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
import { createChatActions } from "@/features/chat/action-factory";
import { createChatQueries } from "@/features/chat/query-factory";
import { createSpaceMemberQueries } from "@/features/chat/space-members-queries";
import { createBranchLounge } from "@/lib/dal/chat-write";
import { createDirectRoom } from "@/lib/dal/direct";
import {
  branches,
  callParticipants,
  callSessions,
  chatRooms,
  chatSpaceMembers,
  users,
} from "@/lib/db/schema";
import { avatarColorFor } from "@/lib/avatar";
import { createMemoryRateLimiter } from "@/lib/rate-limit/memory";
import { createTestDatabase, type TestDatabase } from "./helper";
import { chatNow, seedChatActors, type ChatActors } from "./chat-helper";
import { createQueryMeter } from "./query-meter";

describe("chat avatar DTOs without extra reads", () => {
  let database: TestDatabase;
  let actors: ChatActors;
  const photoUrl = "https://avatars.githubusercontent.com/u/123?v=4";
  const avatar = { color: "pink", photoUrl };
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    await database.db.execute(sql`truncate users, branches cascade`);
    actors = await seedChatActors(database);
    await database.db
      .update(users)
      .set({
        name: "새 이름",
        avatarColor: "pink",
        avatarPhoto: true,
        avatarUrl: photoUrl,
      })
      .where(eq(users.id, actors.member.userId));
  });
  const queries = (session = actors.member) =>
    createChatQueries({
      database: database.db,
      requireSession: async () => session,
      now: () => chatNow,
    });

  it("uses live user avatar/name for the viewer, members, messages, and the created event", async () => {
    const publish = vi.fn();
    const actions = createChatActions({
      database: database.db,
      getSession: async () => actors.member,
      now: () => chatNow,
      limiter: createMemoryRateLimiter(),
      publisher: {
        publish,
        publishMany: async (items) => {
          for (const { channel, event } of items) await publish(channel, event);
        },
      },
    });
    const input = {
      roomId: actors.roomId,
      clientId: crypto.randomUUID(),
      body: "현재 아바타",
    };
    const result = await actions.sendMessage(input);
    expect(result).toMatchObject({
      ok: true,
      data: { authorName: "새 이름", authorAvatar: avatar },
    });
    expect(
      publish.mock.calls.find(
        ([, event]) => event.type === "message.created",
      )?.[1],
    ).toMatchObject({ authorAvatar: avatar });
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      const view = await queries().getChannelView(
        actors.spaceId,
        actors.roomId,
      );
      expect(meter.stop().perStage).toEqual([1, 2]);
      expect(view?.user).toEqual({
        id: actors.member.userId,
        name: "새 이름",
        avatar,
      });
      expect(
        view?.members.find((member) => member.id === actors.member.userId)
          ?.avatar,
      ).toEqual(avatar);
      expect(view?.messages[0]?.authorAvatar).toEqual(avatar);
      meter.start();
      const page = await queries().getRoomMessagesPage(actors.roomId, {
        after: "0",
      });
      expect(meter.stop().perStage).toEqual([2]);
      expect(page.messages[0]?.authorAvatar).toEqual(avatar);
      expect(
        JSON.stringify({ view, page, events: publish.mock.calls }),
      ).not.toMatch(/avatarUrl|avatarColor|avatarPhoto|@example\.test/);
    } finally {
      meter.restore();
    }
  });

  it("includes member and DM nav avatars with unchanged query budgets and no raw fields", async () => {
    const direct = await database.db.transaction((tx) =>
      createDirectRoom(
        [actors.admin.userId, actors.member.userId],
        chatNow,
        tx,
      ),
    );
    await database.db
      .update(chatRooms)
      .set({ lastMessageAt: chatNow })
      .where(eq(chatRooms.id, direct.roomId));
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      const nav = await queries(actors.admin).getMyChatNav();
      expect(meter.stop().perStage).toEqual([4]);
      const dm = nav.directMessages.find(
        (room) => room.roomId === direct.roomId,
      );
      expect(dm?.kind === "dm" && dm.other.avatar).toEqual(avatar);
      const view = await queries(actors.admin).getDirectMessageView(
        direct.roomId,
      );
      expect(view?.kind === "dm" && view.other.avatar).toEqual(avatar);
      meter.start();
      const members = await createSpaceMemberQueries({
        database: database.db,
        requireSession: async () => actors.admin,
      }).getSpaceMembers(actors.spaceId);
      expect(meter.stop().perStage).toEqual([1]);
      expect(
        members?.view === "full" &&
          members.members.find((row) => row.userId === actors.member.userId)
            ?.avatar,
      ).toEqual(avatar);
      expect(JSON.stringify({ nav, view, members })).not.toMatch(
        /avatarUrl|avatarColor|avatarPhoto|@example\.test/,
      );
    } finally {
      meter.restore();
    }
  });

  it("falls back when a stored provider URL is unsafe, or photos are disabled", async () => {
    for (const state of [
      {
        avatarUrl: "https://avatars.githubusercontent.com.evil.test/private",
        avatarPhoto: true,
      },
      { avatarUrl: photoUrl, avatarPhoto: false },
    ]) {
      await database.db
        .update(users)
        .set({ ...state, avatarColor: null })
        .where(eq(users.id, actors.member.userId));
      const view = await queries().getChannelView(
        actors.spaceId,
        actors.roomId,
      );
      expect(view?.user.avatar).toEqual({
        color: avatarColorFor(actors.member.userId, null),
        photoUrl: null,
      });
      expect(JSON.stringify(view)).not.toContain(state.avatarUrl);
    }
  });

  it("reads my avatar in a limited lounge even when I am not a visible member", async () => {
    const [branch] = await database.db
      .insert(branches)
      .values({ name: "가상 라운지" })
      .returning();
    const lounge = await createBranchLounge(branch!.id, database.db);
    await database.db
      .insert(chatSpaceMembers)
      .values({
        spaceId: lounge.spaceId,
        userId: actors.member.userId,
        role: "member",
        status: "active",
        joinedAt: chatNow,
        statusChangedAt: chatNow,
      });
    const [room] = await database.db
      .select()
      .from(chatRooms)
      .where(
        and(eq(chatRooms.spaceId, lounge.spaceId), eq(chatRooms.kind, "text")),
      );
    const view = await queries().getChannelView(lounge.spaceId, room!.id);
    expect(
      view?.members.some((member) => member.id === actors.member.userId),
    ).toBe(false);
    expect(view?.user.avatar).toEqual(avatar);
  });

  it("carries avatars in approved call rosters without disclosing unknown rooms", async () => {
    const [voice] = await database.db
      .select()
      .from(chatRooms)
      .where(
        and(eq(chatRooms.spaceId, actors.spaceId), eq(chatRooms.kind, "voice")),
      );
    const [session] = await database.db
      .insert(callSessions)
      .values({ roomId: voice!.id, kind: "voice", startedAt: chatNow })
      .returning();
    await database.db
      .insert(callParticipants)
      .values({
        sessionId: session!.id,
        userId: actors.member.userId,
        joinedAt: chatNow,
        lastSeenAt: chatNow,
      });
    const nav = await queries().getMyChatNav();
    expect(nav.spaces[0]?.voiceChannels[0]?.participants).toEqual([
      { userId: actors.member.userId, name: "새 이름", avatar },
    ]);
    const view = await queries().getChannelView(actors.spaceId, voice!.id);
    expect(view?.call?.participants[0]?.avatar).toEqual(avatar);
    expect(
      await queries(actors.outsider).getChannelView(actors.spaceId, voice!.id),
    ).toBeNull();
  });
});

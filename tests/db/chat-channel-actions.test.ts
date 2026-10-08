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
import { createChannelActions } from "@/features/chat/channel-actions";
import { createSpaceActions } from "@/features/chat/space-action-factory";
import { canReadRoom, canWriteRoom } from "@/lib/dal/chat-access";
import {
  branches,
  branchStaff,
  chatRooms,
  chatSpaceInvites,
  chatSpaceMembers,
  notifications,
} from "@/lib/db/schema";
import type { RealtimeItem } from "@/lib/realtime/types";
import { chatNow, seedChatActors, type ChatActors } from "./chat-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("channel administration and community bans", () => {
  let database: TestDatabase;
  let actors: ChatActors;
  let spaceId: string;
  const events: RealtimeItem[] = [];
  const publisher = {
    publish: vi.fn(),
    publishMany: vi.fn(async (items: readonly RealtimeItem[]) => {
      events.push(...items);
    }),
  };
  const dependencies = (session = actors.member) => ({
    database: database.db,
    getSession: async () => session,
    now: () => chatNow,
    publisher,
    logError: vi.fn(),
  });
  const actions = (session = actors.member) =>
    createChannelActions(dependencies(session));
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
    const result = await createSpaceActions(
      dependencies(),
    ).createCommunitySpace({ name: "가상", iconColor: "blue" });
    if (!result.ok) throw new Error(result.code);
    spaceId = result.data.spaceId;
    await database.db.insert(chatSpaceMembers).values([
      {
        spaceId,
        userId: actors.admin.userId,
        role: "admin",
        joinedAt: chatNow,
        statusChangedAt: chatNow,
      },
      {
        spaceId,
        userId: actors.outsider.userId,
        role: "member",
        joinedAt: chatNow,
        statusChangedAt: chatNow,
      },
    ]);
    events.length = 0;
  });
  it("permits community and team administrators, rejects members and invisible spaces", async () => {
    expect(
      (
        await actions(actors.admin).createChannel({
          spaceId,
          name: " Hi -- THERE ",
        })
      ).ok,
    ).toBe(true);
    expect(
      await actions(actors.outsider).createChannel({ spaceId, name: "안됨" }),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(
      (
        await actions(actors.admin).createChannel({
          spaceId: actors.spaceId,
          name: "팀-공지",
        })
      ).ok,
    ).toBe(true);
    expect(
      await actions().createChannel({ spaceId: actors.spaceId, name: "안됨" }),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(
      await actions(actors.operator).createChannel({ spaceId, name: "안됨" }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(events).toContainEqual({
      channel: `space:${spaceId}`,
      event: { type: "space.changed", spaceId },
    });
  });
  it("requires lounge membership even from a branch operator", async () => {
    const [branch] = await database.db
      .insert(branches)
      .values({ name: "가상 지점" })
      .returning();
    await database.db
      .insert(branchStaff)
      .values({ branchId: branch!.id, userId: actors.operator.userId });
    const memberJoin = await createSpaceActions(dependencies()).joinLounge({
      branchId: branch!.id,
    });
    if (!memberJoin.ok) throw new Error(memberJoin.code);
    const lounge = memberJoin.data.spaceId;
    expect(
      await actions(actors.operator).createChannel({
        spaceId: lounge,
        name: "안됨",
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    await createSpaceActions(dependencies(actors.operator)).joinLounge({
      branchId: branch!.id,
    });
    expect(
      (
        await actions(actors.operator).createChannel({
          spaceId: lounge,
          name: "새-채널",
        })
      ).ok,
    ).toBe(true);
    expect(
      await actions().createChannel({ spaceId: lounge, name: "안됨" }),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
  });
  it("classifies uniqueness without parsing error text; archived names are reusable", async () => {
    const first = await actions().createChannel({ spaceId, name: " NEWS " });
    if (!first.ok) throw new Error(first.code);
    expect(await actions().createChannel({ spaceId, name: "news" })).toEqual({
      ok: false,
      code: "CHANNEL_NAME_TAKEN",
    });
    expect(
      await actions().archiveChannel({ roomId: first.data.roomId }),
    ).toEqual({ ok: true, data: {} });
    expect((await actions().createChannel({ spaceId, name: "news" })).ok).toBe(
      true,
    );
    expect(
      await canReadRoom(actors.member.userId, first.data.roomId, database.db),
    ).not.toBeNull();
    expect(
      (await canWriteRoom(actors.member.userId, first.data.roomId, database.db))
        .canWrite,
    ).toBe(false);
  });
  it("updates normalized names, blank topics and admin-only mode, but not archived channels", async () => {
    const first = await actions().createChannel({
      spaceId,
      name: "새채널",
      topic: "안내",
    });
    if (!first.ok) throw new Error(first.code);
    const roomId = first.data.roomId;
    expect(await actions().updateChannel({ roomId, name: "일반" })).toEqual({
      ok: false,
      code: "CHANNEL_NAME_TAKEN",
    });
    expect(
      await actions().updateChannel({
        roomId,
        name: "가나",
        topic: " ",
        adminOnly: true,
      }),
    ).toEqual({ ok: true, data: {} });
    expect(
      (
        await database.db
          .select()
          .from(chatRooms)
          .where(eq(chatRooms.id, roomId))
      )[0],
    ).toMatchObject({ name: "가나", topic: null, adminOnly: true });
    await actions().archiveChannel({ roomId });
    events.length = 0;
    expect(await actions().archiveChannel({ roomId })).toEqual({
      ok: true,
      data: {},
    });
    expect(events).toEqual([]);
    expect(await actions().updateChannel({ roomId, topic: "수정" })).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
  });
  it("enforces fifty active text channels under the space lock", async () => {
    await database.db
      .insert(chatRooms)
      .values(
        Array.from({ length: 49 }, (_, index) => ({
          spaceId,
          kind: "text" as const,
          name: `채널-${index}`,
        })),
      );
    expect(await actions().createChannel({ spaceId, name: "초과" })).toEqual({
      ok: false,
      code: "LIMIT_EXCEEDED",
      message: "channel_count",
    });
  });
  it("only the owner can ban another administrator; nobody can ban owner or self", async () => {
    await database.db
      .update(chatSpaceMembers)
      .set({ role: "admin" })
      .where(eq(chatSpaceMembers.userId, actors.outsider.userId));
    expect(
      await actions(actors.admin).banSpaceMember({
        spaceId,
        userId: actors.outsider.userId,
      }),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(
      await actions().banSpaceMember({ spaceId, userId: actors.member.userId }),
    ).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(
      await actions(actors.admin).banSpaceMember({
        spaceId,
        userId: actors.member.userId,
      }),
    ).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(
      (await actions().banSpaceMember({ spaceId, userId: actors.admin.userId }))
        .ok,
    ).toBe(true);
    expect(
      (
        await database.db
          .select()
          .from(chatSpaceMembers)
          .where(
            and(
              eq(chatSpaceMembers.spaceId, spaceId),
              eq(chatSpaceMembers.userId, actors.admin.userId),
            ),
          )
      )[0],
    ).toMatchObject({ role: "member", status: "banned" });
  });
  it("revokes received invites and created links, removes notifications and reauthorizes after ban", async () => {
    const code = "a".repeat(22),
      link = "b".repeat(22);
    await database.db.insert(chatSpaceInvites).values([
      {
        spaceId,
        code,
        targetUserId: actors.outsider.userId,
        createdBy: actors.member.userId,
      },
      { spaceId, code: link, createdBy: actors.outsider.userId },
    ]);
    await database.db
      .insert(notifications)
      .values({
        userId: actors.outsider.userId,
        type: "space_invite",
        data: sql`${JSON.stringify({ actorName: "이름", spaceName: "가상", inviteCode: code })}::jsonb`,
        scheduledFor: chatNow,
      });
    expect(
      await actions(actors.admin).banSpaceMember({
        spaceId,
        userId: actors.outsider.userId,
      }),
    ).toEqual({ ok: true, data: {} });
    expect(
      (await database.db.select().from(chatSpaceInvites)).every(
        (invite) => invite.revokedAt?.getTime() === chatNow.getTime(),
      ),
    ).toBe(true);
    expect(await database.db.select().from(notifications)).toEqual([]);
    expect(events).toContainEqual({
      channel: `user:${actors.outsider.userId}`,
      event: { type: "realtime.reauth" },
    });
    expect(
      await actions(actors.admin).unbanSpaceMember({
        spaceId,
        userId: actors.outsider.userId,
      }),
    ).toEqual({ ok: true, data: {} });
    expect(
      await database.db
        .select()
        .from(chatSpaceMembers)
        .where(
          and(
            eq(chatSpaceMembers.spaceId, spaceId),
            eq(chatSpaceMembers.userId, actors.outsider.userId),
          ),
        ),
    ).toEqual([]);
  });
});

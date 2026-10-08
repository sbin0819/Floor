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
import { createPeopleQueries } from "@/features/people/query-factory";
import {
  canReadRoom,
  canReadSpace,
  canWriteRoom,
  sharesChatSpace,
  spaceRoleOf,
} from "@/lib/dal/chat-access";
import { saveSpaceMuted } from "@/lib/dal/chat-reads";
import {
  branchStaff,
  branches,
  chatRoomReads,
  chatRooms,
  chatSpaceMembers,
  chatSpaces,
  messages,
  roleSettings,
  users,
} from "@/lib/db/schema";
import { createMemoryRateLimiter } from "@/lib/rate-limit/memory";
import * as accessDal from "@/lib/dal/chat-access";
import * as writeDal from "@/lib/dal/chat-write";
import type { RealtimeItem } from "@/lib/realtime/types";
import { createTestDatabase, type TestDatabase } from "./helper";
import { chatNow, seedChatActors, type ChatActors } from "./chat-helper";
import { createQueryMeter } from "./query-meter";

describe("lounge and community access", () => {
  let database: TestDatabase;
  let actors: ChatActors;
  let branchId: string;
  let loungeId: string;
  let loungeRoomId: string;
  let noticeId: string;
  let communityId: string;
  let communityRoomId: string;
  const joinedAt = new Date(chatNow.getTime() - 86_400_000);
  const events: RealtimeItem[] = [];
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    events.length = 0;
    await database.db.execute(sql`truncate users, branches cascade`);
    actors = await seedChatActors(database);
    await database.db.update(users).set({ emailVerified: true });
    const [branch] = await database.db
      .insert(branches)
      .values({ name: "가상 라운지 지점" })
      .returning();
    branchId = branch!.id;
    const [lounge, community] = await database.db
      .insert(chatSpaces)
      .values([
        { kind: "branch", branchId },
        {
          kind: "community",
          name: "가상 모임",
          createdBy: actors.member.userId,
        },
      ])
      .returning();
    loungeId = lounge!.id;
    communityId = community!.id;
    const [loungeRoom, notice, communityRoom] = await database.db
      .insert(chatRooms)
      .values([
        { kind: "text", spaceId: loungeId, name: "라운지" },
        { kind: "text", spaceId: loungeId, name: "공지", adminOnly: true },
        { kind: "text", spaceId: communityId, name: "일반" },
      ])
      .returning();
    loungeRoomId = loungeRoom!.id;
    noticeId = notice!.id;
    communityRoomId = communityRoom!.id;
    await database.db
      .insert(branchStaff)
      .values({ branchId, userId: actors.operator.userId });
  });
  async function join(
    spaceId: string,
    userId: string,
    role: "member" | "admin" | "owner" = "member",
  ) {
    await database.db
      .insert(chatSpaceMembers)
      .values({ spaceId, userId, role, joinedAt, statusChangedAt: joinedAt });
  }
  const queries = (session = actors.member) =>
    createChatQueries({
      database: database.db,
      requireSession: async () => session,
      now: () => chatNow,
    });
  const people = (session = actors.member) =>
    createPeopleQueries({
      database: database.db,
      requireSession: async () => session,
      now: () => chatNow,
      rateLimiter: createMemoryRateLimiter(),
    });
  const actions = (session = actors.member, now = chatNow) =>
    createChatActions({
      database: database.db,
      getSession: async () => session,
      now: () => now,
      limiter: createMemoryRateLimiter(),
      publisher: {
        publish: async (channel, event) => {
          events.push({ channel, event });
        },
        publishMany: async (items) => {
          events.push(...items);
        },
      },
    });
  async function shares(me: string, other: string) {
    const [row] = await database.db
      .select({ value: sharesChatSpace(me, sql`${other}::uuid`) })
      .from(users)
      .where(eq(users.id, me));
    return row!.value;
  }
  const messageInput = (roomId: string, body = "안녕하세요") => ({
    roomId,
    body,
    clientId: crypto.randomUUID(),
  });

  it("does not substitute operator status for joining", async () => {
    for (const userId of [actors.member.userId, actors.operator.userId]) {
      expect(await spaceRoleOf(userId, loungeId, database.db)).toBeNull();
      expect(await canReadRoom(userId, loungeRoomId, database.db)).toBeNull();
    }
  });
  it("derives lounge administration and writing from branch roles, never the stored role", async () => {
    await join(loungeId, actors.member.userId, "owner");
    await join(loungeId, actors.operator.userId);
    expect(await spaceRoleOf(actors.member.userId, loungeId, database.db)).toBe(
      "member",
    );
    expect(
      await spaceRoleOf(actors.operator.userId, loungeId, database.db),
    ).toBe("admin");
    expect(
      (await canWriteRoom(actors.member.userId, noticeId, database.db))
        .canWrite,
    ).toBe(false);
    expect(
      (await canWriteRoom(actors.operator.userId, noticeId, database.db))
        .canWrite,
    ).toBe(true);
    await database.db
      .insert(roleSettings)
      .values({ branchId, role: "operator", permissions: [] });
    expect(
      await spaceRoleOf(actors.operator.userId, loungeId, database.db),
    ).toBe("member");
    await database.db.insert(roleSettings).values({
      branchId,
      role: "user",
      permissions: ["branch.announce", "chat.lounge"],
    });
    expect(await spaceRoleOf(actors.member.userId, loungeId, database.db)).toBe(
      "admin",
    );
    expect(
      await spaceRoleOf(actors.operator.userId, loungeId, database.db),
    ).toBe("admin");
  });
  it("keeps chat.lounge-disabled members readable but prevents send, edit and reaction", async () => {
    await join(loungeId, actors.member.userId);
    const sent = await actions().sendMessage(messageInput(loungeRoomId));
    if (!sent.ok) throw new Error("fixture send failed");
    await database.db
      .insert(roleSettings)
      .values({ branchId, role: "user", permissions: [] });
    expect(
      await canReadRoom(actors.member.userId, loungeRoomId, database.db),
    ).not.toBeNull();
    expect(
      await actions().sendMessage(messageInput(loungeRoomId)),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(
      await actions().editMessage({ messageId: sent.data.id, body: "변경" }),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(
      await actions().setReaction({
        messageId: sent.data.id,
        emoji: "heart",
        on: true,
      }),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
  it.each(["member", "admin", "owner"] as const)(
    "uses the active community %s role",
    async (role) => {
      await join(communityId, actors.member.userId, role);
      expect(
        await spaceRoleOf(actors.member.userId, communityId, database.db),
      ).toBe(role);
      expect(
        (await canWriteRoom(actors.member.userId, communityRoomId, database.db))
          .canWrite,
      ).toBe(true);
      await database.db
        .update(chatRooms)
        .set({ adminOnly: true })
        .where(eq(chatRooms.id, communityRoomId));
      expect(
        (await canWriteRoom(actors.member.userId, communityRoomId, database.db))
          .canWrite,
      ).toBe(role !== "member");
    },
  );
  it.each(["branch", "community"] as const)(
    "hides %s banned and deleted membership in every read path",
    async (kind) => {
      const spaceId = kind === "branch" ? loungeId : communityId;
      const roomId = kind === "branch" ? loungeRoomId : communityRoomId;
      await join(spaceId, actors.member.userId);
      await join(spaceId, actors.outsider.userId);
      expect(
        await people().getPersonProfile(actors.outsider.userId),
      ).toMatchObject({ userId: actors.outsider.userId });
      for (const state of ["banned", "deleted"] as const) {
        await database.db
          .update(chatSpaceMembers)
          .set({ status: state === "banned" ? "banned" : "active" })
          .where(
            and(
              eq(chatSpaceMembers.spaceId, spaceId),
              eq(chatSpaceMembers.userId, actors.member.userId),
            ),
          );
        if (state === "deleted")
          await database.db
            .update(chatSpaces)
            .set({ deletedAt: chatNow })
            .where(eq(chatSpaces.id, spaceId));
        expect(
          await canReadSpace(actors.member.userId, spaceId, database.db),
        ).toBeNull();
        expect(
          await spaceRoleOf(actors.member.userId, spaceId, database.db),
        ).toBeNull();
        expect(
          await canReadRoom(actors.member.userId, roomId, database.db),
        ).toBeNull();
        expect(await queries().getChannelView(spaceId, roomId)).toBeNull();
        await expect(
          people().getPersonProfile(actors.outsider.userId),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        expect(await shares(actors.member.userId, actors.outsider.userId)).toBe(
          false,
        );
        expect(await people().searchPeople("외부")).toEqual([]);
        expect(await actions().markRoomRead({ roomId, seq: 10 })).toMatchObject(
          { ok: false, code: "NOT_FOUND" },
        );
        expect(
          await saveSpaceMuted(
            {
              spaceId,
              userId: actors.member.userId,
              muted: true,
              now: chatNow,
            },
            database.db,
          ),
        ).toBeNull();
      }
    },
  );
  it("allows lounge profiles but not name discovery, shared presence or direct-message privileges", async () => {
    await join(loungeId, actors.member.userId);
    await join(loungeId, actors.outsider.userId);
    expect(await people().searchPeople("외부")).toEqual([]);
    expect(
      await people().getPersonProfile(actors.outsider.userId),
    ).toMatchObject({ sharedSpaces: [], canDirectMessage: false });
    expect(await shares(actors.member.userId, actors.outsider.userId)).toBe(
      false,
    );
    expect(
      (await people().getMessageContacts()).map((p) => p.userId),
    ).not.toContain(actors.outsider.userId);
    await join(communityId, actors.member.userId);
    await join(communityId, actors.outsider.userId);
    expect(
      (await people().searchPeople("외부")).map((p) => p.userId),
    ).toContain(actors.outsider.userId);
    expect(
      await people().getPersonProfile(actors.outsider.userId),
    ).toMatchObject({
      sharedSpaces: [{ id: communityId, name: "가상 모임" }],
      canDirectMessage: false,
    });
    expect(await shares(actors.member.userId, actors.outsider.userId)).toBe(
      true,
    );
    expect(
      (await people().getMessageContacts()).map((p) => p.userId),
    ).not.toContain(actors.outsider.userId);
  });
  it("returns only recent authors and administrators for a lounge, in the original two query stages", async () => {
    for (const actor of [
      actors.member,
      actors.outsider,
      actors.admin,
      actors.operator,
    ])
      await join(loungeId, actor.userId);
    await actions(actors.outsider).sendMessage(messageInput(loungeRoomId));
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      const view = await queries().getChannelView(loungeId, loungeRoomId);
      expect(meter.stop().perStage).toEqual([1, 2]);
      expect(view!.members.map((m) => m.id).sort()).toEqual(
        [actors.outsider.userId, actors.operator.userId].sort(),
      );
      expect(view!.members.every((m) => m.sharesSpace === false)).toBe(true);
      expect(JSON.stringify(view)).not.toContain(actors.admin.email);
      expect(JSON.stringify(view)).not.toContain(actors.admin.name);
    } finally {
      meter.restore();
    }
    await database.db
      .insert(roleSettings)
      .values({ branchId, role: "user", permissions: ["branch.announce"] });
    expect(
      (await queries().getChannelView(loungeId, loungeRoomId))!.members,
    ).toHaveLength(4);
  });
  it("starts unread state at rejoining even if the prior cursor remains", async () => {
    await join(communityId, actors.member.userId);
    await join(communityId, actors.outsider.userId);
    await actions(actors.outsider).sendMessage(messageInput(communityRoomId));
    expect(
      (await queries().getChannelView(communityId, communityRoomId))!
        .firstUnreadSeq,
    ).toBe(1);
    await database.db.insert(chatRoomReads).values({
      roomId: communityRoomId,
      userId: actors.member.userId,
      lastReadSeq: 0,
      updatedAt: chatNow,
    });
    await database.db
      .update(chatSpaceMembers)
      .set({ joinedAt: chatNow })
      .where(
        and(
          eq(chatSpaceMembers.spaceId, communityId),
          eq(chatSpaceMembers.userId, actors.member.userId),
        ),
      );
    expect(
      (await queries().getChannelView(communityId, communityRoomId))!
        .firstUnreadSeq,
    ).toBeNull();
    await actions(actors.outsider, new Date(chatNow.getTime() + 1)).sendMessage(
      messageInput(communityRoomId),
    );
    expect(
      (await queries().getChannelView(communityId, communityRoomId))!
        .firstUnreadSeq,
    ).toBe(2);
    expect(
      await actions().setSpaceMuted({ spaceId: communityId, muted: true }),
    ).toEqual({ ok: true, data: { muted: true } });
  });
  it("lets community owners mention everyone and moderate, and edits notify newly mentioned members", async () => {
    await join(communityId, actors.member.userId, "owner");
    await join(communityId, actors.outsider.userId);
    const sent = await actions(actors.outsider).sendMessage(
      messageInput(communityRoomId),
    );
    if (!sent.ok) throw new Error("fixture send failed");
    const edited = await actions(actors.outsider).editMessage({
      messageId: sent.data.id,
      body: `<@${actors.member.userId}> 확인해주세요`,
    });
    expect(edited.ok).toBe(true);
    expect(
      events.some(
        (item) =>
          item.channel === `user:${actors.member.userId}` &&
          item.event.type === "mention.created",
      ),
    ).toBe(true);
    const everyone = await actions().sendMessage(
      messageInput(communityRoomId, "<@everyone> 공지예요"),
    );
    expect(everyone).toMatchObject({
      ok: true,
      data: { mentionsEveryone: true },
    });
    expect(
      await actions().deleteMessage({ messageId: sent.data.id }),
    ).toMatchObject({ ok: true });
    const [stored] = await database.db
      .select()
      .from(messages)
      .where(eq(messages.id, sent.data.id));
    expect(stored!.deletedBy).toBe(actors.member.userId);
  });

  it.each(["send", "edit", "delete", "react"] as const)(
    "locks user → space → room and rechecks membership for %s",
    async (operation) => {
      await join(communityId, actors.member.userId, "owner");
      const sent = await actions().sendMessage(messageInput(communityRoomId));
      if (!sent.ok) throw new Error("fixture send failed");
      events.length = 0;
      const order: string[] = [];
      const lockUsers = writeDal.lockUsersForKeyShare;
      const lockSpace = accessDal.lockMessageSpace;
      const lockRoom = writeDal.lockRoomForMessage;
      vi.spyOn(writeDal, "lockUsersForKeyShare").mockImplementation(
        async (ids, tx) => {
          order.push("user");
          return lockUsers(ids, tx);
        },
      );
      vi.spyOn(accessDal, "lockMessageSpace").mockImplementation(
        async (spaceId, tx) => {
          order.push("space");
          await tx
            .update(chatSpaceMembers)
            .set({ status: "banned", role: "member" })
            .where(
              and(
                eq(chatSpaceMembers.spaceId, communityId),
                eq(chatSpaceMembers.userId, actors.member.userId),
              ),
            );
          return lockSpace(spaceId, tx);
        },
      );
      vi.spyOn(writeDal, "lockRoomForMessage").mockImplementation(
        async (roomId, tx) => {
          order.push("room");
          return lockRoom(roomId, tx);
        },
      );
      const api = actions();
      const result =
        operation === "send"
          ? await api.sendMessage(messageInput(communityRoomId))
          : operation === "edit"
            ? await api.editMessage({ messageId: sent.data.id, body: "수정" })
            : operation === "delete"
              ? await api.deleteMessage({ messageId: sent.data.id })
              : await api.setReaction({
                  messageId: sent.data.id,
                  emoji: "heart",
                  on: true,
                });
      expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
      expect(order.slice(0, 3)).toEqual(["user", "space", "room"]);
      expect(events).toEqual([]);
    },
  );

  it("rechecks moderation role after acquiring the space lock", async () => {
    await join(communityId, actors.member.userId, "owner");
    await join(communityId, actors.outsider.userId);
    const sent = await actions(actors.outsider).sendMessage(
      messageInput(communityRoomId),
    );
    if (!sent.ok) throw new Error("fixture send failed");
    const lockSpace = accessDal.lockMessageSpace;
    vi.spyOn(accessDal, "lockMessageSpace").mockImplementationOnce(
      async (spaceId, tx) => {
        await tx
          .update(chatSpaceMembers)
          .set({ role: "member" })
          .where(
            and(
              eq(chatSpaceMembers.spaceId, communityId),
              eq(chatSpaceMembers.userId, actors.member.userId),
            ),
          );
        return lockSpace(spaceId, tx);
      },
    );
    expect(
      await actions().deleteMessage({ messageId: sent.data.id }),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });
    const [stored] = await database.db
      .select()
      .from(messages)
      .where(eq(messages.id, sent.data.id));
    expect(stored!.deletedAt).toBeNull();
  });
});

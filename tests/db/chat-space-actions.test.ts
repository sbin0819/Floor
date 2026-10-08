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
import { createSpaceActions } from "@/features/chat/space-action-factory";
import { canReadSpace } from "@/lib/dal/chat-access";
import * as writes from "@/lib/dal/chat-space-write";
import * as schema from "@/lib/db/schema";
import {
  branches,
  chatRooms,
  chatSpaceInvites,
  chatSpaceMembers,
  chatSpaces,
  notifications,
} from "@/lib/db/schema";
import type { RealtimeItem } from "@/lib/realtime/types";
import { chatNow, seedChatActors, type ChatActors } from "./chat-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("space lifecycle actions", () => {
  let database: TestDatabase;
  let actors: ChatActors;
  const events: RealtimeItem[] = [];
  const publisher = {
    publish: vi.fn(),
    publishMany: vi.fn(async (items: readonly RealtimeItem[]) => {
      events.push(...items);
    }),
  };
  const logError = vi.fn();
  const statements: { text: string; params: unknown[] }[] = [];
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
    events.length = 0;
    logError.mockClear();
    statements.length = 0;
  });
  const actions = (session = actors.member) =>
    createSpaceActions({
      database: database.db,
      getSession: async () => session,
      now: () => chatNow,
      publisher,
      logError,
    });
  async function community(session = actors.member) {
    const result = await actions(session).createCommunitySpace({
      name: "가상 커뮤니티",
      iconColor: "green",
    });
    if (!result.ok) throw new Error(result.code);
    return result.data;
  }
  async function branch() {
    const [row] = await database.db
      .insert(branches)
      .values({
        name: "가상 라운지 지점",
        address: "가상 주소",
        timezone: "Asia/Seoul",
      })
      .returning();
    return row!.id;
  }
  async function addMember(
    spaceId: string,
    userId: string,
    role: "member" | "admin" = "member",
    status: "active" | "banned" = "active",
  ) {
    await database.db.insert(chatSpaceMembers).values({
      spaceId,
      userId,
      role,
      status,
      joinedAt: chatNow,
      statusChangedAt: chatNow,
    });
  }
  async function membership(spaceId: string, userId: string) {
    return (
      await database.db
        .select()
        .from(chatSpaceMembers)
        .where(
          and(
            eq(chatSpaceMembers.spaceId, spaceId),
            eq(chatSpaceMembers.userId, userId),
          ),
        )
    )[0];
  }
  it("creates an owner and exactly one default channel, then reauthorizes", async () => {
    const result = await community();
    expect(
      await membership(result.spaceId, actors.member.userId),
    ).toMatchObject({ role: "owner", status: "active" });
    expect(
      await database.db
        .select()
        .from(chatRooms)
        .where(eq(chatRooms.spaceId, result.spaceId)),
    ).toMatchObject([{ id: result.roomId, name: "일반", kind: "text" }]);
    expect(events).toEqual([
      {
        channel: `user:${actors.member.userId}`,
        event: { type: "realtime.reauth" },
      },
    ]);
  });
  it("joins an unprovisioned lounge idempotently, without broadcasting its members", async () => {
    const branchId = await branch();
    const first = await actions().joinLounge({ branchId });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const old = await membership(first.data.spaceId, actors.member.userId);
    events.length = 0;
    expect(await actions().joinLounge({ branchId })).toEqual(first);
    expect(await membership(first.data.spaceId, actors.member.userId)).toEqual(
      old,
    );
    expect(events).toEqual([]);
    expect(await actions().leaveSpace({ spaceId: first.data.spaceId })).toEqual(
      { ok: true, data: {} },
    );
    expect(events.every((item) => item.event.type === "realtime.reauth")).toBe(
      true,
    );
    expect(
      await canReadSpace(actors.member.userId, first.data.spaceId, database.db),
    ).toBeFalsy();
    expect((await actions().joinLounge({ branchId })).ok).toBe(true);
  });
  it("does not disclose nonexistent lounges", async () => {
    expect(
      await actions().joinLounge({ branchId: crypto.randomUUID() }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
  });
  it("cannot leave a team, own community or remove a ban", async () => {
    expect(await actions().leaveSpace({ spaceId: actors.spaceId })).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    const { spaceId } = await community();
    expect(await actions().leaveSpace({ spaceId })).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    await addMember(spaceId, actors.outsider.userId, "member", "banned");
    expect(await actions(actors.outsider).leaveSpace({ spaceId })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await membership(spaceId, actors.outsider.userId)).toMatchObject({
      status: "banned",
    });
  });
  it("only the owner edits community identity or administrators", async () => {
    const { spaceId } = await community();
    await addMember(spaceId, actors.admin.userId, "admin");
    expect(
      await actions(actors.admin).updateSpace({ spaceId, name: "탈취" }),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(
      await actions(actors.outsider).updateSpace({ spaceId, name: "탈취" }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(
      await actions().updateSpace({
        spaceId,
        name: "변경",
        iconColor: "purple",
      }),
    ).toEqual({ ok: true, data: {} });
    expect(
      await actions().setSpaceAdmin({
        spaceId,
        userId: actors.admin.userId,
        admin: false,
      }),
    ).toEqual({ ok: true, data: {} });
    expect(await membership(spaceId, actors.admin.userId)).toMatchObject({
      role: "member",
    });
    expect(
      await actions().setSpaceAdmin({
        spaceId,
        userId: actors.member.userId,
        admin: false,
      }),
    ).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(
      await actions().setSpaceAdmin({
        spaceId,
        userId: actors.outsider.userId,
        admin: true,
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
  });
  it("transfers ownership atomically and preserves the old owner as administrator", async () => {
    const { spaceId } = await community();
    await addMember(spaceId, actors.admin.userId);
    expect(
      await actions().transferSpaceOwnership({
        spaceId,
        userId: actors.outsider.userId,
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await membership(spaceId, actors.member.userId)).toMatchObject({
      role: "owner",
    });
    expect(
      await actions().transferSpaceOwnership({
        spaceId,
        userId: actors.admin.userId,
      }),
    ).toEqual({ ok: true, data: {} });
    expect(await membership(spaceId, actors.member.userId)).toMatchObject({
      role: "admin",
    });
    expect(await membership(spaceId, actors.admin.userId)).toMatchObject({
      role: "owner",
    });
  });
  it("checks exact confirmation, revokes invites, deletes their notifications and denies access", async () => {
    const { spaceId } = await community();
    await addMember(spaceId, actors.admin.userId);
    const code = "a".repeat(22);
    await database.db
      .insert(chatSpaceInvites)
      .values({ spaceId, code, createdBy: actors.member.userId });
    await database.db.insert(notifications).values({
      userId: actors.outsider.userId,
      type: "space_invite",
      data: sql`${JSON.stringify({ actorName: "가상", spaceName: "가상 커뮤니티", inviteCode: code })}::jsonb`,
      scheduledFor: chatNow,
    });
    expect(
      await actions().deleteSpace({ spaceId, confirmName: "가상 커뮤니티 " }),
    ).toEqual({ ok: false, code: "INVALID_INPUT" });
    events.length = 0;
    expect(
      await actions().deleteSpace({ spaceId, confirmName: "가상 커뮤니티" }),
    ).toEqual({ ok: true, data: {} });
    expect(
      await canReadSpace(actors.member.userId, spaceId, database.db),
    ).toBeFalsy();
    expect(await database.db.select().from(notifications)).toEqual([]);
    expect(
      (await database.db.select().from(chatSpaceInvites))[0]?.revokedAt,
    ).toEqual(chatNow);
    expect(
      events.filter((item) => item.event.type === "realtime.reauth"),
    ).toHaveLength(2);
  });
  it("enforces ten owned spaces but ignores deleted communities", async () => {
    for (let index = 0; index < 10; index++) await community();
    expect(
      await actions().createCommunitySpace({
        name: "열한 번째",
        iconColor: "blue",
      }),
    ).toEqual({ ok: false, code: "LIMIT_EXCEEDED", message: "space_count" });
    const [space] = await database.db
      .select()
      .from(chatSpaces)
      .where(eq(chatSpaces.kind, "community"));
    await actions().deleteSpace({
      spaceId: space!.id,
      confirmName: space!.name,
    });
    expect(
      (
        await actions().createCommunitySpace({
          name: "대체",
          iconColor: "blue",
        })
      ).ok,
    ).toBe(true);
  });
  it("checks the shared join limit under the user lock", async () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({
      id: crypto.randomUUID(),
      kind: "community" as const,
      name: `가상 ${index}`,
      createdBy: actors.admin.userId,
    }));
    await database.db.insert(chatSpaces).values(rows);
    await database.db.insert(chatSpaceMembers).values(
      rows.map((space) => ({
        spaceId: space.id,
        userId: actors.member.userId,
        role: "member" as const,
        joinedAt: chatNow,
        statusChangedAt: chatNow,
      })),
    );
    expect(
      await actions().createCommunitySpace({ name: "한도", iconColor: "blue" }),
    ).toEqual({
      ok: false,
      code: "LIMIT_EXCEEDED",
      message: "space_join_count",
    });
    expect(await actions().joinLounge({ branchId: await branch() })).toEqual({
      ok: false,
      code: "LIMIT_EXCEEDED",
      message: "space_join_count",
    });
  });
  it("does not undo committed storage or expose payloads when publishing fails", async () => {
    publisher.publishMany.mockRejectedValueOnce(new Error("private payload"));
    const { spaceId } = await community();
    expect(await membership(spaceId, actors.member.userId)).toBeDefined();
    expect(logError).toHaveBeenCalledWith("Space realtime publication failed.");
  });
  it("rejects unauthenticated and invalid inputs before a transaction", async () => {
    const anonymous = createSpaceActions({
      database: database.db,
      getSession: async () => null,
    });
    expect(await anonymous.createCommunitySpace({})).toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    expect(
      await actions().createCommunitySpace({ name: " ", iconColor: "red" }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("locks users in UUID order before space and membership rows", async () => {
    const { spaceId } = await community();
    await addMember(spaceId, actors.admin.userId);
    statements.length = 0;
    await actions().transferSpaceOwnership({
      spaceId,
      userId: actors.admin.userId,
    });
    const locks = statements.filter(({ text }) =>
      /for (update|key share)/i.test(text),
    );
    expect(locks[0]?.params).toEqual(
      [actors.member.userId, actors.admin.userId].sort(),
    );
    expect(locks[0]?.text).toContain('order by "users"."id" asc for key share');
    expect(locks[1]?.text).toContain('from "chat_spaces"');
    expect(locks[2]?.text).toContain('from "chat_space_members"');
  });

  it("rolls back the old owner's demotion when promotion fails and emits nothing", async () => {
    const { spaceId } = await community();
    await addMember(spaceId, actors.admin.userId);
    const original = writes.updateSpaceRole;
    vi.spyOn(writes, "updateSpaceRole").mockImplementation(async (...args) => {
      if (args[2] === "owner") throw new Error("injected failure");
      return original(...args);
    });
    events.length = 0;
    expect(
      await actions().transferSpaceOwnership({
        spaceId,
        userId: actors.admin.userId,
      }),
    ).toEqual({ ok: false, code: "INTERNAL" });
    expect(await membership(spaceId, actors.member.userId)).toMatchObject({
      role: "owner",
    });
    expect(await membership(spaceId, actors.admin.userId)).toMatchObject({
      role: "member",
    });
    expect(events).toEqual([]);
  });

  it("allows transfer to an owner of ten communities without allowing an eleventh creation", async () => {
    const { spaceId } = await community();
    for (let index = 0; index < 10; index++) await community(actors.admin);
    await addMember(spaceId, actors.admin.userId);
    expect(
      await actions().transferSpaceOwnership({
        spaceId,
        userId: actors.admin.userId,
      }),
    ).toEqual({ ok: true, data: {} });
    expect(
      await actions(actors.admin).createCommunitySpace({
        name: "추가",
        iconColor: "blue",
      }),
    ).toEqual({ ok: false, code: "LIMIT_EXCEEDED", message: "space_count" });
  });
});

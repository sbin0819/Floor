import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/lib/db/schema";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createSpaceInviteActions } from "@/features/chat/space-invite-actions";
import { createSpaceInviteQueries } from "@/features/chat/space-invite-queries";
import { createNotificationQueries } from "@/features/notifications/query-factory";
import * as inviteDal from "@/lib/dal/chat-space-invites";
import {
  chatSpaceInvites,
  chatSpaceMembers,
  chatSpaces,
  friendships,
  notifications,
  userBlocks,
  users,
} from "@/lib/db/schema";
import {
  createMemoryRateLimiter,
  RateLimitError,
} from "@/lib/rate-limit/memory";
import { chatNow } from "./chat-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { seedInviteActors, type InviteActors } from "./space-invite-helper";

describe("community invitation actions", () => {
  let database: TestDatabase;
  let actors: InviteActors;
  let limiter: ReturnType<typeof createMemoryRateLimiter>;
  const publishMany = vi.fn();
  const logError = vi.fn();
  const statements: string[] = [];
  beforeAll(async () => {
    database = await createTestDatabase();
    database.db = drizzle({
      client: database.client,
      schema,
      logger: {
        logQuery(query) {
          statements.push(query);
        },
      },
    });
  });
  afterAll(async () => {
    await database.client.close();
  });
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    await database.db.execute(sql`TRUNCATE users, branches CASCADE`);
    actors = await seedInviteActors(database);
    limiter = createMemoryRateLimiter(() => chatNow.getTime());
    publishMany.mockReset();
    logError.mockReset();
    statements.length = 0;
  });
  const actions = (me = actors.admin, createCode?: () => string) =>
    createSpaceInviteActions({
      database: database.db,
      getSession: async () => me,
      now: () => chatNow,
      limiter,
      publisher: { publish: vi.fn(), publishMany },
      logError,
      baseUrl: "https://floor.example.test",
      createCode,
    });
  const linkInput = () => ({
    spaceId: actors.communityId,
    expiresIn: "7d",
    maxUses: 1,
  });
  const preview = (me = actors.outsider) =>
    createSpaceInviteQueries({
      database: database.db,
      requireSession: async () => me,
      now: () => chatNow,
      limiter,
    });
  async function link(me = actors.admin) {
    const result = await actions(me).createInviteLink(linkInput());
    if (!result.ok) throw new Error(result.code);
    return result.data;
  }
  async function friend() {
    const [userLowId, userHighId] = [
      actors.admin.userId,
      actors.outsider.userId,
    ].sort();
    await database.db.insert(friendships).values({
      userLowId: userLowId!,
      userHighId: userHighId!,
      requestedBy: actors.admin.userId,
      requestedAt: chatNow,
      status: "accepted",
      statusChangedAt: chatNow,
    });
  }
  async function direct() {
    await friend();
    return actions().inviteToSpace({
      spaceId: actors.communityId,
      userIds: [actors.outsider.userId],
    });
  }

  it("creates cryptographically sized link codes for members and hides inaccessible communities", async () => {
    const first = await link(actors.member);
    expect(first.code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(first.url).toBe(`https://floor.example.test/s/join/${first.code}`);
    expect(
      (await database.db.select().from(chatSpaceInvites))[0],
    ).toMatchObject({
      createdBy: actors.member.userId,
      maxUses: 1,
      useCount: 0,
      expiresAt: new Date(chatNow.getTime() + 7 * 86_400_000),
    });
    expect(
      await actions(actors.outsider).createInviteLink(linkInput()),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
  });
  it("allows exactly twenty recent links per creator and space", async () => {
    await database.db.insert(chatSpaceInvites).values(
      Array.from({ length: 19 }, (_, index) => ({
        spaceId: actors.communityId,
        createdBy: actors.member.userId,
        code: index.toString().padStart(22, "A"),
        createdAt: chatNow,
      })),
    );
    expect(
      (await actions(actors.member).createInviteLink(linkInput())).ok,
    ).toBe(true);
    expect(await actions(actors.member).createInviteLink(linkInput())).toEqual({
      ok: false,
      code: "LIMIT_EXCEEDED",
      message: "invite_count",
    });
    expect((await actions().createInviteLink(linkInput())).ok).toBe(true);
  });

  it.each(["1d", "never"] as const)(
    "supports the %s expiry and unlimited-use option",
    async (expiresIn) => {
      expect(
        (
          await actions().createInviteLink({
            ...linkInput(),
            expiresIn,
            maxUses: null,
          })
        ).ok,
      ).toBe(true);
      const [row] = await database.db.select().from(chatSpaceInvites);
      expect(row?.expiresAt).toEqual(
        expiresIn === "never" ? null : new Date(chatNow.getTime() + 86_400_000),
      );
      expect(row?.maxUses).toBeNull();
    },
  );

  it("does not count links created exactly a day ago toward the rolling quota", async () => {
    await database.db
      .insert(chatSpaceInvites)
      .values(
        Array.from({ length: 20 }, (_, index) => ({
          spaceId: actors.communityId,
          createdBy: actors.admin.userId,
          code: String(index).padStart(22, "A"),
          createdAt: new Date(chatNow.getTime() - 86_400_000),
        })),
      );
    expect((await actions().createInviteLink(linkInput())).ok).toBe(true);
  });
  it("rejects a generated code collision and rolls back without exposing the code", async () => {
    const first = await link();
    const result = await actions(
      actors.member,
      () => first.code,
    ).createInviteLink(linkInput());
    expect(result).toEqual({ ok: false, code: "INTERNAL" });
    expect(await database.db.select().from(chatSpaceInvites)).toHaveLength(1);
    expect(JSON.stringify(logError.mock.calls)).not.toContain(first.code);
  });
  it("revokes links for the creator or administrators, never other members or departed creators", async () => {
    const first = await link();
    expect(
      await actions(actors.member).revokeInvite({ inviteId: first.inviteId }),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(
      (
        await actions(actors.operator).revokeInvite({
          inviteId: first.inviteId,
        })
      ).ok,
    ).toBe(true);
    const before = await database.db.select().from(chatSpaceInvites);
    expect(
      (await actions().revokeInvite({ inviteId: first.inviteId })).ok,
    ).toBe(true);
    expect(await database.db.select().from(chatSpaceInvites)).toEqual(before);
    const second = await link(actors.member);
    await database.db
      .delete(chatSpaceMembers)
      .where(
        and(
          eq(chatSpaceMembers.spaceId, actors.communityId),
          eq(chatSpaceMembers.userId, actors.member.userId),
        ),
      );
    expect(
      await actions(actors.member).revokeInvite({ inviteId: second.inviteId }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
  });
  it("joins once under the invitation lock, consumes the last use, and emits only after committing", async () => {
    const first = await link();
    expect(await preview().getInvitePreview(first.code)).toEqual({
      state: "open",
      spaceName: "가상 커뮤니티",
      iconColor: "purple",
      memberCount: 3,
    });
    publishMany.mockImplementation(async () => {
      expect(
        await database.db
          .select()
          .from(chatSpaceMembers)
          .where(eq(chatSpaceMembers.userId, actors.outsider.userId)),
      ).toHaveLength(1);
    });
    expect(
      await actions(actors.outsider).joinSpaceByInvite({ code: first.code }),
    ).toEqual({ ok: true, data: { spaceId: actors.communityId } });
    expect(await preview().getInvitePreview(first.code)).toEqual({
      state: "member",
      spaceId: actors.communityId,
    });
    expect(
      (await actions(actors.outsider).joinSpaceByInvite({ code: first.code }))
        .ok,
    ).toBe(true);
    expect(
      (await database.db.select().from(chatSpaceInvites))[0]?.useCount,
    ).toBe(1);
    expect(publishMany).toHaveBeenCalledOnce();
  });
  it.each([
    "revoked",
    "expired",
    "used",
    "deleted",
    "wrong-recipient",
    "banned",
  ] as const)("unifies %s invitations as invalid", async (mode) => {
    const first = await link();
    if (mode === "revoked")
      await database.db.update(chatSpaceInvites).set({ revokedAt: chatNow });
    if (mode === "expired")
      await database.db.update(chatSpaceInvites).set({ expiresAt: chatNow });
    if (mode === "used")
      await database.db.update(chatSpaceInvites).set({ useCount: 1 });
    if (mode === "deleted")
      await database.db
        .update(chatSpaces)
        .set({ deletedAt: chatNow })
        .where(eq(chatSpaces.id, actors.communityId));
    if (mode === "wrong-recipient")
      await database.db
        .update(chatSpaceInvites)
        .set({ targetUserId: actors.member.userId });
    if (mode === "banned")
      await database.db.insert(chatSpaceMembers).values({
        spaceId: actors.communityId,
        userId: actors.outsider.userId,
        status: "banned",
        joinedAt: chatNow,
        statusChangedAt: chatNow,
      });
    expect(await preview().getInvitePreview(first.code)).toEqual({
      state: "invalid",
    });
    expect(
      await actions(actors.outsider).joinSpaceByInvite({ code: first.code }),
    ).toEqual({ ok: false, code: "INVITE_INVALID" });
  });
  it("checks membership before revoked/expired/used/target rules and never consumes another use", async () => {
    const first = await link();
    await database.db.update(chatSpaceInvites).set({
      revokedAt: chatNow,
      expiresAt: chatNow,
      useCount: 1,
      targetUserId: actors.outsider.userId,
    });
    expect(await preview(actors.member).getInvitePreview(first.code)).toEqual({
      state: "member",
      spaceId: actors.communityId,
    });
    expect(
      (await actions(actors.member).joinSpaceByInvite({ code: first.code })).ok,
    ).toBe(true);
    expect(
      (await database.db.select().from(chatSpaceInvites))[0]?.useCount,
    ).toBe(1);
  });

  it("locks user then space then membership then invite and conditionally consumes the use", async () => {
    const first = await link();
    statements.length = 0;
    expect(
      (await actions(actors.outsider).joinSpaceByInvite({ code: first.code }))
        .ok,
    ).toBe(true);
    const locks = statements.filter((statement) =>
      /for (?:update|key share)/i.test(statement),
    );
    expect(locks).toHaveLength(4);
    for (const [index, table] of [
      "users",
      "chat_spaces",
      "chat_space_members",
      "chat_space_invites",
    ].entries())
      expect(locks[index]).toContain(`from "${table}"`);
    const update = statements.find((statement) =>
      statement.startsWith('update "chat_space_invites"'),
    )!;
    expect(update).toContain('"revoked_at" is null');
    expect(update).toContain('"use_count" <');
    expect(update).toContain("returning");
  });

  it("rechecks the last available use after obtaining the invite lock", async () => {
    const first = await link();
    const original = inviteDal.lockInvite;
    vi.spyOn(inviteDal, "lockInvite").mockImplementationOnce(async (id, tx) => {
      await tx
        .update(chatSpaceInvites)
        .set({ useCount: 1 })
        .where(eq(chatSpaceInvites.id, id));
      return original(id, tx);
    });
    expect(
      await actions(actors.outsider).joinSpaceByInvite({ code: first.code }),
    ).toEqual({ ok: false, code: "INVITE_INVALID" });
    expect(
      await database.db
        .select()
        .from(chatSpaceMembers)
        .where(eq(chatSpaceMembers.userId, actors.outsider.userId)),
    ).toEqual([]);
    expect(publishMany).not.toHaveBeenCalled();
  });

  it("allows only one of two queued participants to consume a one-use link", async () => {
    const first = await link();
    const [second] = await database.db
      .insert(users)
      .values({ name: "다른 참가자", email: "second-join@example.test" })
      .returning();
    const results = await Promise.all([
      actions(actors.outsider).joinSpaceByInvite({ code: first.code }),
      actions({
        userId: second!.id,
        name: second!.name,
        email: second!.email,
      }).joinSpaceByInvite({ code: first.code }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, code: "INVITE_INVALID" },
    ]);
    expect(
      (await database.db.select().from(chatSpaceInvites))[0]?.useCount,
    ).toBe(1);
    expect(
      await database.db
        .select()
        .from(chatSpaceMembers)
        .where(eq(chatSpaceMembers.spaceId, actors.communityId)),
    ).toHaveLength(4);
  });

  it("returns the same invalid result for a well-formed missing code", async () => {
    expect(await preview().getInvitePreview("x".repeat(22))).toEqual({
      state: "invalid",
    });
    expect(
      await actions(actors.outsider).joinSpaceByInvite({
        code: "x".repeat(22),
      }),
    ).toEqual({ ok: false, code: "INVITE_INVALID" });
  });
  it("shares thirty hourly preview/join attempts, including malformed codes, without querying for malformed codes", async () => {
    const read = vi.spyOn(inviteDal, "readInviteResolution");
    for (let index = 0; index < 15; index++) {
      expect(await preview().getInvitePreview("bad")).toEqual({
        state: "invalid",
      });
      expect(
        await actions(actors.outsider).joinSpaceByInvite({ code: "bad" }),
      ).toEqual({ ok: false, code: "INVITE_INVALID" });
    }
    expect(read).not.toHaveBeenCalled();
    await expect(preview().getInvitePreview("bad")).rejects.toBeInstanceOf(
      RateLimitError,
    );
    expect(
      await actions(actors.outsider).joinSpaceByInvite({ code: "bad" }),
    ).toEqual({ ok: false, code: "LIMIT_EXCEEDED" });
  });
  it("keeps a successful send when realtime publication fails and records no invitation data", async () => {
    publishMany.mockRejectedValue(new Error("private provider value"));
    expect(await direct()).toEqual({ ok: true, data: { sent: 1 } });
    expect(await database.db.select().from(notifications)).toHaveLength(1);
    expect(logError).toHaveBeenCalledWith("Space realtime publication failed.");
  });
  it("sends one expiring snapshot and silently skips an existing unread invite", async () => {
    expect(await direct()).toEqual({ ok: true, data: { sent: 1 } });
    const [invite] = await database.db.select().from(chatSpaceInvites);
    const [notice] = await database.db.select().from(notifications);
    expect(notice).toMatchObject({
      userId: actors.outsider.userId,
      type: "space_invite",
      expiresAt: invite!.expiresAt,
      data: {
        actorName: actors.admin.name,
        spaceName: "가상 커뮤니티",
        inviteCode: invite!.code,
      },
    });
    expect(Object.keys(notice!.data).sort()).toEqual([
      "actorName",
      "inviteCode",
      "spaceName",
    ]);
    expect(
      await actions().inviteToSpace({
        spaceId: actors.communityId,
        userIds: [actors.outsider.userId, actors.outsider.userId],
      }),
    ).toEqual({ ok: true, data: { sent: 0 } });
    expect(await database.db.select().from(notifications)).toHaveLength(1);
    expect(publishMany).toHaveBeenCalledExactlyOnceWith([
      {
        channel: `user:${actors.outsider.userId}`,
        event: { type: "notifications.changed" },
      },
    ]);
    const summary = await createNotificationQueries({
      database: database.db,
      requireSession: async () => actors.outsider,
      now: () => chatNow,
    }).getNotificationSummary();
    expect(summary.items[0]).toMatchObject({
      type: "space_invite",
      href: `/s/join/${invite!.code}`,
    });
    expect(
      (await actions(actors.outsider).joinSpaceByInvite({ code: invite!.code }))
        .ok,
    ).toBe(true);
    expect(await database.db.select().from(notifications)).toEqual([]);
  });
  it("reuses valid direct invitations after the prior notice was read and permits fresh invitations after expiry", async () => {
    await direct();
    await database.db.update(notifications).set({ readAt: chatNow });
    expect(
      await actions().inviteToSpace({
        spaceId: actors.communityId,
        userIds: [actors.outsider.userId],
      }),
    ).toEqual({ ok: true, data: { sent: 1 } });
    expect(await database.db.select().from(chatSpaceInvites)).toHaveLength(1);
    await database.db.update(chatSpaceInvites).set({ expiresAt: chatNow });
    await database.db.update(notifications).set({ expiresAt: chatNow });
    expect(
      await actions().inviteToSpace({
        spaceId: actors.communityId,
        userIds: [actors.outsider.userId],
      }),
    ).toEqual({ ok: true, data: { sent: 1 } });
    expect(await database.db.select().from(chatSpaceInvites)).toHaveLength(2);
  });
  it.each(["by-me", "by-them", "banned", "member"] as const)(
    "silently skips %s before checking relationship eligibility",
    async (mode) => {
      if (mode === "by-me" || mode === "by-them")
        await database.db.insert(userBlocks).values({
          blockerId:
            mode === "by-me" ? actors.admin.userId : actors.outsider.userId,
          blockedId:
            mode === "by-me" ? actors.outsider.userId : actors.admin.userId,
        });
      else
        await database.db.insert(chatSpaceMembers).values({
          spaceId: actors.communityId,
          userId: actors.outsider.userId,
          status: mode === "banned" ? "banned" : "active",
          joinedAt: chatNow,
          statusChangedAt: chatNow,
        });
      expect(
        await actions().inviteToSpace({
          spaceId: actors.communityId,
          userIds: [actors.outsider.userId],
        }),
      ).toEqual({ ok: true, data: { sent: 0 } });
      expect(await database.db.select().from(notifications)).toEqual([]);
    },
  );
  it("rejects unrelated recipients and missing users without revealing which target failed", async () => {
    expect(
      await actions().inviteToSpace({
        spaceId: actors.communityId,
        userIds: [actors.outsider.userId],
      }),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(
      await actions().inviteToSpace({
        spaceId: actors.communityId,
        userIds: [crypto.randomUUID()],
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
  });
  it("rolls back every inserted invite and notice if notification insertion fails", async () => {
    await friend();
    vi.spyOn(inviteDal, "insertInviteNotifications").mockRejectedValueOnce(
      new Error("private detail"),
    );
    expect(
      await actions().inviteToSpace({
        spaceId: actors.communityId,
        userIds: [actors.outsider.userId],
      }),
    ).toEqual({ ok: false, code: "INTERNAL" });
    expect(await database.db.select().from(chatSpaceInvites)).toEqual([]);
    expect(await database.db.select().from(notifications)).toEqual([]);
    expect(publishMany).not.toHaveBeenCalled();
  });
  it("removes direct invitation notifications on revoke", async () => {
    await direct();
    const [invite] = await database.db.select().from(chatSpaceInvites);
    expect((await actions().revokeInvite({ inviteId: invite!.id })).ok).toBe(
      true,
    );
    expect(await database.db.select().from(notifications)).toEqual([]);
  });
});

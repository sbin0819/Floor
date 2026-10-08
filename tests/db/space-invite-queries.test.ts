import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSpaceInviteQueries } from "@/features/chat/space-invite-queries";
import { createSpaceInviteActions } from "@/features/chat/space-invite-actions";
import { ActionError } from "@/lib/actions/result";
import { avatarColorFor } from "@/lib/avatar";
import {
  chatSpaceMembers,
  chatSpaceInvites,
  chatSpaces,
  friendships,
  users,
  branches,
  userBlocks,
  teamMembers,
} from "@/lib/db/schema";
import { createMemoryRateLimiter } from "@/lib/rate-limit/memory";
import { chatNow } from "./chat-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { seedInviteActors, type InviteActors } from "./space-invite-helper";
import { createQueryMeter } from "./query-meter";

describe("community invitation queries and quotas", () => {
  let database: TestDatabase;
  let actors: InviteActors;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    await database.db.execute(sql`TRUNCATE users, branches CASCADE`);
    actors = await seedInviteActors(database);
  });
  const queries = (me = actors.admin) =>
    createSpaceInviteQueries({
      database: database.db,
      requireSession: async () => me,
      now: () => chatNow,
      limiter: createMemoryRateLimiter(),
    });
  const actions = (me = actors.admin) =>
    createSpaceInviteActions({
      database: database.db,
      getSession: async () => me,
      now: () => chatNow,
      limiter: createMemoryRateLimiter(),
      baseUrl: "https://floor.example.test",
      publisher: { publish: async () => {}, publishMany: async () => {} },
      logError: () => {},
    });
  async function invitation(
    values: Partial<typeof chatSpaceInvites.$inferInsert> = {},
  ) {
    const [row] = await database.db
      .insert(chatSpaceInvites)
      .values({
        spaceId: actors.communityId,
        createdBy: actors.admin.userId,
        code: crypto.randomUUID().replaceAll("-", "").slice(0, 22),
        createdAt: chatNow,
        ...values,
      })
      .returning();
    return row!;
  }
  const member = (spaceId: string, userId: string) => ({
    spaceId,
    userId,
    joinedAt: chatNow,
    statusChangedAt: chatNow,
  });

  it("returns usable links only, full codes only for their creator and prefixes for administrators", async () => {
    const ownerLink = await invitation();
    const memberLink = await invitation({ createdBy: actors.member.userId });
    await invitation({ expiresAt: chatNow });
    await invitation({ revokedAt: chatNow });
    await invitation({ maxUses: 1, useCount: 1 });
    await invitation({ targetUserId: actors.outsider.userId });
    const owner = await queries().getSpaceInvites(actors.communityId);
    expect(owner).toHaveLength(2);
    expect(owner.find(({ inviteId }) => inviteId === ownerLink.id)).toEqual({
      inviteId: ownerLink.id,
      codePrefix: ownerLink.code.slice(0, 6),
      code: ownerLink.code,
      createdByName: actors.admin.name,
      createdByAvatar: {
        color: avatarColorFor(actors.admin.userId, null),
        photoUrl: null,
      },
      expiresAt: null,
      useCount: 0,
      maxUses: null,
    });
    expect(
      owner.find(({ inviteId }) => inviteId === memberLink.id),
    ).not.toHaveProperty("code");
    const memberRows = await queries(actors.member).getSpaceInvites(
      actors.communityId,
    );
    expect(memberRows).toHaveLength(1);
    expect(memberRows[0]).toMatchObject({
      inviteId: memberLink.id,
      code: memberLink.code,
    });
    await expect(
      queries(actors.outsider).getSpaceInvites(actors.communityId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("never exposes candidates for an inaccessible or nonexistent community", async () => {
    await expect(
      queries(actors.outsider).getInviteCandidates(actors.communityId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      queries().getInviteCandidates(crypto.randomUUID()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(queries().getInviteCandidates("bad")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const guarded = createSpaceInviteQueries({
      requireSession: async () => {
        throw new ActionError("UNAUTHENTICATED");
      },
    });
    await expect(guarded.getInvitePreview("bad")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });
  it("offers friends, team members and shared-community members but never lounge-only people", async () => {
    const candidates = await database.db
      .insert(users)
      .values(
        ["가 팀원", "나 친구", "다 커뮤니티", "라 라운지"].map((name) => ({
          name,
          email: `${crypto.randomUUID()}@example.test`,
        })),
      )
      .returning();
    await database.db
      .insert(teamMembers)
      .values({ teamId: actors.teamId, userId: candidates[0]!.id });
    const pair = [actors.admin.userId, candidates[1]!.id].sort();
    await database.db.insert(friendships).values({
      userLowId: pair[0]!,
      userHighId: pair[1]!,
      requestedBy: actors.admin.userId,
      requestedAt: chatNow,
      statusChangedAt: chatNow,
      status: "accepted",
    });
    const [community] = await database.db
      .insert(chatSpaces)
      .values({
        kind: "community",
        name: "다른 모임",
        createdBy: actors.admin.userId,
      })
      .returning();
    const [branch] = await database.db
      .insert(branches)
      .values({ name: "라운지 지점" })
      .returning();
    const [lounge] = await database.db
      .insert(chatSpaces)
      .values({ kind: "branch", branchId: branch!.id })
      .returning();
    for (const [spaceId, otherId] of [
      [community!.id, candidates[2]!.id],
      [lounge!.id, candidates[3]!.id],
    ])
      await database.db
        .insert(chatSpaceMembers)
        .values([
          member(spaceId!, actors.admin.userId),
          member(spaceId!, otherId!),
        ]);
    expect(await queries().getInviteCandidates(actors.communityId)).toEqual(
      candidates
        .slice(0, 3)
        .map(({ id: userId, name, username }) => ({
          userId,
          name,
          username,
          avatar: { color: avatarColorFor(userId, null), photoUrl: null },
        })),
    );
    expect(
      await actions().inviteToSpace({
        spaceId: actors.communityId,
        userIds: [candidates[3]!.id],
      }),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(
      await actions().inviteToSpace({
        spaceId: actors.communityId,
        userIds: candidates.slice(0, 3).map(({ id }) => id),
      }),
    ).toEqual({ ok: true, data: { sent: 3 } });
    await database.db
      .update(chatSpaceMembers)
      .set({ status: "banned" })
      .where(eq(chatSpaceMembers.userId, candidates[2]!.id));
    await database.db
      .insert(userBlocks)
      .values({ blockerId: candidates[1]!.id, blockedId: actors.admin.userId });
    await database.db
      .insert(chatSpaceMembers)
      .values(member(actors.communityId, candidates[0]!.id));
    expect(await queries().getInviteCandidates(actors.communityId)).toEqual([]);
  });
  it("keeps preview [1] and both list queries [2] with five hundred candidates and many links", async () => {
    const candidates = await database.db
      .insert(users)
      .values(
        Array.from({ length: 510 }, (_, index) => ({
          name: `후보${String(index).padStart(3, "0")}`,
          email: `${index}@candidates.example.test`,
        })),
      )
      .returning({ id: users.id });
    await database.db
      .insert(teamMembers)
      .values(
        candidates.map(({ id }) => ({ teamId: actors.teamId, userId: id })),
      );
    await database.db.insert(chatSpaceInvites).values(
      Array.from({ length: 30 }, (_, index) => ({
        spaceId: actors.communityId,
        createdBy: actors.admin.userId,
        code: String(index).padStart(22, "A"),
        createdAt: chatNow,
      })),
    );
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      expect(
        await queries().getInviteCandidates(actors.communityId),
      ).toHaveLength(500);
      expect(meter.stop().perStage).toEqual([2]);
      meter.start();
      expect(await queries().getSpaceInvites(actors.communityId)).toHaveLength(
        30,
      );
      expect(meter.stop().perStage).toEqual([2]);
      meter.start();
      expect(
        await queries(actors.outsider).getInvitePreview("A".repeat(21) + "0"),
      ).toMatchObject({ state: "open" });
      expect(meter.stop().perStage).toEqual([1]);
    } finally {
      meter.restore();
    }
  });
  it("blocks joining a full community and leaves its last use intact", async () => {
    const invite = await invitation({ maxUses: 1 });
    const extra = await database.db
      .insert(users)
      .values(
        Array.from({ length: 197 }, (_, index) => ({
          name: "기존 회원",
          email: `${index}@capacity.example.test`,
        })),
      )
      .returning({ id: users.id });
    await database.db
      .insert(chatSpaceMembers)
      .values(extra.map(({ id }) => member(actors.communityId, id)));
    expect(
      await actions(actors.outsider).joinSpaceByInvite({ code: invite.code }),
    ).toEqual({ ok: false, code: "LIMIT_EXCEEDED", message: "space_full" });
    expect(
      (await database.db.select().from(chatSpaceInvites))[0]?.useCount,
    ).toBe(0);
  });
  it("enforces the global one-hundred active-space participation cap", async () => {
    const invite = await invitation({ maxUses: 1 });
    const communities = await database.db
      .insert(chatSpaces)
      .values(
        Array.from({ length: 100 }, () => ({
          kind: "community" as const,
          name: "가입된 모임",
          createdBy: actors.admin.userId,
        })),
      )
      .returning({ id: chatSpaces.id });
    await database.db
      .insert(chatSpaceMembers)
      .values(communities.map(({ id }) => member(id, actors.outsider.userId)));
    expect(
      await actions(actors.outsider).joinSpaceByInvite({ code: invite.code }),
    ).toEqual({
      ok: false,
      code: "LIMIT_EXCEEDED",
      message: "space_join_count",
    });
    expect(
      (await database.db.select().from(chatSpaceInvites))[0]?.useCount,
    ).toBe(0);
  });
  it("counts the direct-invite batch against the daily fifty-recipient boundary", async () => {
    const [target] = await database.db
      .insert(users)
      .values({ name: "팀원", email: "direct-limit@example.test" })
      .returning();
    await database.db
      .insert(teamMembers)
      .values({ teamId: actors.teamId, userId: target!.id });
    await database.db.insert(chatSpaceInvites).values(
      Array.from({ length: 49 }, (_, index) => ({
        spaceId: actors.communityId,
        createdBy: actors.admin.userId,
        targetUserId: actors.member.userId,
        code: String(index).padStart(22, "A"),
        createdAt: chatNow,
      })),
    );
    expect(
      await actions().inviteToSpace({
        spaceId: actors.communityId,
        userIds: [target!.id],
      }),
    ).toEqual({ ok: true, data: { sent: 1 } });
    await database.db.execute(
      sql`update notifications set read_at = ${chatNow.toISOString()}::timestamptz`,
    );
    expect(
      await actions().inviteToSpace({
        spaceId: actors.communityId,
        userIds: [target!.id],
      }),
    ).toEqual({ ok: false, code: "LIMIT_EXCEEDED", message: "invite_count" });
    expect(await database.db.select().from(chatSpaceInvites)).toHaveLength(50);
  });
});

import { eq, sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createSpaceMemberQueries } from "@/features/chat/space-members-queries";
import * as memberDal from "@/lib/dal/chat-space-members";
import { canReadSpace } from "@/lib/dal/chat-access";
import {
  branchStaff,
  branches,
  chatSpaceMembers,
  chatSpaces,
  roleSettings,
  teamMembers,
  users,
} from "@/lib/db/schema";
import { createTestDatabase, type TestDatabase } from "./helper";
import { chatNow, seedChatActors, type ChatActors } from "./chat-helper";
import { createQueryMeter } from "./query-meter";

describe("space members privacy and query budget", () => {
  let database: TestDatabase;
  let actors: ChatActors;
  let communityId: string;
  let branchId: string;
  let loungeId: string;
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
    const [branch] = await database.db
      .insert(branches)
      .values({ name: "가상 라운지 지점" })
      .returning();
    branchId = branch!.id;
    const [community, lounge] = await database.db
      .insert(chatSpaces)
      .values([
        {
          kind: "community",
          name: "가상 커뮤니티",
          iconColor: "green",
          createdBy: actors.admin.userId,
        },
        { kind: "branch", branchId },
      ])
      .returning();
    communityId = community!.id;
    loungeId = lounge!.id;
    await database.db
      .insert(branchStaff)
      .values({ branchId, userId: actors.operator.userId });
    await database.db.insert(chatSpaceMembers).values(
      [
        {
          spaceId: communityId,
          userId: actors.admin.userId,
          role: "owner" as const,
        },
        {
          spaceId: communityId,
          userId: actors.member.userId,
          role: "member" as const,
        },
        {
          spaceId: communityId,
          userId: actors.operator.userId,
          role: "admin" as const,
        },
        {
          spaceId: communityId,
          userId: actors.outsider.userId,
          role: "member" as const,
          status: "banned" as const,
        },
        ...[actors.admin, actors.member, actors.operator, actors.outsider].map(
          (user) => ({ spaceId: loungeId, userId: user.userId }),
        ),
      ].map((value) => ({
        ...value,
        joinedAt: chatNow,
        statusChangedAt: chatNow,
      })),
    );
  });
  const queries = (session = actors.member) =>
    createSpaceMemberQueries({
      database: database.db,
      requireSession: async () => session,
    });
  it("orders team members without adding another query and emits only the public fields", async () => {
    const query = vi.spyOn(database.client, "query");
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      const result = await queries().getSpaceMembers(actors.spaceId);
      expect(query.mock.calls.at(-1)?.[0]).toContain('"chat_spaces".team_id');
      expect(meter.stop()).toEqual({ stages: 1, statements: 1, perStage: [1] });
      expect(result).toMatchObject({
        view: "full",
        memberCount: 2,
        space: {
          id: actors.spaceId,
          name: "가상 채팅팀",
          kind: "team",
          role: "member",
          iconColor: "blue",
        },
      });
      if (result?.view !== "full") throw new Error("Expected full members");
      expect(
        result.members.map(({ userId, role }) => ({ userId, role })),
      ).toEqual([
        { userId: actors.admin.userId, role: "admin" },
        { userId: actors.member.userId, role: "member" },
      ]);
      expect(result.banned).toEqual([]);
      expect(Object.keys(result.members[0]!).sort()).toEqual(
        ["userId", "name", "username", "role", "sharesSpace"].sort(),
      );
      expect(JSON.stringify(result)).not.toMatch(
        /@|joinedAt|statusChangedAt|roleSettings/,
      );
    } finally {
      meter.restore();
    }
  });
  it("shows banned members only to community admins and orders owner before admin before member", async () => {
    for (const session of [actors.admin, actors.operator]) {
      const meter = createQueryMeter(database.client);
      try {
        meter.start();
        const result = await queries(session).getSpaceMembers(communityId);
        expect(meter.stop()).toEqual({
          stages: 1,
          statements: 1,
          perStage: [1],
        });
        if (result?.view !== "full") throw new Error("Expected full members");
        expect(result.memberCount).toBe(3);
        expect(result.members.map((member) => member.role)).toEqual([
          "owner",
          "admin",
          "member",
        ]);
        expect(result.banned.map((member) => member.userId)).toEqual([
          actors.outsider.userId,
        ]);
      } finally {
        meter.restore();
      }
    }
    const result = await queries().getSpaceMembers(communityId);
    expect(JSON.stringify(result)).not.toContain(actors.outsider.userId);
    expect(JSON.stringify(result)).not.toContain(actors.outsider.name);
    if (result?.view !== "full") throw new Error("Expected full members");
    expect(result.banned).toEqual([]);
  });
  it("does not borrow an admin role or settings from another team or branch in single-table projections", async () => {
    await database.db
      .insert(teamMembers)
      .values({
        teamId: actors.otherTeamId,
        userId: actors.member.userId,
        role: "admin",
      });
    expect(
      (await canReadSpace(actors.member.userId, actors.spaceId, database.db))
        ?.role,
    ).toBe("member");
    expect(
      (
        await canReadSpace(
          actors.member.userId,
          actors.otherSpace.spaceId,
          database.db,
        )
      )?.role,
    ).toBe("admin");
    const [other] = await database.db
      .insert(branches)
      .values({ name: "다른 가상 지점" })
      .returning();
    await database.db
      .insert(branchStaff)
      .values({ branchId: other!.id, userId: actors.member.userId });
    await database.db
      .insert(roleSettings)
      .values({
        branchId: other!.id,
        role: "user",
        permissions: ["branch.announce"],
      });
    expect(
      (await canReadSpace(actors.member.userId, loungeId, database.db))?.role,
    ).toBe("member");
    const result = await queries().getSpaceMembers(loungeId);
    expect(result?.view).toBe("limited");
    expect(JSON.stringify(result)).not.toContain(actors.outsider.userId);
  });
  it("returns only count and admins to a lounge member without reading ordinary names", async () => {
    const initial = vi.spyOn(memberDal, "readSpaceMembers");
    const people = vi.spyOn(memberDal, "readLoungeMembers");
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      const result = await queries().getSpaceMembers(loungeId);
      expect(meter.stop()).toEqual({
        stages: 2,
        statements: 2,
        perStage: [1, 1],
      });
      expect(result?.view).toBe("limited");
      expect(result?.memberCount).toBe(4);
      if (result?.view !== "limited")
        throw new Error("Expected limited members");
      expect(Object.keys(result).sort()).toEqual(
        ["space", "memberCount", "view", "admins"].sort(),
      );
      expect(result.admins.map((member) => member.userId)).toEqual([
        actors.operator.userId,
      ]);
      expect((await initial.mock.results[0]!.value)?.people).toBeNull();
      expect(JSON.stringify(await people.mock.results[0]!.value)).not.toContain(
        actors.outsider.name,
      );
      expect(JSON.stringify(result)).not.toContain(actors.outsider.userId);
    } finally {
      meter.restore();
    }
  });
  it("lets joined lounge admins see everyone but does not imply presence from lounge membership", async () => {
    const result = await queries(actors.operator).getSpaceMembers(loungeId);
    if (result?.view !== "full") throw new Error("Expected full members");
    expect(result.members).toHaveLength(4);
    expect(result.members[0]?.userId).toBe(actors.operator.userId);
    expect(
      result.members.find((member) => member.userId === actors.member.userId)
        ?.sharesSpace,
    ).toBe(true);
    expect(
      result.members.find((member) => member.userId === actors.outsider.userId)
        ?.sharesSpace,
    ).toBe(false);
    expect(result.banned).toEqual([]);
  });
  it("uses can-based role settings for both the reader and the visible admin list", async () => {
    await database.db
      .insert(roleSettings)
      .values({ branchId, role: "operator", permissions: [] });
    const limited = await queries(actors.operator).getSpaceMembers(loungeId);
    expect(limited).toMatchObject({ view: "limited", admins: [] });
    await database.db
      .insert(roleSettings)
      .values({ branchId, role: "user", permissions: ["branch.announce"] });
    const full = await queries().getSpaceMembers(loungeId);
    if (full?.view !== "full") throw new Error("Expected full members");
    expect(full.members.every((member) => member.role === "admin")).toBe(true);
  });
  it("returns null for foreign, banned and deleted spaces without consulting the roster", async () => {
    const people = vi.spyOn(memberDal, "readLoungeMembers");
    expect(
      await queries(actors.outsider).getSpaceMembers(communityId),
    ).toBeNull();
    expect(
      await queries().getSpaceMembers(actors.otherSpace.spaceId),
    ).toBeNull();
    await database.db
      .delete(chatSpaceMembers)
      .where(eq(chatSpaceMembers.spaceId, loungeId));
    expect(await queries(actors.operator).getSpaceMembers(loungeId)).toBeNull();
    await database.db
      .update(chatSpaces)
      .set({ deletedAt: chatNow })
      .where(eq(chatSpaces.id, communityId));
    expect(await queries(actors.admin).getSpaceMembers(communityId)).toBeNull();
    expect(people).not.toHaveBeenCalled();
  });
  it("fails closed if lounge access settings change between metadata and roster reads", async () => {
    const original = memberDal.readLoungeMembers;
    vi.spyOn(memberDal, "readLoungeMembers").mockImplementationOnce(
      async (...args) => {
        await database.db
          .insert(roleSettings)
          .values({ branchId, role: "operator", permissions: [] });
        return original(...args);
      },
    );
    expect(await queries(actors.operator).getSpaceMembers(loungeId)).toBeNull();
  });
  it("independently checks the session and rejects malformed IDs before DAL", async () => {
    const read = vi.spyOn(memberDal, "readSpaceMembers");
    expect(await queries().getSpaceMembers("invalid")).toBeNull();
    expect(read).not.toHaveBeenCalled();
    const requireSession = vi
      .fn()
      .mockRejectedValue(new Error("session-required"));
    await expect(
      createSpaceMemberQueries({ requireSession }).getSpaceMembers(communityId),
    ).rejects.toThrow("session-required");
    expect(read).not.toHaveBeenCalled();
  });
  it("keeps the banned list available even when the active member list reaches its 200 row cap", async () => {
    const extra = await database.db
      .insert(users)
      .values(
        Array.from({ length: 198 }, (_, i) => ({
          name: `추가 멤버 ${String(i).padStart(3, "0")}`,
          email: `${i}@fake.test`,
        })),
      )
      .returning({ id: users.id });
    await database.db.insert(chatSpaceMembers).values(
      extra.map((user) => ({
        spaceId: communityId,
        userId: user.id,
        joinedAt: chatNow,
        statusChangedAt: chatNow,
      })),
    );
    const result = await queries(actors.admin).getSpaceMembers(communityId);
    if (result?.view !== "full") throw new Error("Expected full members");
    expect(result.members).toHaveLength(200);
    expect(result.memberCount).toBe(201);
    expect(result.banned.map((member) => member.userId)).toEqual([
      actors.outsider.userId,
    ]);
  });
});

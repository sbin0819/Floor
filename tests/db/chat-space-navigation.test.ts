import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createChatQueries } from "@/features/chat/query-factory";
import { createRealtimeToken } from "@/features/chat/realtime-token";
import { listRealtimeSpaces } from "@/lib/dal/chat-presence";
import {
  branchStaff,
  branches,
  chatRooms,
  chatSpaceMembers,
  chatSpaces,
  roleSettings,
} from "@/lib/db/schema";
import { createMemoryRateLimiter } from "@/lib/rate-limit/memory";
import { createTestDatabase, type TestDatabase } from "./helper";
import { chatNow, seedChatActors, type ChatActors } from "./chat-helper";
import { createQueryMeter } from "./query-meter";

describe("space navigation and token capabilities", () => {
  let database: TestDatabase;
  let actors: ChatActors;
  let branchId: string;
  let loungeId: string;
  let communityId: string;
  let loungeRoomId: string;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    await database.db.execute(sql`truncate users, branches cascade`);
    actors = await seedChatActors(database);
    const [branch] = await database.db
      .insert(branches)
      .values({ name: "A 가상 지점" })
      .returning();
    branchId = branch!.id;
    const [lounge, community] = await database.db
      .insert(chatSpaces)
      .values([
        { kind: "branch", branchId, iconColor: "orange" },
        {
          kind: "community",
          name: "A 가상 모임",
          iconColor: "teal",
          createdBy: actors.member.userId,
        },
      ])
      .returning();
    loungeId = lounge!.id;
    communityId = community!.id;
    await database.db.insert(chatSpaceMembers).values([
      {
        spaceId: loungeId,
        userId: actors.member.userId,
        joinedAt: chatNow,
        statusChangedAt: chatNow,
      },
      {
        spaceId: communityId,
        userId: actors.member.userId,
        role: "owner",
        joinedAt: chatNow,
        statusChangedAt: chatNow,
      },
    ]);
    const [room] = await database.db
      .insert(chatRooms)
      .values({ kind: "text", spaceId: loungeId, name: "라운지" })
      .returning();
    loungeRoomId = room!.id;
  });
  const queries = () =>
    createChatQueries({
      database: database.db,
      requireSession: async () => actors.member,
      now: () => chatNow,
    });
  const token = (rooms: string[] = []) =>
    createRealtimeToken({
      database: database.db,
      requireSession: async () => actors.member,
      getKey: () => "fake-only",
      limiter: createMemoryRateLimiter(),
      createTokenRequest: async (params) => ({
        keyName: "fake",
        nonce: "fake",
        mac: "fake",
        timestamp: chatNow.getTime(),
        capability: JSON.stringify(params.capability),
      }),
    })({ rooms });

  it("returns all joined kinds, roles and colors in fixed kind order within four SQL statements", async () => {
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      const nav = await queries().getMyChatNav();
      expect(meter.stop()).toEqual({ stages: 1, statements: 4, perStage: [4] });
      expect(
        nav.spaces.map(({ id, kind, role, iconColor }) => ({
          id,
          kind,
          role,
          iconColor,
        })),
      ).toEqual([
        { id: actors.spaceId, kind: "team", role: "member", iconColor: "blue" },
        { id: loungeId, kind: "branch", role: "member", iconColor: "orange" },
        {
          id: communityId,
          kind: "community",
          role: "owner",
          iconColor: "teal",
        },
      ]);
      expect(nav.spaces[1]?.name).toBe("A 가상 지점");
      expect(nav.spaces[2]?.channels).toEqual([]);
      expect(Object.keys(nav.spaces[0]!).sort()).toEqual(
        [
          "id",
          "kind",
          "iconColor",
          "role",
          "name",
          "initial",
          "unread",
          "muted",
          "unreadMentions",
          "channels",
          "voiceChannels",
        ].sort(),
      );
      expect(JSON.stringify(nav)).not.toMatch(
        /roleSettings|teamRole|memberRole|isStaff|@/,
      );
    } finally {
      meter.restore();
    }
  });
  it("derives lounge admin from the branch setting on the same navigation statement", async () => {
    await database.db
      .insert(branchStaff)
      .values({ branchId, userId: actors.member.userId });
    expect(
      (await queries().getMyChatNav()).spaces.find((s) => s.id === loungeId)
        ?.role,
    ).toBe("admin");
    await database.db
      .insert(roleSettings)
      .values({ branchId, role: "operator", permissions: [] });
    expect(
      (await queries().getMyChatNav()).spaces.find((s) => s.id === loungeId)
        ?.role,
    ).toBe("member");
    await database.db
      .insert(roleSettings)
      .values({ branchId, role: "user", permissions: ["branch.announce"] });
    expect(
      (await queries().getMyChatNav()).spaces.find((s) => s.id === loungeId)
        ?.role,
    ).toBe("admin");
  });
  it("grants lounge subscribe only, community presence, and readable room typing without publish or wildcard", async () => {
    expect(JSON.parse((await token([loungeRoomId])).capability)).toEqual({
      [`user:${actors.member.userId}`]: ["subscribe"],
      [`room:${loungeRoomId}`]: ["subscribe", "presence"],
      [`space:${actors.spaceId}`]: ["subscribe", "presence"],
      [`space:${loungeId}`]: ["subscribe"],
      [`space:${communityId}`]: ["subscribe", "presence"],
    });
    expect((await token()).capability).not.toMatch(/publish|\*/);
  });
  it("omits banned, left and deleted spaces from both nav and future tokens", async () => {
    await database.db
      .update(chatSpaceMembers)
      .set({ status: "banned" })
      .where(eq(chatSpaceMembers.spaceId, loungeId));
    await database.db
      .update(chatSpaces)
      .set({ deletedAt: chatNow })
      .where(eq(chatSpaces.id, communityId));
    expect((await queries().getMyChatNav()).spaces.map((s) => s.id)).toEqual([
      actors.spaceId,
    ]);
    expect(JSON.parse((await token([loungeRoomId])).capability)).toEqual({
      [`user:${actors.member.userId}`]: ["subscribe"],
      [`space:${actors.spaceId}`]: ["subscribe", "presence"],
    });
    await database.db
      .update(chatSpaceMembers)
      .set({ status: "active" })
      .where(eq(chatSpaceMembers.spaceId, loungeId));
    await database.db
      .delete(chatSpaceMembers)
      .where(eq(chatSpaceMembers.spaceId, loungeId));
    expect((await queries().getMyChatNav()).spaces.map((s) => s.id)).toEqual([
      actors.spaceId,
    ]);
  });
  it("keeps navigation SQL constant and grants only the first hundred spaces in the same order", async () => {
    const rows = await database.db
      .insert(chatSpaces)
      .values(
        Array.from({ length: 101 }, (_, i) => ({
          kind: "community" as const,
          name: `Z 모임 ${String(i).padStart(3, "0")}`,
          createdBy: actors.member.userId,
        })),
      )
      .returning();
    await database.db.insert(chatSpaceMembers).values(
      rows.map((space) => ({
        spaceId: space.id,
        userId: actors.member.userId,
        joinedAt: chatNow,
        statusChangedAt: chatNow,
      })),
    );
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      const nav = await queries().getMyChatNav();
      expect(meter.stop()).toEqual({ stages: 1, statements: 4, perStage: [4] });
      expect(nav.spaces).toHaveLength(104);
      const readable = await listRealtimeSpaces(
        actors.member.userId,
        database.db,
      );
      expect(readable.map((s) => s.id)).toEqual(
        nav.spaces.slice(0, 100).map((s) => s.id),
      );
      const granted = Object.keys(
        JSON.parse((await token()).capability),
      ).filter((key) => key.startsWith("space:"));
      expect(granted).toEqual(readable.map((s) => `space:${s.id}`));
    } finally {
      meter.restore();
    }
  });
});

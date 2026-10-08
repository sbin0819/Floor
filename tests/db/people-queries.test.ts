import { sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createPeopleQueries } from "@/features/people/query-factory";
import { canReadSpace } from "@/lib/dal/chat-access";
import { ActionError } from "@/lib/actions/result";
import { createMemoryRateLimiter } from "@/lib/rate-limit/memory";
import {
  chatRoomMembers,
  chatRooms,
  chatSpaces,
  friendships,
  teamMembers,
  teams,
  users,
} from "@/lib/db/schema";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

const id = (n: number) =>
  `72000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = new Date("2026-10-08T03:00:00Z");
const session = { userId: id(1), name: "김하은", email: "haeun@example.test" };
describe("people query privacy and budgets", () => {
  let database: TestDatabase;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    await database.db.execute(sql`truncate users, branches cascade`);
    await database.db.insert(users).values([
      {
        id: id(1),
        name: "김하은",
        email: session.email,
        emailVerified: true,
        username: "haeun.kim",
      },
      {
        id: id(2),
        name: "이서연",
        email: "Seoyeon@example.test",
        emailVerified: true,
        username: "seoyeon.lee",
      },
      {
        id: id(3),
        name: "박지훈",
        email: "jihoon@example.test",
        emailVerified: true,
        username: "jihoon.park",
      },
      {
        id: id(4),
        name: "최민준",
        email: "minjun@example.test",
        emailVerified: false,
        username: "minjun.choi",
      },
      {
        id: id(5),
        name: "도윤_%\\",
        email: "doyun@example.test",
        emailVerified: true,
        username: "doyun.kim",
      },
    ]);
    await database.db
      .insert(teams)
      .values({ id: id(101), name: "가상 팀", createdBy: id(1) });
    await database.db.insert(teamMembers).values(
      [1, 2, 5].map((n) => ({
        teamId: id(101),
        userId: id(n),
        role: "member" as const,
      })),
    );
    await database.db
      .insert(chatSpaces)
      .values({ id: id(102), kind: "team", teamId: id(101) });
  });
  const queries = (
    overrides: Partial<Parameters<typeof createPeopleQueries>[0]> = {},
  ) =>
    createPeopleQueries({
      database: database.db,
      requireSession: async () => session,
      now: () => now,
      rateLimiter: createMemoryRateLimiter(() => now.getTime()),
      ...overrides,
    });
  const friend = (
    other: number,
    status: "accepted" | "pending" | "declined" | "cancelled",
    requester = 1,
    changed = now,
  ) =>
    database.db.insert(friendships).values({
      userLowId: id(1),
      userHighId: id(other),
      status,
      requestedBy: id(requester),
      requestedAt: now,
      statusChangedAt: changed,
    });
  async function direct(other: number, active = true, withMessage = false) {
    await database.db.insert(chatRooms).values({
      id: id(200 + other),
      kind: "dm",
      dmLowUserId: id(1),
      dmHighUserId: id(other),
      lastMessageAt: withMessage ? now : null,
    });
    await database.db.insert(chatRoomMembers).values(
      [1, other].map((n) => ({
        roomId: id(200 + other),
        userId: id(n),
        status: active ? ("active" as const) : ("left" as const),
        joinedAt: now,
        statusChangedAt: now,
      })),
    );
  }
  it.each([
    "JIHOON.PARK",
    "@JiHoon.Park",
    " jihoon.park ",
    "JIHOON@EXAMPLE.TEST",
  ])("finds unknown users only by exact identity: %s", async (q) => {
    const rows = await queries().searchPeople(q);
    expect(rows.map((row) => row.userId)).toEqual([id(3)]);
    expect(rows[0]).toEqual({
      userId: id(3),
      name: "박지훈",
      username: "jihoon.park",
      relation: "none",
      sharedTeamNames: [],
      directRoomId: null,
      canDirectMessage: false,
    });
    expect(JSON.stringify(rows)).not.toContain("@example.test");
  });
  it.each([
    "jihoon",
    "jihoon@",
    "박지",
    "최민준",
    "minjun.choi",
    "minjun@example.test",
    "haeun.kim",
    "이",
  ])(
    "does not leak partial strangers, unverified users, self, or one-letter team search: %s",
    async (q) => {
      expect(await queries().searchPeople(q)).toEqual([]);
    },
  );
  it("allows a two character team name match and treats SQL wildcards literally", async () => {
    expect(
      (await queries().searchPeople("서연")).map((row) => row.userId),
    ).toEqual([id(2)]);
    expect(
      (await queries().searchPeople("_%")).map((row) => row.userId),
    ).toEqual([id(5)]);
    expect(
      (await queries().searchPeople("%\\")).map((row) => row.userId),
    ).toEqual([id(5)]);
  });
  it("orders exact before partial matches and caps at eight without duplicate teams", async () => {
    await database.db.insert(users).values(
      Array.from({ length: 12 }, (_, n) => ({
        id: id(10 + n),
        name: `가상 검색 ${n}`,
        email: `find${n}@example.test`,
        emailVerified: true,
        username: `test.find${n}`,
      })),
    );
    await database.db.insert(teamMembers).values(
      Array.from({ length: 12 }, (_, n) => ({
        teamId: id(101),
        userId: id(10 + n),
        role: "member" as const,
      })),
    );
    expect(await queries().searchPeople("검색")).toHaveLength(8);
    const rows = await queries().searchPeople("test.find1");
    expect(rows[0]?.userId).toBe(id(11));
  });
  it.each([
    ["accepted", 1, "friend"],
    ["pending", 1, "outgoing"],
    ["pending", 3, "incoming"],
    ["declined", 1, "outgoing"],
    ["declined", 3, "none"],
    ["cancelled", 1, "none"],
  ] as const)(
    "projects %s/requester %i as %s without exposing the stored state",
    async (status, by, relation) => {
      await friend(3, status, by);
      const [row] = await queries().searchPeople("jihoon.park");
      expect(row?.relation).toBe(relation);
      expect(Object.keys(row!)).toEqual([
        "userId",
        "name",
        "username",
        "relation",
        "sharedTeamNames",
        "directRoomId",
        "canDirectMessage",
      ]);
    },
  );
  it("masks declined requests for exactly 30 days in search and sent list", async () => {
    await friend(
      3,
      "declined",
      1,
      new Date(now.getTime() - 30 * 86_400_000 + 1),
    );
    expect(
      (await queries().getFriendsView("sent")).rows.map((row) => row.userId),
    ).toEqual([id(3)]);
    await database.db
      .update(friendships)
      .set({ statusChangedAt: new Date(now.getTime() - 30 * 86_400_000) });
    expect((await queries().getFriendsView("sent")).rows).toEqual([]);
    expect((await queries().searchPeople("jihoon.park"))[0]?.relation).toBe(
      "none",
    );
  });
  it("returns safe profile data only for self, shared team, any relationship, or a direct peer", async () => {
    expect(await queries().getPersonProfile(id(1))).toMatchObject({
      isMe: true,
      relation: null,
      canDirectMessage: false,
    });
    expect(await queries().getPersonProfile(id(2))).toMatchObject({
      isMe: false,
      canDirectMessage: true,
      sharedSpaces: [{ id: id(102), name: "가상 팀" }],
    });
    await expect(queries().getPersonProfile(id(3))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await friend(3, "cancelled");
    expect(await queries().getPersonProfile(id(3))).toMatchObject({
      relation: "none",
      canDirectMessage: false,
    });
    await database.db.delete(friendships);
    await direct(3);
    expect(await queries().getPersonProfile(id(3))).toMatchObject({
      directRoomId: id(203),
      canDirectMessage: false,
    });
    await database.db.update(chatRooms).set({ lastMessageAt: now });
    const result = await queries().getPersonProfile(id(3));
    expect(result.canDirectMessage).toBe(true);
    expect(JSON.stringify(result)).not.toContain("@example.test");
  });
  it("requires active membership and a verified other user to open an existing DM", async () => {
    await direct(3, false, true);
    expect((await queries().getPersonProfile(id(3))).canDirectMessage).toBe(
      false,
    );
    await friend(4, "accepted");
    expect((await queries().getPersonProfile(id(4))).canDirectMessage).toBe(
      false,
    );
  });
  it("does not expose a deleted shared space while preserving same-team profile and DM access", async () => {
    await database.db.update(chatSpaces).set({ deletedAt: now });
    expect(await canReadSpace(session.userId, id(102), database.db)).toBeNull();
    const profile = await queries().getPersonProfile(id(2));
    expect(profile).toMatchObject({
      userId: id(2),
      canDirectMessage: true,
      sharedSpaces: [],
    });
    expect(JSON.stringify(profile)).not.toContain(id(102));
  });
  it("returns identical NOT_FOUND for unknown IDs and invalid UUIDs", async () => {
    for (const target of [id(90), "not-a-uuid", null])
      await expect(queries().getPersonProfile(target)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
  });
  it("checks session before validation and validates search before consuming its own rate budget", async () => {
    const consume = vi.fn(() => ({ allowed: true as const }));
    const denied = queries({
      requireSession: async () => {
        throw new ActionError("UNAUTHENTICATED");
      },
      rateLimiter: { consume },
    });
    await expect(denied.searchPeople("")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    await expect(denied.getPersonProfile("bad")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    for (const invalid of ["", " ", "x".repeat(255), null])
      await expect(
        queries({ rateLimiter: { consume } }).searchPeople(invalid),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(consume).not.toHaveBeenCalled();
    const limited = queries({ rateLimiter: { consume } });
    await limited.searchPeople("jihoon.park");
    await limited.getPersonProfile(id(1));
    expect(consume.mock.calls).toEqual([
      ["people-search:" + id(1), 30, 3_600_000],
      ["people-profile:" + id(1), 60, 60_000],
    ]);
  });
  it("limits exact searches to 30 per hour and profiles to 60 per minute separately", async () => {
    const q = queries();
    for (let i = 0; i < 30; i++) await q.searchPeople("jihoon.park");
    await expect(q.searchPeople("jihoon.park")).rejects.toMatchObject({
      retryAfter: 3600,
    });
    for (let i = 0; i < 60; i++) await q.getPersonProfile(id(1));
    await expect(q.getPersonProfile(id(1))).rejects.toMatchObject({
      retryAfter: 60,
    });
  });
  it("returns tabs, received count, settings and contacts with no emails", async () => {
    await friend(2, "accepted");
    await friend(3, "pending", 3);
    const all = await queries().getFriendsView("wrong");
    expect(all).toMatchObject({
      receivedCount: 1,
      settings: { username: "haeun.kim", suggestion: null },
      rows: [{ userId: id(2), sharedTeamNames: ["가상 팀"] }],
    });
    expect(
      (await queries().getFriendsView("received")).rows.map(
        (row) => row.userId,
      ),
    ).toEqual([id(3)]);
    const contacts = await queries().getMessageContacts();
    expect(contacts.map((row) => row.userId).sort()).toEqual([id(2), id(5)]);
    expect(contacts.find((row) => row.userId === id(2))?.isFriend).toBe(true);
    expect(contacts.find((row) => row.userId === id(5))?.isFriend).toBe(false);
    expect(JSON.stringify({ all, contacts })).not.toContain("@example.test");
  });
  it("keeps search/profile/friends/contacts at one stage and fixed statement counts after 20 friends and DMs", async () => {
    const meter = createQueryMeter(database.client);
    const measure = async () => {
      const q = queries();
      const counts = [];
      for (const read of [
        () => q.searchPeople("서연"),
        () => q.getPersonProfile(id(2)),
        () => q.getFriendsView("all"),
        () => q.getMessageContacts(),
      ]) {
        meter.start();
        await read();
        counts.push(meter.stop());
      }
      return counts;
    };
    try {
      const before = await measure();
      for (let n = 10; n < 30; n++) {
        await database.db.insert(users).values({
          id: id(n),
          name: `가상${n}`,
          email: `extra${n}@example.test`,
          emailVerified: true,
        });
        await friend(n, "accepted");
        await direct(n, true, true);
      }
      expect(await measure()).toEqual(before);
      expect(before.map((m) => m.perStage)).toEqual([[1], [1], [3], [1]]);
    } finally {
      meter.restore();
    }
  });
});

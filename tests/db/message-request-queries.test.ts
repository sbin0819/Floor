import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPeopleQueries } from "@/features/people/query-factory";
import { friendsTab } from "@/features/people/schema";
import { ActionError } from "@/lib/actions/result";
import { chatRoomMembers, chatRooms, messages, users } from "@/lib/db/schema";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

const id = (n: number) =>
  `74000000-0000-4000-9000-${String(n).padStart(12, "0")}`;
const now = new Date("2026-10-08T03:00:00Z");
const me = { userId: id(1), name: "김하은", email: "haeun@example.test" };
describe("private message-request list and count", () => {
  let database: TestDatabase;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    await database.db.execute(sql`truncate users, branches cascade`);
    await database.db
      .insert(users)
      .values({
        id: me.userId,
        name: me.name,
        email: me.email,
        emailVerified: true,
      });
  });
  const queries = () =>
    createPeopleQueries({
      database: database.db,
      requireSession: async () => me,
      now: () => now,
    });
  async function request(
    n: number,
    status: "active" | "requested" | "declined" | "left" = "requested",
    kind: "dm" | "group_dm" = "dm",
    hasMessage = true,
  ) {
    const userId = id(n + 10);
    const roomId = id(n + 1000);
    const at = new Date(now.getTime() + n * 60_000);
    await database.db
      .insert(users)
      .values({
        id: userId,
        name: `가상 사람 ${n}`,
        email: `private${n}@example.test`,
        emailVerified: true,
        username: `person.${n}`,
      });
    await database.db
      .insert(chatRooms)
      .values({
        id: roomId,
        kind,
        ...(kind === "dm"
          ? { dmLowUserId: me.userId, dmHighUserId: userId }
          : {}),
        lastSeq: hasMessage ? 1 : 0,
        lastMessageAt: hasMessage ? at : null,
      });
    await database.db.insert(chatRoomMembers).values([
      {
        roomId,
        userId: me.userId,
        status,
        requestedAt: at,
        joinedAt: at,
        statusChangedAt: at,
      },
      { roomId, userId, status: "active", joinedAt: at, statusChangedAt: at },
    ]);
    if (hasMessage)
      await database.db
        .insert(messages)
        .values({
          roomId,
          seq: 1,
          authorId: userId,
          body: `요청 ${n}`,
          createdAt: at,
        });
    return { roomId, userId, at };
  }
  it("returns only my requested one-to-one rooms with messages, newest first and exact safe fields", async () => {
    const first = await request(1);
    const second = await request(2);
    await request(3, "active");
    await request(4, "declined");
    await request(5, "left");
    await request(6, "requested", "group_dm");
    await request(7, "requested", "dm", false);
    const rows = await queries().getMessageRequests();
    expect(rows).toEqual(
      [second, first].map(({ roomId, userId, at }, index) => ({
        roomId,
        other: {
          userId,
          name: `가상 사람 ${2 - index}`,
          username: `person.${2 - index}`,
        },
        excerpt: `요청 ${2 - index}`,
        lastMessageAt: at.toISOString(),
      })),
    );
    expect(JSON.stringify(rows)).not.toContain("@example.test");
    expect(rows[0]).not.toHaveProperty("body");
    expect(rows[0]).not.toHaveProperty("status");
    expect(await queries().getFriendsView("requests")).toMatchObject({
      rows: [],
      messageRequestCount: 2,
    });
  });
  it("caps the list at fifty without capping the tab count and orders timestamp ties by room id", async () => {
    const requests = [];
    for (let n = 1; n <= 55; n++) requests.push(await request(n));
    const rows = await queries().getMessageRequests();
    expect(rows).toHaveLength(50);
    expect(rows.map(({ roomId }) => roomId)).toEqual(
      requests
        .slice(5)
        .reverse()
        .map(({ roomId }) => roomId),
    );
    expect((await queries().getFriendsView("all")).messageRequestCount).toBe(
      55,
    );
    await database.db.update(chatRooms).set({ lastMessageAt: now });
    expect(
      (await queries().getMessageRequests()).map(({ roomId }) => roomId),
    ).toEqual(requests.slice(0, 50).map(({ roomId }) => roomId));
  });
  it("uses the actual latest message, sanitizes its excerpt and never exposes stored mention ids", async () => {
    const row = await request(1);
    await database.db
      .insert(messages)
      .values({
        roomId: row.roomId,
        seq: 2,
        authorId: row.userId,
        body: `<@${me.userId}> 안녕하세요 ${"😀".repeat(100)}`,
        createdAt: now,
      });
    await database.db
      .update(chatRooms)
      .set({ lastSeq: 2 })
      .where(eq(chatRooms.id, row.roomId));
    const [read] = await queries().getMessageRequests();
    expect(read!.excerpt).toContain("@김하은 안녕하세요");
    expect([...read!.excerpt]).toHaveLength(80);
    expect(read!.excerpt).not.toContain(me.userId);
  });
  it("does not resurrect a deleted message body in the request excerpt", async () => {
    const row = await request(1);
    await database.db
      .update(messages)
      .set({ body: "", deletedAt: now })
      .where(eq(messages.roomId, row.roomId));
    expect((await queries().getMessageRequests())[0]!.excerpt).toBe(
      "삭제된 메시지예요",
    );
  });
  it("does not include another recipient's requests or expose their count", async () => {
    const row = await request(1);
    const otherQueries = createPeopleQueries({
      database: database.db,
      requireSession: async () => ({
        userId: row.userId,
        name: "가상 사람",
        email: "private1@example.test",
      }),
      now: () => now,
    });
    expect(await otherQueries.getMessageRequests()).toEqual([]);
    expect((await otherQueries.getFriendsView("all")).messageRequestCount).toBe(
      0,
    );
  });
  it("returns an empty list and zero count without interpreting any other tab as requests", async () => {
    expect(await queries().getMessageRequests()).toEqual([]);
    expect(await queries().getFriendsView("requests")).toMatchObject({
      messageRequestCount: 0,
      rows: [],
    });
    expect(friendsTab("requests")).toBe("requests");
    expect(friendsTab("unknown")).toBe("all");
  });
  it("uses one statement for requests and keeps the existing friends budget as rows grow", async () => {
    const meter = createQueryMeter(database.client);
    const measure = async () => {
      meter.start();
      await queries().getMessageRequests();
      const list = meter.stop();
      meter.start();
      await queries().getFriendsView("requests");
      return { list, friends: meter.stop() };
    };
    try {
      const empty = await measure();
      for (let n = 1; n <= 10; n++) await request(n);
      expect(await measure()).toEqual(empty);
      expect(empty.list).toEqual({ stages: 1, statements: 1, perStage: [1] });
      expect(empty.friends).toEqual({
        stages: 1,
        statements: 3,
        perStage: [3],
      });
    } finally {
      meter.restore();
    }
  });
  it("checks the session before either list or metadata accesses the database", async () => {
    const denied = createPeopleQueries({
      database: database.db,
      requireSession: async () => {
        throw new ActionError("UNAUTHENTICATED");
      },
    });
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      await expect(denied.getMessageRequests()).rejects.toMatchObject({
        code: "UNAUTHENTICATED",
      });
      await expect(denied.getFriendsView("requests")).rejects.toMatchObject({
        code: "UNAUTHENTICATED",
      });
      expect(meter.stop().statements).toBe(0);
    } finally {
      meter.restore();
    }
  });
});

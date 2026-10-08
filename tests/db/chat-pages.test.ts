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
import {
  createChatQueries,
  type ChatQueryDependencies,
} from "@/features/chat/query-factory";
import { emptyMessageDetails } from "@/features/chat/types";
import { ActionError } from "@/lib/actions/result";
import { avatarColorFor } from "@/lib/avatar";
import * as accessDal from "@/lib/dal/chat-access";
import * as readDal from "@/lib/dal/chat-read";
import {
  chatRoomReads,
  chatRooms,
  chatSpaces,
  messages,
  teamMembers,
} from "@/lib/db/schema";
import {
  createMemoryRateLimiter,
  RateLimitError,
} from "@/lib/rate-limit/memory";
import { createTestDatabase, type TestDatabase } from "./helper";
import { chatNow, seedChatActors, type ChatActors } from "./chat-helper";
import { createQueryMeter } from "./query-meter";

describe("authenticated chat message pages", () => {
  let database: TestDatabase;
  let actors: ChatActors;
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
  });
  const queries = (
    session = actors.member,
    extra: ChatQueryDependencies = {},
  ) =>
    createChatQueries({
      database: database.db,
      requireSession: async () => session,
      limiter: createMemoryRateLimiter(() => chatNow.getTime()),
      ...extra,
    });
  async function fill(count: number) {
    await database.db.insert(messages).values(
      Array.from({ length: count }, (_, index) => ({
        roomId: actors.roomId,
        authorId: index === 0 ? actors.member.userId : actors.admin.userId,
        seq: index + 1,
        body: `가상 메시지 ${index + 1}`,
        clientId: `client-${index + 1}`,
        createdAt: chatNow,
      })),
    );
    await database.db
      .update(chatRooms)
      .set({ lastSeq: count, lastMessageAt: chatNow })
      .where(eq(chatRooms.id, actors.roomId));
  }
  it("returns the nearest fifty messages before an exclusive boundary in ascending order", async () => {
    await fill(60);
    const page = await queries().getRoomMessagesPage(actors.roomId, {
      before: "61",
    });
    expect(page.messages.map(({ seq }) => seq)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 11),
    );
    expect(page).toMatchObject({
      hasMore: true,
      lastSeq: 60,
      lastReadSeq: null,
      firstUnreadSeq: 2,
    });
    const first = await queries().getRoomMessagesPage(actors.roomId, {
      before: "11",
    });
    expect(first.messages.map(({ seq }) => seq)).toEqual(
      Array.from({ length: 10 }, (_, i) => i + 1),
    );
    expect(first.hasMore).toBe(false);
    expect(first.messages[0]).toEqual({
      ...emptyMessageDetails(),
      id: expect.any(String),
      seq: 1,
      authorId: actors.member.userId,
      authorName: actors.member.name,
      authorAvatar: {
        color: avatarColorFor(actors.member.userId, null),
        photoUrl: null,
      },
      kind: "text",
      body: "가상 메시지 1",
      createdAt: chatNow.toISOString(),
      clientId: "client-1",
    });
    expect(first.messages[0]!.clientId).toBe("client-1");
    expect(
      first.messages.slice(1).every(({ clientId }) => clientId === null),
    ).toBe(true);
    expect(JSON.stringify(first)).not.toContain("@");
  });
  it("does not claim more history at the exact fifty-message boundary", async () => {
    await fill(50);
    expect(
      await queries().getRoomMessagesPage(actors.roomId, { before: "51" }),
    ).toMatchObject({ hasMore: false });
    expect(
      await queries().getRoomMessagesPage(actors.roomId, { before: "0" }),
    ).toMatchObject({ messages: [], hasMore: false });
  });
  it("caps forward repair at two hundred and reports a remaining tail", async () => {
    await fill(202);
    const page = await queries().getRoomMessagesPage(actors.roomId, {
      after: "0",
    });
    expect(page.messages.map(({ seq }) => seq)).toEqual(
      Array.from({ length: 200 }, (_, i) => i + 1),
    );
    expect(page.hasMore).toBe(true);
    expect(
      await queries().getRoomMessagesPage(actors.roomId, { after: "2" }),
    ).toMatchObject({ hasMore: false });
    const tail = await queries().getRoomMessagesPage(actors.roomId, {
      after: "200",
    });
    expect(tail.messages.map(({ seq }) => seq)).toEqual([201, 202]);
    expect(tail.hasMore).toBe(false);
    expect(
      await queries().getRoomMessagesPage(actors.roomId, {
        after: String(Number.MAX_SAFE_INTEGER),
      }),
    ).toMatchObject({ messages: [], hasMore: false });
  });
  it("shares the joined-at and read-cursor start with the initial channel view", async () => {
    await fill(3);
    await database.db.insert(chatRoomReads).values({
      roomId: actors.roomId,
      userId: actors.member.userId,
      lastReadSeq: 2,
      updatedAt: chatNow,
    });
    expect(
      await queries().getRoomMessagesPage(actors.roomId, { after: "0" }),
    ).toMatchObject({ lastReadSeq: 2, firstUnreadSeq: 3 });
    await database.db
      .update(teamMembers)
      .set({ createdAt: chatNow })
      .where(eq(teamMembers.userId, actors.member.userId));
    expect(
      await queries().getRoomMessagesPage(actors.roomId, { after: "0" }),
    ).toMatchObject({ lastReadSeq: 2, firstUnreadSeq: null });
  });
  it.each([
    {},
    { before: "1", after: "1" },
    { after: "" },
    { after: "NaN" },
    { before: "-1" },
    { before: "1.5" },
    { after: "Infinity" },
    { before: "9007199254740992" },
    { after: "1e2" },
    { after: 1 },
    { after: "1", extra: true },
    { before: ["1", "2"] },
  ])("rejects invalid cursors before rate limiting or DAL", async (query) => {
    const limiter = { consume: vi.fn(() => ({ allowed: true as const })) };
    const access = vi.spyOn(accessDal, "canReadRoom");
    const read = vi.spyOn(readDal, "listMessagesPage");
    await expect(
      queries(actors.member, { limiter }).getRoomMessagesPage(
        actors.roomId,
        query,
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(limiter.consume).not.toHaveBeenCalled();
    expect(access).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });
  it("handles URLSearchParams without silently accepting repeated cursors", async () => {
    expect(
      await queries().getRoomMessagesPage(
        actors.roomId,
        new URLSearchParams("after=0"),
      ),
    ).toMatchObject({ messages: [] });
    await expect(
      queries().getRoomMessagesPage(
        actors.roomId,
        new URLSearchParams("after=0&after=1"),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  it("checks session before malformed query and never reaches the limiter or DAL", async () => {
    const limiter = { consume: vi.fn(() => ({ allowed: true as const })) };
    const access = vi.spyOn(accessDal, "canReadRoom");
    const read = vi.spyOn(readDal, "listMessagesPage");
    await expect(
      queries(actors.member, {
        limiter,
        requireSession: async () => {
          throw new ActionError("UNAUTHENTICATED");
        },
      }).getRoomMessagesPage("not-id", {}),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(limiter.consume).not.toHaveBeenCalled();
    expect(access).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });
  it("limits all rooms per user before checking room existence and returns Retry-After", async () => {
    let now = chatNow.getTime();
    const limiter = createMemoryRateLimiter(() => now);
    const api = queries(actors.member, { limiter });
    for (let index = 0; index < 60; index++)
      await expect(
        api.getRoomMessagesPage("invalid", { after: "0" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      api.getRoomMessagesPage(actors.roomId, { after: "0" }),
    ).rejects.toEqual(new RateLimitError(60));
    expect(
      await queries(actors.admin, { limiter }).getRoomMessagesPage(
        actors.roomId,
        { after: "0" },
      ),
    ).toMatchObject({ messages: [] });
    now += 60_000;
    expect(
      await api.getRoomMessagesPage(actors.roomId, { after: "0" }),
    ).toMatchObject({ messages: [] });
  });
  it("returns no private messages in the DAL even when paired access lookup will fail", async () => {
    await fill(3);
    for (const session of [actors.outsider, actors.operator]) {
      await expect(
        queries(session).getRoomMessagesPage(actors.roomId, { before: "4" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(
        await readDal.listMessagesPage(
          actors.roomId,
          session.userId,
          { before: 4 },
          database.db,
        ),
      ).toEqual({ messages: [], hasMore: false });
    }
    await database.db
      .update(chatRooms)
      .set({ archivedAt: chatNow })
      .where(eq(chatRooms.id, actors.roomId));
    expect(
      (await queries().getRoomMessagesPage(actors.roomId, { after: "0" }))
        .messages,
    ).toHaveLength(3);
    await database.db
      .update(chatSpaces)
      .set({ deletedAt: chatNow })
      .where(eq(chatSpaces.id, actors.spaceId));
    await expect(
      queries().getRoomMessagesPage(actors.roomId, { after: "0" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      await readDal.listMessagesPage(
        actors.roomId,
        actors.member.userId,
        { after: 0 },
        database.db,
      ),
    ).toEqual({ messages: [], hasMore: false });
  });
  it("executes access and independently authorized page queries in one stage", async () => {
    await fill(51);
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      await queries().getRoomMessagesPage(actors.roomId, { before: "52" });
      expect(meter.stop()).toEqual({ stages: 1, statements: 2, perStage: [2] });
    } finally {
      meter.restore();
    }
  });
});

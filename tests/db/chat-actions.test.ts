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
  createChatActions,
  type ChatActionDependencies,
} from "@/features/chat/action-factory";
import * as writeDal from "@/lib/dal/chat-write";
import { chatRooms, messages, teamMembers } from "@/lib/db/schema";
import { createMemoryRateLimiter } from "@/lib/rate-limit/memory";
import { createTestDatabase, type TestDatabase } from "./helper";
import { chatNow, seedChatActors, type ChatActors } from "./chat-helper";

describe("sendMessage transaction", () => {
  let database: TestDatabase;
  let actors: ChatActors;
  const publish = vi.fn();
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    publish.mockReset();
    await database.db.execute(sql`truncate users, branches cascade`);
    actors = await seedChatActors(database);
  });
  const actions = (
    session = actors.member,
    overrides: ChatActionDependencies = {},
  ) =>
    createChatActions({
      database: database.db,
      getSession: async () => session,
      now: () => chatNow,
      limiter: createMemoryRateLimiter(() => chatNow.getTime()),
      publisher: { publish },
      ...overrides,
    });
  const input = (body = " 안녕하세요\n반가워요 ") => ({
    roomId: actors.roomId,
    clientId: crypto.randomUUID(),
    body,
  });

  it("allocates increasing room sequence numbers and only publishes after persistence", async () => {
    const api = actions();
    for (const seq of [1, 2, 3]) {
      const result = await api.sendMessage(input());
      expect(result).toMatchObject({
        ok: true,
        data: {
          seq,
          body: "안녕하세요\n반가워요",
          createdAt: chatNow.toISOString(),
        },
      });
    }
    const [room] = await database.db
      .select()
      .from(chatRooms)
      .where(eq(chatRooms.id, actors.roomId));
    expect(room).toMatchObject({ lastSeq: 3, lastMessageAt: chatNow });
    expect(publish).toHaveBeenCalledTimes(3);
    expect(publish).toHaveBeenLastCalledWith(
      `room:${actors.roomId}`,
      expect.objectContaining({
        type: "message.created",
        seq: 3,
        authorName: actors.member.name,
      }),
    );
    expect(JSON.stringify(publish.mock.calls)).not.toContain("@");
  });

  it("deduplicates retries per room, preserves the first body, and rejects another author's client id", async () => {
    const request = input();
    const first = await actions().sendMessage(request);
    expect(await actions().sendMessage({ ...request, body: "변경" })).toEqual(
      first,
    );
    expect(publish).toHaveBeenCalledTimes(1);
    expect(await actions(actors.admin).sendMessage(request)).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect(
      await actions().sendMessage({ ...request, roomId: actors.secondRoomId }),
    ).toMatchObject({ ok: true, data: { seq: 1 } });
    expect(await database.db.select().from(messages)).toHaveLength(2);
  });

  it.each(["", "  \n ", "가".repeat(4001)])(
    "rejects invalid body size without writes",
    async (body) => {
      expect(await actions().sendMessage(input(body))).toMatchObject({
        ok: false,
        code: "INVALID_INPUT",
      });
      expect(await database.db.select().from(messages)).toHaveLength(0);
    },
  );
  it("counts emoji code points rather than UTF-16 units", async () => {
    expect(await actions().sendMessage(input("😀".repeat(4000)))).toMatchObject(
      { ok: true },
    );
    expect(await actions().sendMessage(input("😀".repeat(4001)))).toMatchObject(
      { ok: false, code: "INVALID_INPUT" },
    );
  });
  it("requires a session, hides unreadable rooms, and permits only admins in admin-only rooms", async () => {
    expect(
      await actions(actors.member, {
        getSession: async () => null,
      }).sendMessage(input()),
    ).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    for (const session of [actors.outsider, actors.operator])
      expect(await actions(session).sendMessage(input())).toEqual({
        ok: false,
        code: "NOT_FOUND",
      });
    await database.db
      .update(chatRooms)
      .set({ adminOnly: true })
      .where(eq(chatRooms.id, actors.roomId));
    expect(await actions().sendMessage(input())).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(await actions(actors.admin).sendMessage(input())).toMatchObject({
      ok: true,
    });
    await database.db
      .update(chatRooms)
      .set({ archivedAt: chatNow })
      .where(eq(chatRooms.id, actors.roomId));
    expect(await actions(actors.admin).sendMessage(input())).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
  });
  it("limits to ten messages per ten seconds and exposes only send_rate", async () => {
    let instant = chatNow.getTime();
    const api = actions(actors.member, {
      limiter: createMemoryRateLimiter(() => instant),
    });
    for (let index = 0; index < 10; index++)
      expect((await api.sendMessage(input())).ok).toBe(true);
    expect(await api.sendMessage(input())).toEqual({
      ok: false,
      code: "LIMIT_EXCEEDED",
      message: "send_rate",
    });
    expect(await database.db.select().from(messages)).toHaveLength(10);
    instant += 10_000;
    expect((await api.sendMessage(input())).ok).toBe(true);
  });
  it("locks the user before the room, and allocates after an intervening send", async () => {
    const order: string[] = [];
    const lockAuthor = writeDal.lockMessageAuthor;
    const lockRoom = writeDal.lockRoomForMessage;
    vi.spyOn(writeDal, "lockMessageAuthor").mockImplementation(
      async (...args) => {
        order.push("user");
        return lockAuthor(...args);
      },
    );
    vi.spyOn(writeDal, "lockRoomForMessage").mockImplementationOnce(
      async (...args) => {
        order.push("room");
        await writeDal.insertChatMessage(
          {
            roomId: actors.roomId,
            authorId: actors.admin.userId,
            clientId: crypto.randomUUID(),
            body: "먼저 보낸 글",
            now: chatNow,
          },
          args[1],
        );
        return lockRoom(...args);
      },
    );
    expect(await actions().sendMessage(input())).toMatchObject({
      ok: true,
      data: { seq: 2 },
    });
    expect(order).toEqual(["user", "room"]);
  });
  it.each(["membership", "archive"])(
    "rechecks %s under the room lock and rolls back rejected writes",
    async (kind) => {
      const original = writeDal.lockRoomForMessage;
      vi.spyOn(writeDal, "lockRoomForMessage").mockImplementationOnce(
        async (id, transaction) => {
          if (kind === "membership")
            await transaction
              .delete(teamMembers)
              .where(eq(teamMembers.userId, actors.member.userId));
          else
            await transaction
              .update(chatRooms)
              .set({ archivedAt: chatNow })
              .where(eq(chatRooms.id, id));
          return original(id, transaction);
        },
      );
      expect(await actions().sendMessage(input())).toEqual({
        ok: false,
        code: kind === "membership" ? "NOT_FOUND" : "FORBIDDEN",
      });
      expect(await database.db.select().from(messages)).toHaveLength(0);
      expect(publish).not.toHaveBeenCalled();
    },
  );
  it("keeps committed messages if publishing fails and never logs payloads or secrets", async () => {
    const logError = vi.fn();
    publish.mockRejectedValue(new Error("secret payload"));
    expect(
      (await actions(actors.member, { logError }).sendMessage(input())).ok,
    ).toBe(true);
    expect(await database.db.select().from(messages)).toHaveLength(1);
    expect(logError).toHaveBeenCalledExactlyOnceWith(
      "Chat realtime publication failed.",
    );
  });
  it("rolls back cursor updates on an insertion failure", async () => {
    const logError = vi.fn();
    const original = writeDal.insertChatMessage;
    vi.spyOn(writeDal, "insertChatMessage").mockImplementationOnce(
      async (...args) => {
        await original(...args);
        throw new Error("private SQL");
      },
    );
    expect(
      await actions(actors.member, { logError }).sendMessage(input()),
    ).toEqual({ ok: false, code: "INTERNAL" });
    const [room] = await database.db
      .select()
      .from(chatRooms)
      .where(eq(chatRooms.id, actors.roomId));
    expect(room!.lastSeq).toBe(0);
    expect(await database.db.select().from(messages)).toHaveLength(0);
    expect(publish).not.toHaveBeenCalled();
  });
});

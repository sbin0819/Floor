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
import {
  createChatActions,
  type ChatActionDependencies,
} from "@/features/chat/action-factory";
import { chatRoomReads, chatRooms, messages } from "@/lib/db/schema";
import * as readDal from "@/lib/dal/chat-reads";
import { createMemoryRateLimiter } from "@/lib/rate-limit/memory";
import { createTestDatabase, type TestDatabase } from "./helper";
import { chatNow, seedChatActors, type ChatActors } from "./chat-helper";

describe("chat read actions", () => {
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
    await database.db
      .update(chatRooms)
      .set({ lastSeq: 5 })
      .where(eq(chatRooms.id, actors.roomId));
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
      publisher: {
        publish,
        async publishMany(items) {
          await Promise.all(
            items.map(({ channel, event }) => publish(channel, event)),
          );
        },
      },
      ...overrides,
    });
  const input = (seq: unknown) => ({ roomId: actors.roomId, seq });
  const sendInput = () => ({
    roomId: actors.roomId,
    clientId: crypto.randomUUID(),
    body: "내용",
  });

  it("never reduces the read sequence and clamps it to the last stored room sequence", async () => {
    const api = actions();
    expect(await api.markRoomRead(input(5))).toEqual({
      ok: true,
      data: { lastReadSeq: 5 },
    });
    expect(await api.markRoomRead(input(3))).toEqual({
      ok: true,
      data: { lastReadSeq: 5 },
    });
    expect(await api.markRoomRead(input(Number.MAX_SAFE_INTEGER))).toEqual({
      ok: true,
      data: { lastReadSeq: 5 },
    });
    expect(await database.db.select().from(chatRoomReads)).toEqual([
      expect.objectContaining({
        roomId: actors.roomId,
        userId: actors.member.userId,
        lastReadSeq: 5,
      }),
    ]);
    expect(publish).not.toHaveBeenCalled();
  });
  it("accepts zero and returns the actual stored cursor for an empty room", async () => {
    expect(
      await actions().markRoomRead({ roomId: actors.secondRoomId, seq: 5 }),
    ).toEqual({ ok: true, data: { lastReadSeq: 0 } });
    expect(await actions().markRoomRead(input(0))).toEqual({
      ok: true,
      data: { lastReadSeq: 0 },
    });
  });
  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, "3", null])(
    "rejects invalid sequence %s without writes",
    async (seq) => {
      expect(await actions().markRoomRead(input(seq))).toMatchObject({
        ok: false,
        code: "INVALID_INPUT",
      });
      expect(await database.db.select().from(chatRoomReads)).toHaveLength(0);
    },
  );
  it("requires a session before input validation, and hides every unreadable room", async () => {
    expect(
      await actions(actors.member, {
        getSession: async () => null,
      }).markRoomRead(null),
    ).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    for (const session of [actors.outsider, actors.operator])
      expect(await actions(session).markRoomRead(input(2))).toEqual({
        ok: false,
        code: "NOT_FOUND",
      });
    expect(
      await actions().markRoomRead({ roomId: crypto.randomUUID(), seq: 2 }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await database.db.select().from(chatRoomReads)).toHaveLength(0);
  });
  it("allows readable archived/admin-only rooms without allowing a send", async () => {
    await database.db
      .update(chatRooms)
      .set({ archivedAt: chatNow, adminOnly: true })
      .where(eq(chatRooms.id, actors.roomId));
    expect(await actions().markRoomRead(input(2))).toEqual({
      ok: true,
      data: { lastReadSeq: 2 },
    });
    expect(await actions().sendMessage(sendInput())).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
  });
  it("locks the user then room in the same INSERT SELECT statement before the read row", async () => {
    const statements = vi.spyOn(database.client, "query");
    await actions().markRoomRead(input(3));
    const writes = statements.mock.calls
      .map(([statement]) => statement)
      .filter((statement) => /insert into "chat_room_reads"/i.test(statement));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(
      /locked_user as materialized[\s\S]*from users[\s\S]*for key share[\s\S]*locked_room as materialized[\s\S]*from chat_rooms r cross join locked_user[\s\S]*for key share of r[\s\S]*on conflict/i,
    );
    expect(writes[0]).toMatch(/least\(/i);
    expect(writes[0]).toMatch(/greatest\(/i);
  });
  it("keeps the greater cursor when two tab calls complete in either order", async () => {
    for (const sequence of [
      [5, 3],
      [3, 5],
    ]) {
      await database.db.delete(chatRoomReads);
      expect(
        (
          await Promise.all(
            sequence.map((seq) => actions().markRoomRead(input(seq))),
          )
        ).every((result) => result.ok),
      ).toBe(true);
      expect(await database.db.select().from(chatRoomReads)).toEqual([
        expect.objectContaining({ lastReadSeq: 5 }),
      ]);
    }
  });
  it("preserves preferences and creation time while advancing updatedAt", async () => {
    const initial = new Date(chatNow.getTime() - 1000);
    await database.db.insert(chatRoomReads).values({
      roomId: actors.roomId,
      userId: actors.member.userId,
      lastReadSeq: 1,
      muted: true,
      createdAt: initial,
      updatedAt: initial,
    });
    await actions().markRoomRead(input(3));
    expect(await database.db.select().from(chatRoomReads)).toEqual([
      expect.objectContaining({
        muted: true,
        createdAt: initial,
        updatedAt: chatNow,
        lastReadSeq: 3,
      }),
    ]);
  });
  it("advances the sender cursor in the transaction and does not republish a client-id retry", async () => {
    const request = sendInput();
    expect(await actions().sendMessage(request)).toMatchObject({
      ok: true,
      data: { seq: 6 },
    });
    expect(await database.db.select().from(chatRoomReads)).toEqual([
      expect.objectContaining({ userId: actors.member.userId, lastReadSeq: 6 }),
    ]);
    await database.db
      .delete(chatRoomReads)
      .where(
        and(
          eq(chatRoomReads.roomId, actors.roomId),
          eq(chatRoomReads.userId, actors.member.userId),
        ),
      );
    expect(await actions().sendMessage(request)).toMatchObject({
      ok: true,
      data: { seq: 6 },
    });
    expect(await database.db.select().from(chatRoomReads)).toEqual([
      expect.objectContaining({ lastReadSeq: 6 }),
    ]);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls.map(([, event]) => event.type)).toEqual([
      "message.created",
      "room.activity",
    ]);
  });
  it("rolls message and sequence allocation back when read persistence fails", async () => {
    const original = readDal.advanceRoomRead;
    vi.spyOn(readDal, "advanceRoomRead").mockImplementationOnce(
      async (...args) => {
        await original(...args);
        throw new Error("write failure");
      },
    );
    expect(
      await actions(actors.member, { logError: vi.fn() }).sendMessage(
        sendInput(),
      ),
    ).toEqual({ ok: false, code: "INTERNAL" });
    expect(await database.db.select().from(messages)).toHaveLength(0);
    expect(await database.db.select().from(chatRoomReads)).toHaveLength(0);
    expect(
      (
        await database.db
          .select()
          .from(chatRooms)
          .where(eq(chatRooms.id, actors.roomId))
      )[0]!.lastSeq,
    ).toBe(5);
    expect(publish).not.toHaveBeenCalled();
  });
});

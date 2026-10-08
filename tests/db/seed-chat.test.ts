import { eq, sql } from "drizzle-orm";
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
import chatFile from "@/docs/spec/examples/seed-chat.json";
import { createAuth, type AuthInstance } from "@/lib/auth/auth";
import * as seedDal from "@/lib/dal/seed";
import * as chatDal from "@/lib/dal/seed-chat";
import { createTeamSpace } from "@/lib/dal/chat-write";
import {
  branches,
  chatRooms,
  chatSpaces,
  messages,
  teams,
  users,
} from "@/lib/db/schema";
import { createMemoryEmailSender } from "@/lib/email/memory";
import * as chatLoader from "@/lib/seed/chat";
import * as bookingRound2 from "@/lib/seed/booking-round2";
import { loadSeedData } from "@/lib/seed/data";
import { SeedError } from "@/lib/seed/errors";
import { runSeed } from "@/lib/seed/run-seed";
import { createTestDatabase, type TestDatabase } from "./helper";

const now = new Date("2026-10-08T03:00:00Z");
const data = loadSeedData();

describe("transactional team chat seed", () => {
  let database: TestDatabase;
  let auth: AuthInstance;
  beforeAll(async () => {
    database = await createTestDatabase();
    auth = createAuth({
      db: database.db,
      email: createMemoryEmailSender(),
      secret: "chat-seed-tests-secret-with-at-least-32-bytes",
      baseUrl: "http://localhost:3000",
      rateLimit: { enabled: false },
    });
  });
  afterAll(async () => {
    await database?.client.close();
  });
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    await database.db.execute(
      sql`TRUNCATE users, branches, auth_verifications CASCADE`,
    );
  });
  const seed = () =>
    runSeed({ db: database.db, auth, now, resetPasswords: false });
  const state = async () => ({
    spaces: await database.db.select().from(chatSpaces).orderBy(chatSpaces.id),
    rooms: await database.db.select().from(chatRooms).orderBy(chatRooms.id),
    messages: await database.db
      .select()
      .from(messages)
      .orderBy(messages.roomId, messages.seq),
  });

  it("writes two general channels and eight sequenced messages, keeping channels and timestamps on rerun", async () => {
    expect((await seed()).counts).toMatchObject({
      chatSpaces: 2,
      chatMessages: 8,
    });
    const first = await state();
    expect(first.spaces).toHaveLength(2);
    expect(first.rooms).toHaveLength(2);
    expect(first.messages).toHaveLength(8);
    for (const team of data.teams) {
      const space = first.spaces.find(({ teamId }) => teamId === team.id)!;
      const room = first.rooms.find(({ spaceId }) => spaceId === space.id)!;
      const rows = first.messages.filter(({ roomId }) => roomId === room.id);
      const source = chatFile.messages.filter(
        ({ teamId }) => teamId === team.id,
      );
      expect(room).toMatchObject({
        kind: "text",
        name: "일반",
        lastSeq: source.length,
      });
      expect(rows.map(({ seq }) => seq)).toEqual(
        source.map((_, index) => index + 1),
      );
      expect(rows.map(({ body }) => body)).toEqual(
        source.map(({ body }) => body),
      );
      expect(rows.map(({ createdAt }) => createdAt)).toEqual(
        source.map(
          ({ minutesAgo }) => new Date(now.getTime() - minutesAgo * 60_000),
        ),
      );
      expect(room.lastMessageAt).toEqual(rows.at(-1)!.createdAt);
      expect(
        rows.every(
          ({ authorId, clientId, kind }) =>
            authorId !== null && clientId === null && kind === "text",
        ),
      ).toBe(true);
    }
    await seed();
    const second = await state();
    expect(second.spaces).toEqual(first.spaces);
    expect(second.rooms).toEqual(first.rooms);
    expect(
      second.messages.map((message) => ({ ...message, id: null })),
    ).toEqual(first.messages.map((message) => ({ ...message, id: null })));
  });

  it("resets all seed-space conversations but preserves other teams and their room cursors", async () => {
    await seed();
    const [author] = await database.db.select().from(users);
    const [foreignTeam] = await database.db
      .insert(teams)
      .values({ name: "시드 밖 팀", createdBy: author!.id })
      .returning();
    const foreign = await createTeamSpace(foreignTeam!.id, database.db);
    const [foreignMessage] = await database.db
      .insert(messages)
      .values({
        roomId: foreign.roomId,
        authorId: author!.id,
        seq: 9,
        body: "보존할 대화",
        createdAt: now,
      })
      .returning();
    await database.db
      .update(chatRooms)
      .set({ lastSeq: 9, lastMessageAt: now })
      .where(eq(chatRooms.id, foreign.roomId));
    const [seedSpace] = await database.db
      .select()
      .from(chatSpaces)
      .where(eq(chatSpaces.teamId, data.teams[0]!.id));
    const [extraRoom] = await database.db
      .insert(chatRooms)
      .values({
        kind: "text",
        name: "보관된 대화",
        spaceId: seedSpace!.id,
        lastSeq: 1,
        lastMessageAt: now,
        archivedAt: now,
      })
      .returning();
    await database.db.insert(messages).values({
      roomId: extraRoom!.id,
      authorId: author!.id,
      seq: 1,
      body: "시드에서 제거할 대화",
      createdAt: now,
    });
    const foreignBefore = (await state()).rooms.find(
      ({ id }) => id === foreign.roomId,
    );
    await seed();
    const after = await state();
    expect(
      after.messages.filter(({ roomId }) => roomId === foreign.roomId),
    ).toEqual([foreignMessage]);
    expect(after.rooms.find(({ id }) => id === foreign.roomId)).toEqual(
      foreignBefore,
    );
    expect(after.messages.some(({ roomId }) => roomId === extraRoom!.id)).toBe(
      false,
    );
    expect(after.rooms.find(({ id }) => id === extraRoom!.id)).toMatchObject({
      lastSeq: 0,
      lastMessageAt: null,
      archivedAt: now,
    });
    expect(after.messages).toHaveLength(9);
  });

  it("rolls chat replacement and other seed changes back together after a later failure", async () => {
    await seed();
    const first = await state();
    const room = first.rooms[0]!;
    await database.db.insert(messages).values({
      roomId: room.id,
      seq: room.lastSeq + 1,
      authorId: first.messages[0]!.authorId,
      body: "실패 뒤에도 남는 대화",
      createdAt: now,
    });
    await database.db
      .update(chatRooms)
      .set({ lastSeq: room.lastSeq + 1, lastMessageAt: now })
      .where(eq(chatRooms.id, room.id));
    await database.db
      .update(branches)
      .set({ name: "실패 뒤에도 남는 지점명" })
      .where(eq(branches.id, data.branches[0]!.id));
    const before = await state();
    vi.spyOn(seedDal, "insertSeedBooking").mockRejectedValueOnce(
      new Error("later seed failure"),
    );
    await expect(seed()).rejects.toBeInstanceOf(SeedError);
    expect(await state()).toEqual(before);
    expect(
      (
        await database.db
          .select()
          .from(branches)
          .where(eq(branches.id, data.branches[0]!.id))
      )[0]!.name,
    ).toBe("실패 뒤에도 남는 지점명");
  });

  it("validates chat references before entering a database transaction", async () => {
    const input = structuredClone(chatFile);
    input.messages[0]!.authorKey = "unknown-author";
    vi.spyOn(chatLoader, "loadSeedChat").mockImplementation(() =>
      chatLoader.parseSeedChat(input, data),
    );
    const transaction = vi.fn();
    await expect(
      runSeed({ db: { transaction }, auth, now, resetPasswords: false }),
    ).rejects.toBeInstanceOf(SeedError);
    expect(transaction).not.toHaveBeenCalled();
    expect(await database.db.select().from(users)).toEqual([]);
  });

  it("does not touch chat when a scoped branch run skips an already existing branch", async () => {
    await seed();
    const before = await state();
    const sync = vi.spyOn(chatDal, "syncSeedChat");
    await runSeed({
      db: database.db,
      auth,
      now: new Date("2026-10-09T03:00:00Z"),
      resetPasswords: false,
      branchIds: [data.branches.at(-1)!.id],
    });
    expect(sync).not.toHaveBeenCalled();
    expect(await state()).toEqual(before);
  });

  it("leaves empty channels with zero cursors when seed conversations are empty", async () => {
    await seed();
    vi.spyOn(chatLoader, "loadSeedChat").mockReturnValue({ messages: [] });
    expect((await seed()).counts).toMatchObject({
      chatSpaces: 2,
      chatMessages: 0,
    });
    const after = await state();
    expect(after.messages).toEqual([]);
    expect(
      after.rooms.every(
        ({ lastSeq, lastMessageAt }) => lastSeq === 0 && lastMessageAt === null,
      ),
    ).toBe(true);
  });

  it("does not synchronize chat in the booking round-two mode", async () => {
    await seed();
    const before = await state();
    const sync = vi.spyOn(chatDal, "syncSeedChat");
    const apply = vi
      .spyOn(bookingRound2, "applyBookingRound2")
      .mockResolvedValue({ counts: {}, skippedBookings: 0, accounts: [] });
    await runSeed({
      db: database.db,
      auth,
      now,
      resetPasswords: false,
      bookingRound2: { hostHash: "a".repeat(64), receipt: null },
    });
    expect(apply).toHaveBeenCalledOnce();
    expect(sync).not.toHaveBeenCalled();
    expect(await state()).toEqual(before);
  });
});

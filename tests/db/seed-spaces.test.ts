import { and, asc, eq, inArray, sql } from "drizzle-orm";
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
import { drizzle } from "drizzle-orm/pglite";
import { syncSeedChatSpaces } from "@/lib/dal/seed-chat-spaces";
import { createBranchLounge } from "@/lib/dal/chat-write";
import {
  branches,
  chatRoomReads,
  chatRooms,
  chatSpaceInvites,
  chatSpaceMembers,
  chatSpacePrefs,
  chatSpaces,
  messages,
  notifications,
  users,
} from "@/lib/db/schema";
import { loadSeedData } from "@/lib/seed/data";
import * as dataLoader from "@/lib/seed/data";
import * as spacesLoader from "@/lib/seed/spaces";
import * as round2 from "@/lib/seed/booking-round2";
import * as seedSpacesDal from "@/lib/dal/seed-chat-spaces";
import { runSeed } from "@/lib/seed/run-seed";
import * as schema from "@/lib/db/schema";
import { SeedError } from "@/lib/seed/errors";
import { loadSeedSpaces, selectSeedLounges } from "@/lib/seed/spaces";
import { createTestDatabase, type TestDatabase } from "./helper";

const now = new Date("2026-10-09T03:00:00.000Z");
const seed = loadSeedData();
const data = loadSeedSpaces(seed);
const community = data.communities[0]!;
const gangnam = data.loungeMembers[0]!.branchId;
const branchIds = seed.branches.map(({ id }) => id);

describe("transactional lounge and community seed", () => {
  let database: TestDatabase;
  let ids: Map<string, string>;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database?.client.close();
  });
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    await database.db.execute(
      sql`TRUNCATE users, branches, auth_verifications CASCADE`,
    );
    ids = new Map(seed.users.map(({ key }) => [key, crypto.randomUUID()]));
    await database.db.insert(users).values(
      seed.users.map(({ key, email, name }) => ({
        id: ids.get(key)!,
        email,
        name,
        emailVerified: true,
      })),
    );
    await database.db.insert(branches).values(seed.branches);
    for (const branchId of branchIds)
      await createBranchLounge(branchId, database.db);
  });
  const apply = () =>
    database.db.transaction((tx) =>
      syncSeedChatSpaces(data, branchIds, ids, now, tx),
    );
  const snapshot = async () => ({
    spaces: await database.db
      .select()
      .from(chatSpaces)
      .orderBy(asc(chatSpaces.id)),
    rooms: await database.db
      .select()
      .from(chatRooms)
      .orderBy(asc(chatRooms.id)),
    members: await database.db
      .select()
      .from(chatSpaceMembers)
      .orderBy(asc(chatSpaceMembers.spaceId), asc(chatSpaceMembers.userId)),
    messages: (
      await database.db
        .select()
        .from(messages)
        .orderBy(asc(messages.roomId), asc(messages.seq))
    ).map((row) => ({ ...row, id: null })),
    reads: await database.db
      .select()
      .from(chatRoomReads)
      .orderBy(asc(chatRoomReads.roomId), asc(chatRoomReads.userId)),
  });
  const loungeRoom = async () => {
    const [row] = await database.db
      .select({ id: chatRooms.id, spaceId: chatSpaces.id })
      .from(chatRooms)
      .innerJoin(chatSpaces, eq(chatRooms.spaceId, chatSpaces.id))
      .where(
        and(eq(chatSpaces.branchId, gangnam), eq(chatRooms.name, "라운지")),
      );
    return row!;
  };

  it("writes five lounges, one community, six members and six ordered messages with correct read boundaries", async () => {
    expect(await apply()).toEqual({
      communitySpaces: 1,
      spaceMembers: 6,
      chatMessages: 6,
    });
    const state = await snapshot();
    expect(state.spaces).toHaveLength(6);
    expect(state.rooms).toHaveLength(12);
    expect(state.rooms.filter(({ kind }) => kind === "voice")).toEqual([]);
    expect(state.members).toHaveLength(6);
    expect(state.messages).toHaveLength(6);
    expect(state.spaces.find(({ id }) => id === community.id)).toMatchObject({
      kind: "community",
      name: community.name,
      iconColor: "green",
      createdBy: ids.get("member"),
    });
    expect(
      state.members
        .filter(({ spaceId }) => spaceId === community.id)
        .map(({ userId, role }) => ({ userId, role })),
    ).toEqual(
      expect.arrayContaining([
        { userId: ids.get("member"), role: "owner" },
        { userId: ids.get("designMember"), role: "admin" },
        { userId: ids.get("both"), role: "member" },
      ]),
    );
    for (const message of state.messages) {
      const room = state.rooms.find(({ id }) => id === message.roomId)!;
      const member = state.members.find(
        ({ spaceId, userId }) =>
          spaceId === room.spaceId && userId === message.authorId,
      )!;
      expect(member.joinedAt.getTime()).toBeLessThan(
        message.createdAt.getTime(),
      );
      expect(message.kind).toBe("text");
      expect(message.systemData).toBeNull();
      expect(message.clientId).toBeNull();
    }
    for (const row of state.reads) {
      const authored = state.messages.filter(
        ({ roomId, authorId }) =>
          roomId === row.roomId && authorId === row.userId,
      );
      expect(row.lastReadSeq).toBe(Math.max(...authored.map(({ seq }) => seq)));
    }
    expect(
      state.members.find(
        ({ spaceId, userId }) =>
          spaceId !== community.id && userId === ids.get("designMember"),
      )?.joinedAt,
    ).toEqual(now);
    expect(await database.db.select().from(chatSpaceInvites)).toEqual([]);
  });

  it("repeats with stable community/channel identities and equivalent rows", async () => {
    await apply();
    const before = await snapshot();
    await apply();
    expect(await snapshot()).toEqual(before);
  });

  it("removes only this community's invitations, notifications and preferences on full synchronization", async () => {
    await apply();
    const code = "abcdefghijklmnopqrstuv";
    await database.db.insert(chatSpaceInvites).values({
      spaceId: community.id,
      createdBy: ids.get("member")!,
      code,
      useCount: 0,
    });
    await database.db.insert(notifications).values({
      userId: ids.get("both")!,
      type: "space_invite",
      actorId: ids.get("member")!,
      data: sql`${JSON.stringify({
        actorName: "김하은",
        spaceName: community.name,
        inviteCode: code,
      })}::jsonb`,
      scheduledFor: now,
    });
    await database.db.insert(chatSpacePrefs).values({
      spaceId: community.id,
      userId: ids.get("member")!,
      muted: true,
      updatedAt: now,
    });
    await apply();
    expect(await database.db.select().from(chatSpaceInvites)).toEqual([]);
    expect(await database.db.select().from(notifications)).toEqual([]);
    expect(await database.db.select().from(chatSpacePrefs)).toEqual([]);
  });

  it("preserves nonseed lounge messages, members and read positions without renumbering", async () => {
    await apply();
    const room = await loungeRoom();
    const [outsider] = await database.db
      .insert(users)
      .values({
        email: "outside-seed@example.test",
        name: "비시드 사용자",
        emailVerified: true,
      })
      .returning();
    const [member] = await database.db
      .insert(chatSpaceMembers)
      .values({
        spaceId: room.spaceId,
        userId: outsider!.id,
        role: "member",
        status: "active",
        joinedAt: now,
        statusChangedAt: now,
      })
      .returning();
    const [message] = await database.db
      .insert(messages)
      .values({
        roomId: room.id,
        authorId: outsider!.id,
        seq: 20,
        body: "이 대화는 유지돼요",
        createdAt: now,
      })
      .returning();
    const [read] = await database.db
      .insert(chatRoomReads)
      .values({
        roomId: room.id,
        userId: outsider!.id,
        lastReadSeq: 20,
        muted: true,
        updatedAt: now,
      })
      .returning();
    await database.db
      .update(chatRooms)
      .set({ lastSeq: 20, lastMessageAt: now })
      .where(eq(chatRooms.id, room.id));
    await apply();
    expect(
      await database.db
        .select()
        .from(messages)
        .where(eq(messages.id, message!.id)),
    ).toEqual([message]);
    expect(
      await database.db
        .select()
        .from(chatSpaceMembers)
        .where(eq(chatSpaceMembers.userId, outsider!.id)),
    ).toEqual([member]);
    expect(
      await database.db
        .select()
        .from(chatRoomReads)
        .where(eq(chatRoomReads.userId, outsider!.id)),
    ).toEqual([read]);
    expect(
      (
        await database.db
          .select()
          .from(chatRooms)
          .where(eq(chatRooms.id, room.id))
      )[0],
    ).toMatchObject({ lastSeq: 22, lastMessageAt: now });
    const before = await snapshot();
    await apply();
    expect(await snapshot()).toEqual(before);
  });

  it("preserves nonseed community data and unrelated user accounts", async () => {
    const [other] = await database.db
      .insert(chatSpaces)
      .values({
        kind: "community",
        name: "사용자가 만든 곳",
        createdBy: ids.get("member")!,
      })
      .returning();
    const [room] = await database.db
      .insert(chatRooms)
      .values({
        spaceId: other!.id,
        kind: "text",
        name: "대화",
        lastSeq: 1,
        lastMessageAt: now,
      })
      .returning();
    const [message] = await database.db
      .insert(messages)
      .values({
        roomId: room!.id,
        authorId: ids.get("member")!,
        body: "그대로",
        seq: 1,
        createdAt: now,
      })
      .returning();
    const beforeUsers = await database.db
      .select()
      .from(users)
      .orderBy(users.id);
    await apply();
    expect(
      await database.db
        .select()
        .from(chatSpaces)
        .where(eq(chatSpaces.id, other!.id)),
    ).toEqual([other]);
    expect(
      await database.db
        .select()
        .from(chatRooms)
        .where(eq(chatRooms.id, room!.id)),
    ).toEqual([room]);
    expect(
      await database.db
        .select()
        .from(messages)
        .where(eq(messages.id, message!.id)),
    ).toEqual([message]);
    expect(await database.db.select().from(users).orderBy(users.id)).toEqual(
      beforeUsers,
    );
  });

  it("does not restore archived or renamed lounge channels", async () => {
    const room = await loungeRoom();
    await database.db
      .update(chatRooms)
      .set({ archivedAt: now })
      .where(eq(chatRooms.id, room.id));
    await apply();
    expect(
      (
        await database.db
          .select()
          .from(chatRooms)
          .where(eq(chatRooms.id, room.id))
      )[0]?.archivedAt,
    ).toEqual(now);
    await database.db
      .update(chatRooms)
      .set({ name: "바꾼-라운지" })
      .where(eq(chatRooms.id, room.id));
    const before = await snapshot();
    await expect(apply()).rejects.toThrow(SeedError);
    expect(await snapshot()).toEqual(before);
  });

  it("rolls back lounge changes when a community channel ID conflicts", async () => {
    const lounge = await loungeRoom();
    await database.db.insert(chatRooms).values({
      id: community.channels[0]!.id,
      kind: "text",
      name: "다른-방",
      spaceId: lounge.spaceId,
    });
    const before = await snapshot();
    await expect(apply()).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });

  it("rejects another kind at the fixed community ID without touching it", async () => {
    const [branch] = await database.db
      .insert(branches)
      .values({
        name: "추가 테스트 지점",
        timezone: "Asia/Seoul",
        openHours: {},
      })
      .returning();
    await database.db
      .insert(chatSpaces)
      .values({ id: community.id, kind: "branch", branchId: branch!.id });
    const before = await snapshot();
    await expect(apply()).rejects.toThrow(SeedError);
    expect(await snapshot()).toEqual(before);
  });

  it("limits a branch scope to its lounges and never creates or rewrites communities", async () => {
    await apply();
    await database.db
      .update(chatSpaces)
      .set({ name: "사용자가 바꾼 이름" })
      .where(eq(chatSpaces.id, community.id));
    const foreignRoomIds = (
      await database.db
        .select({ id: chatRooms.id })
        .from(chatRooms)
        .where(eq(chatRooms.spaceId, community.id))
    ).map(({ id }) => id);
    const beforeMessages = await database.db
      .select()
      .from(messages)
      .where(inArray(messages.roomId, foreignRoomIds))
      .orderBy(messages.id);
    const result = await database.db.transaction((tx) =>
      syncSeedChatSpaces(
        selectSeedLounges(data, [gangnam]),
        [gangnam],
        ids,
        now,
        tx,
      ),
    );
    expect(result).toEqual({
      communitySpaces: 0,
      spaceMembers: 3,
      chatMessages: 2,
    });
    expect(
      (
        await database.db
          .select()
          .from(chatSpaces)
          .where(eq(chatSpaces.id, community.id))
      )[0]?.name,
    ).toBe("사용자가 바꾼 이름");
    expect(
      await database.db
        .select()
        .from(messages)
        .where(inArray(messages.roomId, foreignRoomIds))
        .orderBy(messages.id),
    ).toEqual(beforeMessages);
  });

  it("validates injected references and dates before any partial data is written", async () => {
    const before = await snapshot();
    await expect(
      database.db.transaction((tx) =>
        syncSeedChatSpaces(data, branchIds, new Map(), now, tx),
      ),
    ).rejects.toThrow(SeedError);
    const invalid = structuredClone(data);
    invalid.loungeMessages[0]!.minutesAgo = Number.MAX_SAFE_INTEGER;
    await expect(
      database.db.transaction((tx) =>
        syncSeedChatSpaces(invalid, branchIds, ids, now, tx),
      ),
    ).rejects.toThrow(SeedError);
    expect(await snapshot()).toEqual(before);
  });

  it("adds only a newly scoped lounge and skips it without writes on rerun", async () => {
    await apply();
    const before = await snapshot();
    const branchId = crypto.randomUUID();
    vi.spyOn(dataLoader, "loadSeedData").mockReturnValue({
      ...seed,
      branches: [
        ...seed.branches,
        { ...seed.branches[0]!, id: branchId, name: "범위 시드 라운지" },
      ],
    });
    vi.spyOn(spacesLoader, "loadSeedSpaces").mockReturnValue({
      ...data,
      loungeMembers: [
        ...data.loungeMembers,
        { branchId, userKeys: ["designMember"] },
      ],
      loungeMessages: [
        ...data.loungeMessages,
        {
          branchId,
          authorKey: "designMember",
          minutesAgo: 10,
          body: "새 지점이에요",
        },
      ],
    });
    const statements: string[] = [];
    const db = drizzle({
      client: database.client,
      schema,
      logger: {
        logQuery(query) {
          statements.push(query);
        },
      },
    });
    const input = { db, now, resetPasswords: false, branchIds: [branchId] };
    expect((await runSeed(input)).counts).toMatchObject({
      chatSpaces: 1,
      communitySpaces: 0,
      spaceMembers: 1,
      chatMessages: 1,
    });
    const after = await snapshot();
    expect(after.spaces).toEqual(expect.arrayContaining(before.spaces));
    expect(after.rooms).toEqual(expect.arrayContaining(before.rooms));
    expect(after.members).toEqual(expect.arrayContaining(before.members));
    expect(after.messages).toEqual(expect.arrayContaining(before.messages));
    expect(after.reads).toEqual(expect.arrayContaining(before.reads));
    expect(statements.some((query) => /^delete /i.test(query))).toBe(false);
    statements.length = 0;
    expect((await runSeed(input)).branchScope).toEqual({
      addedBranchIds: [],
      skippedBranchIds: [branchId],
    });
    expect(
      statements.some((query) => /^(insert|update|delete) /i.test(query)),
    ).toBe(false);
    expect(await snapshot()).toEqual(after);
  });

  it("keeps booking-round2 isolated from all lounge and community writes", async () => {
    await apply();
    const before = await snapshot();
    vi.spyOn(round2, "applyBookingRound2").mockResolvedValue({
      counts: {},
      skippedBookings: 0,
      accounts: [],
    });
    const sync = vi.spyOn(seedSpacesDal, "syncSeedChatSpaces");
    await runSeed({
      db: database.db,
      now,
      resetPasswords: false,
      bookingRound2: { hostHash: "a".repeat(64), receipt: null },
    });
    expect(sync).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
  });

  it("rejects an invalid global source before opening even a scoped transaction", async () => {
    vi.spyOn(spacesLoader, "loadSeedSpaces").mockImplementation(() => {
      throw new SeedError("스페이스 시드 오류");
    });
    const transaction = vi
      .fn()
      .mockRejectedValue(new Error("Unexpected database access"));
    await expect(
      runSeed({
        db: { transaction },
        now,
        resetPasswords: false,
        branchIds: [gangnam],
      }),
    ).rejects.toThrow("스페이스 시드 오류");
    expect(transaction).not.toHaveBeenCalled();
  });
});

import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
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
import * as authModule from "@/lib/auth/auth";
import { createMemoryEmailSender } from "@/lib/email/memory";
import { createBranchLounge } from "@/lib/dal/chat-write";
import * as seedDal from "@/lib/dal/seed-chat-spaces-additive";
import {
  captureSeedRound2Audit,
  compareSeedRound2Audit,
} from "@/lib/dal/seed-round2-audit";
import * as schema from "@/lib/db/schema";
import { loadSeedData } from "@/lib/seed/data";
import { loadSeedSpaces, seedCommunityVoiceId } from "@/lib/seed/spaces";
import {
  chatSpacesSeedManifest,
  seedChatSpacesMessageId,
} from "@/lib/seed/chat-spaces";
import {
  hashChatSpacesValue,
  type ChatSpacesReceipt,
} from "@/lib/seed/chat-spaces-receipt";
import { runSeed } from "@/lib/seed/run-seed";
import { SeedError } from "@/lib/seed/errors";
import { createTestDatabase, type TestDatabase } from "./helper";

const {
  branches,
  chatSpaces,
  chatRooms,
  chatSpaceMembers,
  chatRoomReads,
  chatSpacePrefs,
  chatSpaceInvites,
  messages,
  users,
} = schema;
const data = loadSeedData();
const spaces = loadSeedSpaces(data);
const manifest = chatSpacesSeedManifest(data, spaces);
const community = spaces.communities[0]!;
const gangnam = spaces.loungeMembers[0]!.branchId;
const now = new Date("2026-10-10T03:00:00.000Z");
const targetHash = hashChatSpacesValue(["fake.seed.test", "postgres"]);

describe("append-only chat spaces seed with immutable completion receipt", () => {
  let database: TestDatabase;
  let databaseName: string;
  let ids: Map<string, string>;
  let lounge: { spaceId: string; roomId: string };
  let throwOnReads = false;
  const statements: string[] = [];
  beforeAll(async () => {
    database = await createTestDatabase();
    database.db = drizzle({
      client: database.client,
      schema,
      logger: {
        logQuery(query) {
          statements.push(query);
          if (throwOnReads && query.startsWith('insert into "chat_room_reads"'))
            throw new Error("fixture storage failure");
        },
      },
    });
    const result = await database.client.query<{ name: string }>(
      "select current_database() as name",
    );
    databaseName = result.rows[0]!.name;
  });
  afterAll(async () => {
    await database.client.close();
  });
  afterEach(() => {
    throwOnReads = false;
    vi.restoreAllMocks();
  });
  beforeEach(async () => {
    await database.db.execute(
      sql`TRUNCATE users, branches, auth_verifications CASCADE`,
    );
    ids = new Map(data.users.map((row) => [row.key, crypto.randomUUID()]));
    await database.db.insert(users).values(
      data.users.map(({ key, email, name }) => ({
        id: ids.get(key)!,
        email,
        name,
        emailVerified: true,
      })),
    );
    await database.db.insert(branches).values(data.branches);
    for (const branch of data.branches)
      await createBranchLounge(branch.id, database.db);
    const [row] = await database.db
      .select({ spaceId: chatSpaces.id, roomId: chatRooms.id })
      .from(chatSpaces)
      .innerJoin(chatRooms, eq(chatRooms.spaceId, chatSpaces.id))
      .where(
        and(eq(chatSpaces.branchId, gangnam), eq(chatRooms.name, "라운지")),
      );
    lounge = row!;
    statements.length = 0;
  });
  const apply = (
    receipt: ChatSpacesReceipt | null = null,
    options: Partial<Parameters<typeof runSeed>[0]> = {},
  ) =>
    runSeed({
      db: database.db,
      now,
      resetPasswords: false,
      chatSpaces: { targetHash, databaseName, receipt },
      ...options,
    });
  const writes = () =>
    statements.filter((query) => /^(insert|update|delete)\b/iu.test(query));
  const snapshot = () => captureSeedRound2Audit({}, database.db);
  const insertExistingCommunities = async (
    count: number,
    role: "member" | "owner" = "member",
  ) => {
    const rows = Array.from({ length: count }, (_, index) => ({
      id: crypto.randomUUID(),
      kind: "community" as const,
      name: `기존${index}`,
      createdBy: ids.get("member")!,
    }));
    await database.db.insert(chatSpaces).values(rows);
    await database.db.insert(chatSpaceMembers).values(
      rows.map((row) => ({
        spaceId: row.id,
        userId: ids.get("member")!,
        role,
        status: "active" as const,
        joinedAt: now,
        statusChangedAt: now,
      })),
    );
  };

  it("adds exactly one community, three rooms, six members/messages/read rows without auth calls", async () => {
    const auth = vi.spyOn(authModule, "getAuth");
    const provision = vi.spyOn(authModule, "createProvisioningAuth");
    const before = await snapshot();
    const result = await apply();
    const after = await snapshot();
    expect(result).toMatchObject({
      counts: {
        communitySpaces: 1,
        chatRooms: 3,
        spaceMembers: 6,
        chatMessages: 6,
        chatRoomReads: 6,
      },
      accounts: [],
      skippedBookings: 0,
      chatSpaces: { applied: true },
    });
    expect(auth).not.toHaveBeenCalled();
    expect(provision).not.toHaveBeenCalled();
    expect(before.tables).toHaveLength(36);
    expect(after.tables).toHaveLength(36);
    const comparison = compareSeedRound2Audit(before, after);
    expect(comparison.issues).toEqual([
      {
        table: "chat_rooms",
        key: JSON.stringify([lounge.roomId]),
        kind: "changed_row",
      },
    ]);
    expect(
      comparison.added
        .filter((row) => row.count > 0)
        .map(({ table, count }) => ({ table, count })),
    ).toEqual(
      expect.arrayContaining([
        { table: "chat_spaces", count: 1 },
        { table: "chat_rooms", count: 3 },
        { table: "chat_space_members", count: 6 },
        { table: "messages", count: 6 },
        { table: "chat_room_reads", count: 6 },
      ]),
    );
    expect(comparison.added.reduce((sum, row) => sum + row.count, 0)).toBe(22);
    expect(writes().filter((query) => query.startsWith("update"))).toHaveLength(
      1,
    );
    expect(writes().some((query) => query.startsWith("delete"))).toBe(false);
    const receipt = result.chatSpaces!.receipt;
    expect(receipt).toMatchObject({
      version: 1,
      mode: "chat-spaces",
      targetHash,
      manifestHash: manifest.hash,
      appliedAt: now.toISOString(),
      lounges: [{ branchId: gangnam, ...lounge }],
    });
    expect(receipt.bundleHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("uses deterministic v5 message IDs, increasing sequences, earlier joins and each author's last read", async () => {
    await apply();
    expect(manifest.messageIds).toEqual([
      "1712349f-f9a8-5907-8fb3-31375d5cc32e",
      "62079db7-73ce-56ec-aa85-b7f65197c4cf",
      "4b8634e6-ec34-5efd-bf68-1d9cdabc523d",
      "e18fce63-a7f7-504a-93dd-e4868f264c07",
      "3ff3d5eb-9b26-52e0-a994-55a6dd683499",
      "d829b057-7dd4-52c9-b3dd-604f4647ec65",
    ]);
    expect(
      seedChatSpacesMessageId(
        gangnam,
        "floor:seed:chat-spaces:v1:lounge-message:0",
      ),
    ).toBe(manifest.messageIds[0]);
    const rows = await database.db
      .select()
      .from(messages)
      .orderBy(messages.roomId, messages.seq);
    const members = await database.db.select().from(chatSpaceMembers);
    const reads = await database.db.select().from(chatRoomReads);
    const rooms = await database.db.select().from(chatRooms);
    for (const row of rows) {
      expect(row.clientId).toBe(row.id);
      expect(row.kind).toBe("text");
      expect(row.systemData).toBeNull();
      const spaceId = rooms.find((room) => room.id === row.roomId)!.spaceId;
      expect(
        members
          .find(
            (member) =>
              member.spaceId === spaceId && member.userId === row.authorId,
          )!
          .joinedAt.getTime(),
      ).toBeLessThan(row.createdAt.getTime());
    }
    for (const roomId of new Set(rows.map((row) => row.roomId))) {
      const entries = rows.filter((row) => row.roomId === roomId);
      expect(entries.map((row) => row.seq)).toEqual(
        entries.map((_, index) => index + 1),
      );
    }
    for (const read of reads)
      expect(read.lastReadSeq).toBe(
        Math.max(
          ...rows
            .filter(
              (row) =>
                row.roomId === read.roomId && row.authorId === read.userId,
            )
            .map((row) => row.seq),
        ),
      );
    expect(reads).toHaveLength(6);
    expect(
      rooms.find((room) => room.id === seedCommunityVoiceId(community.id)),
    ).toMatchObject({
      kind: "voice",
      name: "음성",
      voiceCapacity: 10,
      lastSeq: 0,
      lastMessageAt: null,
    });
    expect(
      members.find(
        (row) =>
          row.spaceId === lounge.spaceId &&
          row.userId === ids.get("designMember"),
      )!.joinedAt,
    ).toEqual(now);
  });

  it("locks users by UUID, then the one existing space and room, before writes", async () => {
    await apply();
    const locks = statements.filter((query) => /for update/iu.test(query));
    expect(locks).toHaveLength(3);
    expect(locks[0]).toMatch(
      /from "users".*order by "users"\."id" asc.*for update/iu,
    );
    expect(locks[1]).toMatch(/from "chat_spaces".*for update/iu);
    expect(locks[2]).toMatch(/from "chat_rooms".*for update/iu);
    expect(statements.indexOf(locks[2]!)).toBeLessThan(
      statements.findIndex((query) => query.startsWith("insert")),
    );
  });

  it("replays with zero data writes and keeps later account, room, membership, message and cursor changes", async () => {
    const receipt = (await apply()).chatSpaces!.receipt;
    await database.db
      .update(users)
      .set({
        name: "바꾼 이름",
        email: "changed@example.test",
        emailVerified: false,
      })
      .where(eq(users.id, ids.get("member")!));
    await database.db
      .update(chatRooms)
      .set({ name: "바꾼 채널", archivedAt: now })
      .where(eq(chatRooms.id, community.channels[0]!.id));
    await database.db
      .update(chatSpaces)
      .set({ name: "바꾼 모임", deletedAt: now })
      .where(eq(chatSpaces.id, community.id));
    await database.db
      .update(chatSpaceMembers)
      .set({ status: "banned", statusChangedAt: now })
      .where(eq(chatSpaceMembers.userId, ids.get("both")!));
    await database.db
      .delete(chatSpaceMembers)
      .where(
        and(
          eq(chatSpaceMembers.spaceId, lounge.spaceId),
          eq(chatSpaceMembers.userId, ids.get("designMember")!),
        ),
      );
    await database.db
      .update(messages)
      .set({ body: "수정한 메시지", editedAt: now })
      .where(eq(messages.id, manifest.messageIds[0]!));
    await database.db
      .update(messages)
      .set({ body: "", deletedAt: now, deletedBy: ids.get("member")! })
      .where(eq(messages.id, manifest.messageIds[1]!));
    await database.db
      .update(chatRoomReads)
      .set({ lastReadSeq: 99, muted: true, updatedAt: now });
    const before = await snapshot();
    statements.length = 0;
    expect(
      (await apply(receipt, { now: new Date(now.getTime() + 86_400_000) }))
        .chatSpaces,
    ).toEqual({ applied: false, receipt });
    expect(writes()).toEqual([]);
    expect(await snapshot()).toEqual(before);
    expect(statements.some((query) => /email_verified/iu.test(query))).toBe(
      false,
    );
  });

  it("requires a receipt instead of adopting an already complete bundle", async () => {
    await apply();
    const before = await snapshot();
    statements.length = 0;
    await expect(apply()).rejects.toThrow(SeedError);
    expect(writes()).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    "member",
    "message",
    "read",
    "preference",
    "invite",
    "cursor",
    "extra_room",
  ] as const)("refuses existing lounge %s without any writes", async (kind) => {
    if (kind === "member")
      await database.db.insert(chatSpaceMembers).values({
        spaceId: lounge.spaceId,
        userId: ids.get("test20")!,
        role: "member",
        status: "banned",
        joinedAt: now,
        statusChangedAt: now,
      });
    if (kind === "message")
      await database.db.insert(messages).values({
        roomId: lounge.roomId,
        seq: 1,
        kind: "text",
        authorId: ids.get("member")!,
        body: "기존 대화",
        createdAt: now,
      });
    if (kind === "read")
      await database.db.insert(chatRoomReads).values({
        roomId: lounge.roomId,
        userId: ids.get("member")!,
        lastReadSeq: 0,
        muted: true,
        updatedAt: now,
      });
    if (kind === "preference")
      await database.db.insert(chatSpacePrefs).values({
        spaceId: lounge.spaceId,
        userId: ids.get("member")!,
        muted: true,
        updatedAt: now,
      });
    if (kind === "invite")
      await database.db.insert(chatSpaceInvites).values({
        spaceId: lounge.spaceId,
        code: "old-direct-invite",
        createdBy: ids.get("member")!,
      });
    if (kind === "cursor")
      await database.db
        .update(chatRooms)
        .set({ lastSeq: 4 })
        .where(eq(chatRooms.id, lounge.roomId));
    if (kind === "extra_room")
      await database.db
        .insert(chatRooms)
        .values({ kind: "text", spaceId: lounge.spaceId, name: "내 채널" });
    const before = await snapshot();
    statements.length = 0;
    await expect(apply()).rejects.toThrow(SeedError);
    expect(writes()).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it.each(["missing", "archived", "renamed", "admin_only"] as const)(
    "refuses a %s default channel in another lounge",
    async (kind) => {
      const [room] = await database.db
        .select()
        .from(chatRooms)
        .where(
          and(
            sql`${chatRooms.spaceId} <> ${lounge.spaceId}::uuid`,
            eq(chatRooms.name, "공지"),
          ),
        )
        .limit(1);
      if (kind === "missing")
        await database.db.delete(chatRooms).where(eq(chatRooms.id, room!.id));
      else
        await database.db
          .update(chatRooms)
          .set(
            kind === "archived"
              ? { archivedAt: now }
              : kind === "renamed"
                ? { name: "바뀐 공지" }
                : { adminOnly: false },
          )
          .where(eq(chatRooms.id, room!.id));
      statements.length = 0;
      await expect(apply()).rejects.toThrow(SeedError);
      expect(writes()).toEqual([]);
    },
  );

  it.each([
    "community",
    "text_room",
    "voice_room",
    "message_id",
    "client_id",
  ] as const)("refuses fixed %s traces without adoption", async (kind) => {
    if (kind === "community")
      await database.db.insert(chatSpaces).values({
        id: community.id,
        kind: "community",
        name: "기존 공간",
        createdBy: ids.get("member")!,
      });
    if (kind === "text_room" || kind === "voice_room")
      await database.db.insert(chatRooms).values({
        id:
          kind === "text_room"
            ? community.channels[0]!.id
            : seedCommunityVoiceId(community.id),
        kind: "text",
        spaceId: lounge.spaceId,
        name: "충돌",
      });
    if (kind === "message_id" || kind === "client_id") {
      const [other] = await database.db
        .select()
        .from(chatRooms)
        .where(sql`${chatRooms.spaceId} <> ${lounge.spaceId}::uuid`)
        .limit(1);
      await database.db.insert(messages).values({
        ...(kind === "message_id"
          ? { id: manifest.messageIds[0] }
          : { clientId: manifest.messageIds[0] }),
        roomId: other!.id,
        seq: 1,
        authorId: ids.get("member")!,
        body: "기존 메시지",
      });
    }
    const before = await snapshot();
    statements.length = 0;
    await expect(apply()).rejects.toThrow(SeedError);
    expect(writes()).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it.each(["missing", "unverified"] as const)(
    "rejects a %s required account without invoking auth",
    async (kind) => {
      if (kind === "missing")
        await database.db
          .delete(users)
          .where(eq(users.id, ids.get("designMember")!));
      else
        await database.db
          .update(users)
          .set({ emailVerified: false })
          .where(eq(users.id, ids.get("designMember")!));
      const auth = vi.spyOn(authModule, "getAuth");
      statements.length = 0;
      await expect(apply()).rejects.toThrow(SeedError);
      expect(auth).not.toHaveBeenCalled();
      expect(writes()).toEqual([]);
    },
  );

  it("rechecks accounts after locks and rolls back any prerequisite drift", async () => {
    const original = seedDal.lockChatSpacesSeedTargets;
    vi.spyOn(seedDal, "lockChatSpacesSeedTargets").mockImplementationOnce(
      async (userIds, target, tx) => {
        await original(userIds, target, tx);
        await tx
          .update(users)
          .set({ emailVerified: false })
          .where(eq(users.id, ids.get("member")!));
      },
    );
    const before = await snapshot();
    await expect(apply()).rejects.toThrow(SeedError);
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    { count: 98, success: true },
    { count: 99, success: false },
  ])(
    "respects projected joined-space count $count + two",
    async ({ count, success }) => {
      await insertExistingCommunities(count);
      if (success) expect((await apply()).chatSpaces?.applied).toBe(true);
      else {
        const before = await snapshot();
        await expect(apply()).rejects.toThrow(/한도/u);
        expect(await snapshot()).toEqual(before);
      }
    },
  );

  it.each([
    { count: 9, success: true },
    { count: 10, success: false },
  ])(
    "respects projected owned-community count $count + one",
    async ({ count, success }) => {
      await insertExistingCommunities(count, "owner");
      if (success) expect((await apply()).chatSpaces?.applied).toBe(true);
      else {
        const before = await snapshot();
        await expect(apply()).rejects.toThrow(/한도/u);
        expect(await snapshot()).toEqual(before);
      }
    },
  );

  it("rolls back all inserts after a mid-write read-cursor failure", async () => {
    const before = await snapshot();
    throwOnReads = true;
    await expect(apply()).rejects.toThrow(SeedError);
    throwOnReads = false;
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    "missing_message",
    "changed_seq",
    "changed_author",
    "changed_time",
    "changed_room",
    "missing_room",
    "bundle_hash",
    "manifest_hash",
    "future_time",
  ] as const)("stops receipt replay on %s without repairing", async (kind) => {
    const receipt = (await apply()).chatSpaces!.receipt;
    if (kind === "missing_message")
      await database.db
        .delete(messages)
        .where(eq(messages.id, manifest.messageIds[0]!));
    if (kind === "changed_seq")
      await database.db
        .update(messages)
        .set({ seq: 999 })
        .where(eq(messages.id, manifest.messageIds[0]!));
    if (kind === "changed_author")
      await database.db
        .update(messages)
        .set({ authorId: ids.get("admin")! })
        .where(eq(messages.id, manifest.messageIds[0]!));
    if (kind === "changed_time")
      await database.db
        .update(messages)
        .set({ createdAt: now })
        .where(eq(messages.id, manifest.messageIds[0]!));
    if (kind === "changed_room")
      await database.db
        .update(messages)
        .set({ roomId: seedCommunityVoiceId(community.id) })
        .where(eq(messages.id, manifest.messageIds[0]!));
    if (kind === "missing_room")
      await database.db
        .delete(chatRooms)
        .where(eq(chatRooms.id, seedCommunityVoiceId(community.id)));
    if (kind === "bundle_hash") receipt.bundleHash = "0".repeat(64);
    if (kind === "manifest_hash") receipt.manifestHash = "0".repeat(64);
    if (kind === "future_time")
      receipt.appliedAt = new Date(now.getTime() + 1).toISOString();
    const before = await snapshot();
    statements.length = 0;
    await expect(apply(receipt)).rejects.toThrow(SeedError);
    expect(writes()).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it("refuses a wrong DB before reading accounts or seed rows", async () => {
    const state = vi.spyOn(seedDal, "readChatSpacesSeedState");
    await expect(
      apply(null, {
        chatSpaces: { targetHash, databaseName: "different-db", receipt: null },
      }),
    ).rejects.toThrow(/실제 DB/u);
    expect(state).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it("requires the complete migration journal before reading seed rows", async () => {
    const state = vi.spyOn(seedDal, "readChatSpacesSeedState");
    await expect(
      database.db.transaction(async (tx) => {
        await tx.execute(
          sql`delete from drizzle.__drizzle_migrations where id=(select max(id) from drizzle.__drizzle_migrations)`,
        );
        await apply(null, { db: tx });
      }),
    ).rejects.toThrow(/최신 마이그레이션/u);
    expect(state).not.toHaveBeenCalled();
  });

  it.each([
    { branchIds: [gangnam] },
    { resetData: true },
    { resetPasswords: true },
    { bookingRound2: { hostHash: "f".repeat(64), receipt: null } },
  ])(
    "rejects conflicting modes before database connection: %j",
    async (extra) => {
      const transaction = vi.fn();
      await expect(
        runSeed({
          db: { transaction },
          now,
          resetPasswords: false,
          chatSpaces: { targetHash, databaseName, receipt: null },
          ...extra,
        }),
      ).rejects.toThrow(/함께/u);
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it("uses public tables even if same-name temporary tables exist", async () => {
    await database.db.execute(
      sql`create temporary table chat_spaces (id uuid)`,
    );
    try {
      expect((await apply()).chatSpaces?.applied).toBe(true);
      const result = await database.client.query<{ count: number }>(
        "select count(*)::integer as count from pg_temp.chat_spaces",
      );
      expect(result.rows[0]?.count).toBe(0);
    } finally {
      await database.db.execute(sql`drop table pg_temp.chat_spaces`);
    }
  });

  it("preserves every non-target row across all 36 tables in a populated full-seed database", async () => {
    const auth = authModule.createAuth({
      db: database.db,
      email: createMemoryEmailSender(),
      secret: "chat-spaces-test-only-secret-at-least-32-characters",
      baseUrl: "http://localhost:3000",
      rateLimit: { enabled: false },
    });
    await runSeed({ db: database.db, auth, now, resetPasswords: false });
    await database.db.insert(schema.authAccounts).values(
      [...ids.values()].map((userId) => ({
        userId,
        accountId: userId,
        providerId: "credential",
        password: `preserve-hash-${userId}`,
      })),
    );
    await database.db.insert(schema.authSessions).values({
      userId: ids.get("member")!,
      token: "preserve-test-session",
      expiresAt: new Date(now.getTime() + 86_400_000),
    });
    await database.db.insert(schema.authVerifications).values({
      identifier: "preserve-test-verification",
      value: "preserve-test-value",
      expiresAt: new Date(now.getTime() + 86_400_000),
    });
    await database.db
      .delete(chatSpaceMembers)
      .where(eq(chatSpaceMembers.spaceId, community.id));
    await database.db
      .delete(chatRooms)
      .where(eq(chatRooms.spaceId, community.id));
    await database.db.delete(chatSpaces).where(eq(chatSpaces.id, community.id));
    const targetRooms = database.db
      .select({ id: chatRooms.id })
      .from(chatRooms)
      .where(eq(chatRooms.spaceId, lounge.spaceId));
    await database.db
      .delete(messages)
      .where(inArray(messages.roomId, targetRooms));
    await database.db
      .delete(chatRoomReads)
      .where(inArray(chatRoomReads.roomId, targetRooms));
    await database.db
      .delete(chatSpaceMembers)
      .where(eq(chatSpaceMembers.spaceId, lounge.spaceId));
    await database.db
      .update(chatRooms)
      .set({ lastSeq: 0, lastMessageAt: null })
      .where(eq(chatRooms.spaceId, lounge.spaceId));
    const before = await snapshot();
    await apply();
    const after = await snapshot();
    expect(before.tables.filter((row) => row.count > 0).length).toBeGreaterThan(
      20,
    );
    expect(compareSeedRound2Audit(before, after).issues).toEqual([
      {
        table: "chat_rooms",
        key: JSON.stringify([lounge.roomId]),
        kind: "changed_row",
      },
    ]);
    expect(await database.db.select({ id: users.id }).from(users)).toHaveLength(
      21,
    );
  });

  it("detects microsecond changes to immutable existing lounge timestamps", async () => {
    const receipt = (await apply()).chatSpaces!.receipt;
    await database.db.execute(
      sql`update chat_spaces set created_at=created_at+interval '1 microsecond' where id=${lounge.spaceId}::uuid`,
    );
    statements.length = 0;
    await expect(apply(receipt)).rejects.toThrow(SeedError);
    expect(writes()).toEqual([]);
  });

  it("reads prerequisites with only the columns present before the spaces migration", async () => {
    const rollback = new Error("rollback legacy-schema fixture");
    await expect(
      database.db.transaction(async (tx) => {
        await tx.execute(sql`alter schema public rename to current_fixture`);
        await tx.execute(sql`create schema public`);
        await tx.execute(
          sql`create table public.branches(id uuid primary key)`,
        );
        await tx.execute(
          sql`create table public.users(id uuid primary key,email text,email_verified boolean)`,
        );
        await tx.execute(
          sql`create table public.chat_spaces(id uuid primary key,kind text)`,
        );
        await tx.execute(
          sql`create table public.chat_rooms(id uuid primary key,kind text,space_id uuid)`,
        );
        await tx.execute(
          sql`create table public.messages(id uuid primary key,room_id uuid,client_id text)`,
        );
        await tx.execute(
          sql`insert into public.branches(id) values (${gangnam}::uuid)`,
        );
        await tx.execute(
          sql`insert into public.users(id,email,email_verified) values (${ids.get("member")}::uuid,${manifest.accounts.find((row) => row.key === "member")!.email},true)`,
        );
        await tx.execute(
          sql`insert into public.messages(id,room_id,client_id) values (${crypto.randomUUID()}::uuid,${crypto.randomUUID()}::uuid,${manifest.messageIds[0]})`,
        );
        const state = await seedDal.readChatSpacesPrerequisites(
          manifest.references,
          tx,
        );
        expect(state.branchRows).toEqual([{ id: gangnam }]);
        expect(state.userRows).toHaveLength(1);
        expect(state.messageRows[0]?.clientId).toBe(manifest.messageIds[0]);
        expect(state.spaceRows).toEqual([]);
        expect(state.roomRows).toEqual([]);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});

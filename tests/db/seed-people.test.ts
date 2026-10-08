import { and, eq, inArray, sql } from "drizzle-orm";
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
import peopleFile from "@/docs/spec/examples/seed-people.json";
import { createAuth, type AuthInstance } from "@/lib/auth/auth";
import * as seedDal from "@/lib/dal/seed";
import * as peopleDal from "@/lib/dal/seed-people";
import {
  authAccounts,
  branches,
  chatRoomMembers,
  chatRoomReads,
  chatRooms,
  friendships,
  messages,
  notifications,
  users,
} from "@/lib/db/schema";
import { createMemoryEmailSender } from "@/lib/email/memory";
import * as peopleLoader from "@/lib/seed/people";
import * as bookingRound2 from "@/lib/seed/booking-round2";
import { loadSeedData } from "@/lib/seed/data";
import { SeedError } from "@/lib/seed/errors";
import { runSeed } from "@/lib/seed/run-seed";
import { createTestDatabase, type TestDatabase } from "./helper";

const now = new Date("2026-10-08T03:00:00Z");
const source = loadSeedData();
const people = peopleLoader.loadSeedPeople(source);

describe("transactional people and direct-message seed", () => {
  let database: TestDatabase;
  let auth: AuthInstance;
  beforeAll(async () => {
    database = await createTestDatabase();
    auth = createAuth({
      db: database.db,
      email: createMemoryEmailSender(),
      secret: "people-seed-test-secret-with-at-least-32-bytes",
      baseUrl: "http://localhost:3000",
      rateLimit: { enabled: false },
    });
  });
  afterAll(async () => {
    await database.client.close();
  });
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    await database.db.execute(
      sql`truncate users, branches, auth_verifications cascade`,
    );
  });
  const seed = () =>
    runSeed({ db: database.db, auth, now, resetPasswords: false });
  const at = (minutesAgo: number) =>
    new Date(now.getTime() - minutesAgo * 60_000);
  async function userIds() {
    const accounts = await database.db
      .select({ id: users.id, email: users.email })
      .from(users);
    return new Map(
      source.users.map((user) => [
        user.key,
        accounts.find(({ email }) => email === user.email)!.id,
      ]),
    );
  }
  async function state() {
    const rooms = await database.db
      .select()
      .from(chatRooms)
      .where(
        and(
          eq(chatRooms.kind, "dm"),
          sql`not exists (select 1 from chat_room_members m where m.room_id = ${chatRooms.id} and m.status <> 'active')`,
        ),
      )
      .orderBy(chatRooms.dmLowUserId, chatRooms.dmHighUserId);
    const roomIds = rooms.map(({ id }) => id);
    return {
      users: await database.db.select().from(users).orderBy(users.id),
      accounts: await database.db
        .select()
        .from(authAccounts)
        .orderBy(authAccounts.id),
      friendships: await database.db
        .select()
        .from(friendships)
        .orderBy(friendships.userLowId, friendships.userHighId),
      rooms,
      messages: roomIds.length
        ? await database.db
            .select()
            .from(messages)
            .where(inArray(messages.roomId, roomIds))
            .orderBy(messages.roomId, messages.seq)
        : [],
      members: roomIds.length
        ? await database.db
            .select()
            .from(chatRoomMembers)
            .where(inArray(chatRoomMembers.roomId, roomIds))
            .orderBy(chatRoomMembers.roomId, chatRoomMembers.userId)
        : [],
      reads: roomIds.length
        ? await database.db
            .select()
            .from(chatRoomReads)
            .where(inArray(chatRoomReads.roomId, roomIds))
            .orderBy(chatRoomReads.roomId, chatRoomReads.userId)
        : [],
      notifications: await database.db
        .select()
        .from(notifications)
        .where(
          inArray(notifications.type, ["friend_request", "friend_accepted"]),
        )
        .orderBy(
          notifications.userId,
          notifications.actorId,
          notifications.type,
        ),
    };
  }
  async function stableState() {
    const current = await state();
    const roomKeys = new Map(
      current.rooms.map((room) => [
        room.id,
        `${room.dmLowUserId}:${room.dmHighUserId}`,
      ]),
    );
    return {
      ...current,
      rooms: current.rooms.map((room) => ({
        ...room,
        id: roomKeys.get(room.id),
      })),
      messages: current.messages
        .map((row) => ({ ...row, id: null, roomId: roomKeys.get(row.roomId) }))
        .sort((a, b) => a.roomId!.localeCompare(b.roomId!) || a.seq - b.seq),
      members: current.members
        .map((row) => ({ ...row, roomId: roomKeys.get(row.roomId) }))
        .sort(
          (a, b) =>
            a.roomId!.localeCompare(b.roomId!) ||
            a.userId.localeCompare(b.userId),
        ),
      reads: current.reads
        .map((row) => ({ ...row, roomId: roomKeys.get(row.roomId) }))
        .sort(
          (a, b) =>
            a.roomId!.localeCompare(b.roomId!) ||
            a.userId.localeCompare(b.userId),
        ),
      notifications: current.notifications.map((row) => ({ ...row, id: null })),
    };
  }

  it("writes exact names, friendships, notification snapshots, direct sequences and authored read cursors", async () => {
    expect((await seed()).counts).toMatchObject({
      chatSpaces: 2,
      chatMessages: 44,
      friendships: 3,
      directRooms: 3,
      groupRooms: 1,
    });
    const snapshot = await state();
    const ids = await userIds();
    expect(
      snapshot.users.filter(({ username }) => username !== null),
    ).toHaveLength(5);
    expect(
      snapshot.users.find(({ id }) => id === ids.get("admin"))?.username,
    ).toBeNull();
    for (const { userKey, username } of people.usernames)
      expect(
        snapshot.users.find(({ id }) => id === ids.get(userKey)),
      ).toMatchObject({ username, usernameChangedAt: null });
    expect(snapshot.friendships).toHaveLength(3);
    expect(snapshot.notifications).toHaveLength(2);
    for (const friendship of people.friendships) {
      const [low, high] = [
        ids.get(friendship.requestedBy),
        ids.get(friendship.to),
      ].sort();
      expect(
        snapshot.friendships.find(
          (row) => row.userLowId === low && row.userHighId === high,
        ),
      ).toMatchObject({
        status: friendship.status,
        requestedBy: ids.get(friendship.requestedBy),
        requestedAt: at(friendship.minutesAgo),
        statusChangedAt: at(friendship.minutesAgo),
      });
      if (friendship.status === "pending") {
        const requester = snapshot.users.find(
          ({ id }) => id === ids.get(friendship.requestedBy),
        )!;
        expect(
          snapshot.notifications.find(
            (row) =>
              row.userId === ids.get(friendship.to) &&
              row.actorId === requester.id,
          ),
        ).toMatchObject({
          type: "friend_request",
          data: { actorName: requester.name },
          scheduledFor: at(friendship.minutesAgo),
          bookingId: null,
          expiresAt: null,
          readAt: null,
        });
      }
    }
    expect(snapshot.rooms).toHaveLength(2);
    expect(snapshot.messages).toHaveLength(5);
    expect(snapshot.members).toHaveLength(4);
    expect(snapshot.reads).toHaveLength(4);
    for (const direct of people.directMessages) {
      const [low, high] = direct.users.map((key) => ids.get(key)).sort();
      const room = snapshot.rooms.find(
        (room) => room.dmLowUserId === low && room.dmHighUserId === high,
      )!;
      const rows = snapshot.messages.filter((row) => row.roomId === room.id);
      expect(room).toMatchObject({
        kind: "dm",
        name: null,
        spaceId: null,
        lastSeq: direct.messages.length,
        lastMessageAt: at(direct.messages.at(-1)!.minutesAgo),
      });
      expect(
        rows.map(({ seq, body, authorId, createdAt }) => ({
          seq,
          body,
          authorId,
          createdAt,
        })),
      ).toEqual(
        direct.messages.map((message, index) => ({
          seq: index + 1,
          body: message.body,
          authorId: ids.get(message.authorKey),
          createdAt: at(message.minutesAgo),
        })),
      );
      const joinedAt = at(direct.messages[0]!.minutesAgo + 1);
      expect(
        snapshot.members.filter((member) => member.roomId === room.id),
      ).toEqual(
        expect.arrayContaining(
          direct.users.map((key) =>
            expect.objectContaining({
              userId: ids.get(key),
              status: "active",
              joinedAt,
              statusChangedAt: joinedAt,
            }),
          ),
        ),
      );
      for (const key of direct.users) {
        const latestOwn = rows.findLast(
          (row) => row.authorId === ids.get(key),
        )!;
        expect(
          snapshot.reads.find(
            (read) => read.roomId === room.id && read.userId === ids.get(key),
          ),
        ).toMatchObject({
          lastReadSeq: latestOwn.seq,
          updatedAt: latestOwn.createdAt,
          muted: false,
        });
      }
    }
  });

  it("repeats deterministically without replacing account data", async () => {
    await seed();
    const before = await stableState();
    await seed();
    expect(await stableState()).toEqual(before);
  });

  it("swaps seed usernames after clearing them and preserves username-change timestamps and real names", async () => {
    await seed();
    const ids = await userIds();
    const changedAt = new Date("2026-10-01T00:00:00Z");
    await database.db
      .update(users)
      .set({ usernameChangedAt: changedAt, name: "기존 이름" })
      .where(eq(users.id, ids.get("member")!));
    await database.db
      .update(users)
      .set({ username: "old_admin_name" })
      .where(eq(users.id, ids.get("admin")!));
    const input = structuredClone(peopleFile);
    const first = input.usernames[0]!;
    const second = input.usernames[1]!;
    [first.username, second.username] = [second.username, first.username];
    vi.spyOn(peopleLoader, "loadSeedPeople").mockReturnValue(
      peopleLoader.parseSeedPeople(input, source),
    );
    await seed();
    const after = await state();
    expect(
      after.users.find(({ id }) => id === ids.get(first.userKey)),
    ).toMatchObject({
      username: first.username,
      usernameChangedAt: changedAt,
      name: "기존 이름",
    });
    expect(
      after.users.find(({ id }) => id === ids.get(second.userKey))?.username,
    ).toBe(second.username);
    expect(
      after.users.find(({ id }) => id === ids.get("admin"))?.username,
    ).toBeNull();
  });

  it("reports a non-seed username conflict and rolls back all newly provisioned accounts and branches", async () => {
    const [outside] = await database.db
      .insert(users)
      .values({
        name: "보존할 사람",
        email: "outside@example.test",
        username: people.usernames[0]!.username,
      })
      .returning();
    await expect(seed()).rejects.toThrow(people.usernames[0]!.username);
    expect(await database.db.select().from(users)).toEqual([outside]);
    expect(await database.db.select().from(authAccounts)).toEqual([]);
    expect(await database.db.select().from(branches)).toEqual([]);
    expect(await database.db.select().from(friendships)).toEqual([]);
    expect(await database.db.select().from(chatRooms)).toEqual([]);
  });

  it("preserves relationships, person notifications and DM data involving a non-seed user", async () => {
    await seed();
    const ids = await userIds();
    const member = ids.get("member")!;
    const [outside] = await database.db
      .insert(users)
      .values({
        name: "외부 사람",
        email: "outside@example.test",
        username: "outside_person",
      })
      .returning();
    const [low, high] = [member, outside!.id].sort();
    const [friend] = await database.db
      .insert(friendships)
      .values({
        userLowId: low!,
        userHighId: high!,
        requestedBy: outside!.id,
        status: "accepted",
        requestedAt: now,
        statusChangedAt: now,
      })
      .returning();
    const notes = await database.db
      .insert(notifications)
      .values([
        {
          userId: member,
          actorId: outside!.id,
          type: "friend_request",
          data: { actorName: outside!.name },
          scheduledFor: now,
        },
        {
          userId: outside!.id,
          actorId: member,
          type: "friend_accepted",
          data: { actorName: "하은" },
          scheduledFor: now,
        },
      ])
      .returning();
    const [room] = await database.db
      .insert(chatRooms)
      .values({
        kind: "dm",
        dmLowUserId: low!,
        dmHighUserId: high!,
        lastSeq: 1,
        lastMessageAt: now,
      })
      .returning();
    const members = await database.db
      .insert(chatRoomMembers)
      .values(
        [member, outside!.id].map((userId) => ({
          roomId: room!.id,
          userId,
          status: "active" as const,
          joinedAt: now,
          statusChangedAt: now,
        })),
      )
      .returning();
    const [message] = await database.db
      .insert(messages)
      .values({
        roomId: room!.id,
        seq: 1,
        authorId: outside!.id,
        body: "보존할 DM",
        createdAt: now,
      })
      .returning();
    const [read] = await database.db
      .insert(chatRoomReads)
      .values({
        roomId: room!.id,
        userId: outside!.id,
        lastReadSeq: 1,
        updatedAt: now,
      })
      .returning();
    await seed();
    const after = await state();
    expect(after.users.find(({ id }) => id === outside!.id)).toEqual(outside);
    expect(after.friendships).toContainEqual(friend);
    expect(after.notifications).toEqual(expect.arrayContaining(notes));
    expect(after.rooms).toContainEqual(room);
    expect(after.members).toEqual(expect.arrayContaining(members));
    expect(after.messages).toContainEqual(message);
    expect(after.reads).toContainEqual(read);
  });

  it("rolls people replacement and all earlier seed changes back after a later failure", async () => {
    await seed();
    await database.db
      .update(branches)
      .set({ name: "실패 뒤에도 남을 지점" })
      .where(eq(branches.id, source.branches[0]!.id));
    const before = await state();
    vi.spyOn(seedDal, "insertSeedBooking").mockRejectedValueOnce(
      new Error("later failure"),
    );
    await expect(seed()).rejects.toBeInstanceOf(SeedError);
    expect(await state()).toEqual(before);
    expect(
      (
        await database.db
          .select({ name: branches.name })
          .from(branches)
          .where(eq(branches.id, source.branches[0]!.id))
      )[0]?.name,
    ).toBe("실패 뒤에도 남을 지점");
  });

  it("validates people JSON before database access", async () => {
    const invalid = structuredClone(peopleFile);
    invalid.usernames[0]!.userKey = "missing";
    vi.spyOn(peopleLoader, "loadSeedPeople").mockImplementation(() =>
      peopleLoader.parseSeedPeople(invalid, source),
    );
    const transaction = vi.fn();
    await expect(
      runSeed({ db: { transaction }, auth, now, resetPasswords: false }),
    ).rejects.toBeInstanceOf(SeedError);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("does not touch people data in branch-scoped or booking round-two runs", async () => {
    await seed();
    const before = await state();
    const sync = vi.spyOn(peopleDal, "syncSeedPeople");
    await runSeed({
      db: database.db,
      auth,
      now,
      resetPasswords: false,
      branchIds: [source.branches.at(-1)!.id],
    });
    expect(sync).not.toHaveBeenCalled();
    expect(await state()).toEqual(before);
    vi.spyOn(bookingRound2, "applyBookingRound2").mockResolvedValue({
      counts: {},
      skippedBookings: 0,
      accounts: [],
    });
    await runSeed({
      db: database.db,
      auth,
      now,
      resetPasswords: false,
      bookingRound2: { hostHash: "a".repeat(64), receipt: null },
    });
    expect(sync).not.toHaveBeenCalled();
    expect(await state()).toEqual(before);
  });

  it("does not create a read cursor for a DM member who has not written a message", async () => {
    const input = structuredClone(peopleFile);
    input.directMessages[0]!.messages = [input.directMessages[0]!.messages[0]!];
    vi.spyOn(peopleLoader, "loadSeedPeople").mockReturnValue(
      peopleLoader.parseSeedPeople(input, source),
    );
    await seed();
    const ids = await userIds();
    const [low, high] = input.directMessages[0]!.users.map((key) =>
      ids.get(key)!,
    ).sort();
    const [room] = await database.db
      .select()
      .from(chatRooms)
      .where(
        and(eq(chatRooms.dmLowUserId, low!), eq(chatRooms.dmHighUserId, high!)),
      );
    const reads = await database.db
      .select()
      .from(chatRoomReads)
      .where(eq(chatRoomReads.roomId, room!.id));
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatchObject({
      userId: ids.get(input.directMessages[0]!.messages[0]!.authorKey),
      lastReadSeq: 1,
    });
  });
});

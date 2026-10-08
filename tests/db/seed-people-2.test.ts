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
import inputFile from "@/docs/spec/examples/seed-people-2.json";
import { createAuth, type AuthInstance } from "@/lib/auth/auth";
import { createMemoryEmailSender } from "@/lib/email/memory";
import {
  branches,
  chatRoomMembers,
  chatRoomReads,
  chatRooms,
  messages,
  notifications,
  reports,
  userBlocks,
  users,
} from "@/lib/db/schema";
import * as seedDal from "@/lib/dal/seed";
import * as people2Dal from "@/lib/dal/seed-people-2";
import * as people2Loader from "@/lib/seed/people-2";
import * as bookingRound2 from "@/lib/seed/booking-round2";
import { loadSeedData } from "@/lib/seed/data";
import { loadSeedPeople } from "@/lib/seed/people";
import { SeedError } from "@/lib/seed/errors";
import { runSeed } from "@/lib/seed/run-seed";
import { createTestDatabase, type TestDatabase } from "./helper";

const now = new Date("2026-10-08T03:00:00Z");
const source = loadSeedData();
describe("transactional group and request seed", () => {
  let database: TestDatabase;
  let auth: AuthInstance;
  beforeAll(async () => {
    database = await createTestDatabase();
    auth = createAuth({
      db: database.db,
      email: createMemoryEmailSender(),
      secret: "people-2-seed-test-secret-with-at-least-32-bytes",
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
  const at = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
  async function ids() {
    const rows = await database.db.select().from(users);
    return new Map(
      source.users.map((user) => [
        user.key,
        rows.find(({ email }) => email === user.email)!.id,
      ]),
    );
  }
  async function state() {
    return {
      users: await database.db.select().from(users).orderBy(users.id),
      rooms: await database.db.select().from(chatRooms).orderBy(chatRooms.id),
      members: await database.db
        .select()
        .from(chatRoomMembers)
        .orderBy(chatRoomMembers.roomId, chatRoomMembers.userId),
      messages: await database.db
        .select()
        .from(messages)
        .orderBy(messages.roomId, messages.seq),
      reads: await database.db
        .select()
        .from(chatRoomReads)
        .orderBy(chatRoomReads.roomId, chatRoomReads.userId),
      notifications: await database.db
        .select()
        .from(notifications)
        .where(eq(notifications.type, "message_request"))
        .orderBy(notifications.userId, notifications.actorId),
      blocks: await database.db
        .select()
        .from(userBlocks)
        .orderBy(userBlocks.blockerId, userBlocks.blockedId),
      reports: await database.db.select().from(reports).orderBy(reports.id),
    };
  }
  async function stable() {
    const snapshot = await state();
    const keys = new Map(
      snapshot.rooms.map((room) => [
        room.id,
        `${room.kind}:${room.spaceId}:${room.name}:${room.dmLowUserId}:${room.dmHighUserId}:${room.bookingId}`,
      ]),
    );
    const sorted = <T>(rows: T[]) =>
      rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return {
      ...snapshot,
      rooms: sorted(
        snapshot.rooms.map((row) => ({ ...row, id: keys.get(row.id) })),
      ),
      members: sorted(
        snapshot.members.map((row) => ({
          ...row,
          roomId: keys.get(row.roomId),
        })),
      ),
      messages: sorted(
        snapshot.messages.map((row) => ({
          ...row,
          id: null,
          roomId: keys.get(row.roomId),
        })),
      ),
      reads: sorted(
        snapshot.reads.map((row) => ({ ...row, roomId: keys.get(row.roomId) })),
      ),
      notifications: snapshot.notifications.map((row) => ({
        ...row,
        id: null,
      })),
    };
  }
  it("writes group creation plus three texts, one requested recipient and eight authored cursors", async () => {
    expect((await seed()).counts).toMatchObject({
      directRooms: 3,
      groupRooms: 1,
      chatMessages: 44,
    });
    const snapshot = await state();
    const userIds = await ids();
    const group = snapshot.rooms.find(({ kind }) => kind === "group_dm")!;
    expect(group).toMatchObject({
      name: "점심 메뉴",
      lastSeq: 4,
      lastMessageAt: at(585),
      createdAt: at(600),
      spaceId: null,
      dmLowUserId: null,
      dmHighUserId: null,
    });
    const groupMessages = snapshot.messages.filter(
      ({ roomId }) => roomId === group.id,
    );
    expect(groupMessages).toHaveLength(4);
    expect(groupMessages[0]).toMatchObject({
      kind: "system",
      seq: 1,
      authorId: null,
      body: "박지훈 님이 그룹을 만들었어요",
      systemData: { type: "group_created", actorName: "박지훈" },
      createdAt: at(600),
    });
    expect(
      groupMessages
        .slice(1)
        .map(({ seq, kind, systemData }) => ({ seq, kind, systemData })),
    ).toEqual(
      [2, 3, 4].map((seq) => ({ seq, kind: "text", systemData: null })),
    );
    const members = snapshot.members.filter(
      ({ roomId }) => roomId === group.id,
    );
    expect(members).toHaveLength(3);
    expect(
      members.every(
        (member) =>
          member.status === "active" &&
          member.joinedAt.getTime() === at(600).getTime(),
      ),
    ).toBe(true);
    expect(groupMessages[0]!.createdAt.getTime()).toBe(
      members[0]!.joinedAt.getTime(),
    );
    const recipient = snapshot.members.find(
      ({ status }) => status === "requested",
    )!;
    expect(recipient).toMatchObject({
      userId: userIds.get("designMember"),
      requestedAt: at(120),
      statusChangedAt: at(120),
      joinedAt: at(120),
    });
    expect(snapshot.notifications).toHaveLength(1);
    expect(snapshot.notifications[0]).toMatchObject({
      userId: recipient.userId,
      actorId: userIds.get("growthAdmin"),
      data: { actorName: "최민준" },
      scheduledFor: at(120),
      bookingId: null,
      readAt: null,
      expiresAt: null,
    });
    const meetingRoomIds = new Set(
      snapshot.rooms
        .filter(({ kind }) => kind === "meeting")
        .map(({ id }) => id),
    );
    expect(
      snapshot.reads.filter(({ roomId }) => !meetingRoomIds.has(roomId)),
    ).toHaveLength(8);
    expect(
      snapshot.reads.filter(({ roomId }) => meetingRoomIds.has(roomId)),
    ).toHaveLength(24);
    expect(
      snapshot.reads.some(
        (read) =>
          read.roomId === recipient.roomId && read.userId === recipient.userId,
      ),
    ).toBe(false);
    for (const member of members) {
      const own = groupMessages.findLast(
        (message) => message.authorId === member.userId,
      )!;
      expect(
        snapshot.reads.find(
          (read) => read.roomId === group.id && read.userId === member.userId,
        ),
      ).toMatchObject({ lastReadSeq: own.seq, updatedAt: own.createdAt });
    }
    expect(
      snapshot.users
        .filter(({ status }) => status === "dnd")
        .map(({ id }) => id),
    ).toEqual([userIds.get("designAdmin")]);
    expect(
      snapshot.users.filter(({ status }) => status === "online"),
    ).toHaveLength(source.users.length - 1);
  });
  it("repeats deterministically and resets only seed users' manually chosen status", async () => {
    await seed();
    const before = await stable();
    await seed();
    expect(await stable()).toEqual(before);
    const userIds = await ids();
    await database.db
      .update(users)
      .set({ status: "away" })
      .where(eq(users.id, userIds.get("member")!));
    const [outside] = await database.db
      .insert(users)
      .values({ name: "외부", email: "outside@example.test", status: "away" })
      .returning();
    const updatedBefore = (
      await database.db
        .select()
        .from(users)
        .where(eq(users.id, userIds.get("member")!))
    )[0]!.updatedAt;
    await seed();
    expect(
      (
        await database.db
          .select()
          .from(users)
          .where(eq(users.id, userIds.get("member")!))
      )[0],
    ).toMatchObject({ status: "online", updatedAt: updatedBefore });
    expect(
      (
        await database.db.select().from(users).where(eq(users.id, outside!.id))
      )[0],
    ).toEqual(outside);
  });
  it("counts the creation system message as the creator's own read even without text", async () => {
    const file = structuredClone(inputFile);
    file.groupDirectMessages[0]!.messages = [];
    vi.spyOn(people2Loader, "loadSeedPeople2").mockReturnValue(
      people2Loader.parseSeedPeople2(file, source, loadSeedPeople(source)),
    );
    await seed();
    const userIds = await ids();
    const [group] = await database.db
      .select()
      .from(chatRooms)
      .where(eq(chatRooms.kind, "group_dm"));
    expect(
      await database.db
        .select()
        .from(chatRoomReads)
        .where(eq(chatRoomReads.roomId, group!.id)),
    ).toEqual([
      expect.objectContaining({
        userId: userIds.get("designAdmin"),
        lastReadSeq: 1,
        updatedAt: at(600),
        createdAt: at(600),
      }),
    ]);
  });
  it("preserves mixed groups including left non-seed members, and only clears seed-authored blocks and reports", async () => {
    await seed();
    const userIds = await ids();
    const me = userIds.get("member")!;
    const [outside] = await database.db
      .insert(users)
      .values({ name: "보존", email: "outside@example.test", status: "away" })
      .returning();
    const [room] = await database.db
      .insert(chatRooms)
      .values({
        kind: "group_dm",
        name: "보존 그룹",
        lastSeq: 1,
        lastMessageAt: now,
      })
      .returning();
    const members = await database.db
      .insert(chatRoomMembers)
      .values([
        {
          roomId: room!.id,
          userId: me,
          status: "active",
          joinedAt: now,
          statusChangedAt: now,
        },
        {
          roomId: room!.id,
          userId: outside!.id,
          status: "left",
          joinedAt: now,
          statusChangedAt: now,
        },
      ])
      .returning();
    const [message] = await database.db
      .insert(messages)
      .values({
        roomId: room!.id,
        seq: 1,
        authorId: me,
        body: "보존할 내용",
        createdAt: now,
      })
      .returning();
    const blocks = await database.db
      .insert(userBlocks)
      .values([
        { blockerId: me, blockedId: outside!.id },
        { blockerId: outside!.id, blockedId: me },
      ])
      .returning();
    const reportRows = await database.db
      .insert(reports)
      .values([
        { reporterId: me, targetUserId: outside!.id, reason: "spam" },
        {
          reporterId: outside!.id,
          targetUserId: me,
          messageId: message!.id,
          reason: "other",
          detail: "보존할 신고",
        },
      ])
      .returning();
    const [notification] = await database.db
      .insert(notifications)
      .values({
        userId: me,
        actorId: outside!.id,
        type: "message_request",
        data: { actorName: outside!.name },
        scheduledFor: now,
      })
      .returning();
    await seed();
    const after = await state();
    expect(after.rooms).toContainEqual(room);
    expect(after.members).toEqual(expect.arrayContaining(members));
    expect(after.messages).toContainEqual(message);
    expect(after.blocks).toEqual(
      blocks.filter(({ blockerId }) => blockerId === outside!.id),
    );
    expect(after.reports).toEqual(
      reportRows.filter(({ reporterId }) => reporterId === outside!.id),
    );
    expect(after.notifications).toContainEqual(notification);
  });
  it("rolls all replacement and status changes back when a later seed write fails", async () => {
    await seed();
    await database.db.update(users).set({ status: "away" });
    const before = await state();
    vi.spyOn(seedDal, "insertSeedBooking").mockRejectedValueOnce(
      new Error("later failure"),
    );
    await expect(seed()).rejects.toBeInstanceOf(SeedError);
    expect(await state()).toEqual(before);
  });
  it("validates source relationships before opening a transaction", async () => {
    const file = structuredClone(inputFile);
    file.messageRequests[0]!.to = "both";
    vi.spyOn(people2Loader, "loadSeedPeople2").mockImplementation(() =>
      people2Loader.parseSeedPeople2(file, source, loadSeedPeople(source)),
    );
    const transaction = vi.fn();
    await expect(
      runSeed({ db: { transaction }, auth, now, resetPasswords: false }),
    ).rejects.toBeInstanceOf(SeedError);
    expect(transaction).not.toHaveBeenCalled();
    expect(await database.db.select().from(users)).toEqual([]);
    expect(await database.db.select().from(branches)).toEqual([]);
  });
  it("does not synchronize statuses or people-2 data in branch or booking-round-two runs", async () => {
    await seed();
    const before = await state();
    const sync = vi.spyOn(people2Dal, "syncSeedPeople2");
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
      accounts: [],
      skippedBookings: 0,
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
});

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
import meetingFile from "@/docs/spec/examples/seed-meeting.json";
import { createAuth, type AuthInstance } from "@/lib/auth/auth";
import * as meetingDal from "@/lib/dal/seed-meeting";
import {
  bookingParticipants,
  bookings,
  branches,
  chatRoomReads,
  chatRooms,
  messages,
  users,
} from "@/lib/db/schema";
import { createMemoryEmailSender } from "@/lib/email/memory";
import { loadSeedData } from "@/lib/seed/data";
import { loadSeedBookings2 } from "@/lib/seed/bookings-2";
import * as meetingLoader from "@/lib/seed/meeting";
import { SeedError } from "@/lib/seed/errors";
import { runSeed } from "@/lib/seed/run-seed";
import { createTestDatabase, type TestDatabase } from "./helper";

const data = loadSeedData();
const extras = loadSeedBookings2(data);
const now = new Date("2026-10-08T03:00:00Z");

describe("transactional booking meeting seed", () => {
  let database: TestDatabase;
  let auth: AuthInstance;
  beforeAll(async () => {
    database = await createTestDatabase();
    auth = createAuth({
      db: database.db,
      email: createMemoryEmailSender(),
      secret: "meeting-seed-test-secret-at-least-32-bytes",
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
      sql`truncate users, branches, auth_verifications cascade`,
    );
  });
  const seed = () =>
    runSeed({ db: database.db, auth, now, resetPasswords: false });
  const at = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
  async function state() {
    const rooms = await database.db
      .select()
      .from(chatRooms)
      .where(eq(chatRooms.kind, "meeting"))
      .orderBy(chatRooms.bookingId);
    const roomIds = new Set(rooms.map(({ id }) => id));
    return {
      rooms,
      messages: (
        await database.db
          .select()
          .from(messages)
          .orderBy(messages.roomId, messages.seq)
      ).filter(({ roomId }) => roomIds.has(roomId)),
      reads: (
        await database.db
          .select()
          .from(chatRoomReads)
          .orderBy(chatRoomReads.roomId, chatRoomReads.userId)
      ).filter(({ roomId }) => roomIds.has(roomId)),
      bookings: await database.db.select().from(bookings).orderBy(bookings.id),
      participants: await database.db
        .select()
        .from(bookingParticipants)
        .orderBy(bookingParticipants.bookingId, bookingParticipants.userId),
    };
  }
  async function stable() {
    const current = await state();
    const keys = new Map(current.rooms.map((row) => [row.id, row.bookingId]));
    const sorted = <T>(rows: T[]) =>
      rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return {
      ...current,
      rooms: current.rooms.map((row) => ({ ...row, id: row.bookingId })),
      messages: sorted(
        current.messages.map((row) => ({
          ...row,
          id: null,
          roomId: keys.get(row.roomId),
        })),
      ),
      reads: sorted(
        current.reads.map((row) => ({ ...row, roomId: keys.get(row.roomId) })),
      ),
    };
  }

  it("creates 21 time-booking rooms, 21 systems and five texts, but no room for any of nine desks", async () => {
    expect(await seed()).toMatchObject({
      counts: { bookings: 30, meetingRooms: 21, chatMessages: 50 },
      skippedMeetingMessages: 0,
    });
    const current = await state();
    const people = await database.db.select().from(users);
    const userId = (key: string) =>
      people.find(
        ({ email }) =>
          email === data.users.find((user) => user.key === key)!.email,
      )!.id;
    expect(current.rooms).toHaveLength(21);
    expect(current.messages).toHaveLength(26);
    expect(current.rooms.map(({ bookingId }) => bookingId).sort()).toEqual(
      data.bookings.map(({ id }) => id).sort(),
    );
    expect(
      current.rooms.some(({ bookingId }) =>
        extras.deskBookings.some(({ id }) => id === bookingId),
      ),
    ).toBe(false);
    for (const source of data.bookings) {
      const room = current.rooms.find(
        ({ bookingId }) => bookingId === source.id,
      )!;
      const texts = meetingFile.messages.filter(
        ({ bookingId }) => bookingId === source.id,
      );
      const actual = current.messages.filter(
        ({ roomId }) => roomId === room.id,
      );
      const createdAt = texts.length ? at(texts[0]!.minutesAgo + 2) : now;
      const bookerId = userId(source.userKey);
      expect(
        current.bookings.find(({ id }) => id === source.id)!.createdAt,
      ).toEqual(createdAt);
      expect(
        current.participants
          .filter(({ bookingId }) => bookingId === source.id)
          .every((row) => row.createdAt.getTime() === createdAt.getTime()),
      ).toBe(true);
      expect(actual[0]).toMatchObject({
        seq: 1,
        kind: "system",
        authorId: null,
        createdAt,
        systemData: {
          type: "booking_created",
          actorName: people.find(({ id }) => id === bookerId)!.name,
        },
      });
      expect(
        actual
          .slice(1)
          .map(({ seq, authorId, body, createdAt }) => ({
            seq,
            authorId,
            body,
            createdAt,
          })),
      ).toEqual(
        texts.map((row, index) => ({
          seq: index + 2,
          authorId: userId(row.authorKey),
          body: row.body,
          createdAt: at(row.minutesAgo),
        })),
      );
      expect(room).toMatchObject({
        lastSeq: actual.length,
        lastMessageAt: actual.at(-1)!.createdAt,
        createdAt,
      });
      const authored = new Map([
        [bookerId, 1],
        ...actual
          .slice(1)
          .map((row) => [row.authorId!, row.seq] as [string, number]),
      ]);
      const reads = current.reads.filter(({ roomId }) => roomId === room.id);
      expect(reads).toHaveLength(authored.size);
      for (const [userId, lastReadSeq] of authored)
        expect(reads.find((row) => row.userId === userId)).toMatchObject({
          lastReadSeq,
        });
    }
  });

  it("recreates identical booking-keyed history and cursors despite generated room IDs", async () => {
    await seed();
    const first = await stable();
    await seed();
    expect(await stable()).toEqual(first);
  });

  it("preserves nonseed meetings and uses the preserved account name for new system text", async () => {
    await seed();
    const [booking] = await database.db
      .select()
      .from(bookings)
      .where(eq(bookings.id, data.bookings[0]!.id));
    const foreignId = crypto.randomUUID();
    await database.db
      .insert(bookings)
      .values({
        ...booking!,
        id: foreignId,
        status: "cancelled",
        cancelledAt: now,
        cancelledBy: booking!.userId,
        title: "보존할 회의",
      });
    await meetingDal.insertSeedMeeting(
      {
        bookingId: foreignId,
        bookerId: booking!.userId,
        userIds: new Map(),
        messages: [],
        createdAt: now,
        now,
      },
      database.db,
    );
    const before = await state();
    const room = before.rooms.find(({ bookingId }) => bookingId === foreignId)!;
    await database.db
      .update(users)
      .set({ name: "바뀐 이름" })
      .where(eq(users.id, booking!.userId));
    await seed();
    const after = await state();
    expect(after.rooms.find(({ id }) => id === room.id)).toEqual(room);
    expect(after.messages.filter(({ roomId }) => roomId === room.id)).toEqual(
      before.messages.filter(({ roomId }) => roomId === room.id),
    );
    expect(after.reads.filter(({ roomId }) => roomId === room.id)).toEqual(
      before.reads.filter(({ roomId }) => roomId === room.id),
    );
    const ownRoom = after.rooms.find(
      ({ bookingId }) => bookingId === booking!.id,
    )!;
    expect(
      after.messages.find(
        ({ roomId, seq }) => roomId === ownRoom.id && seq === 1,
      )!.systemData,
    ).toEqual({ type: "booking_created", actorName: "바뀐 이름" });
  });

  it("skips only the meeting texts attached to an overlapping skipped seed booking", async () => {
    await seed();
    const bookingId = meetingFile.messages[0]!.bookingId;
    const [booking] = await database.db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    await database.db.delete(bookings).where(eq(bookings.id, bookingId));
    await database.db
      .insert(bookings)
      .values({
        ...booking!,
        id: crypto.randomUUID(),
        title: "겹치는 비시드 예약",
      });
    expect(await seed()).toMatchObject({
      counts: { meetingRooms: 20, chatMessages: 46 },
      skippedBookings: 1,
      skippedMeetingMessages: 3,
    });
    const current = await state();
    expect(current.rooms.some((row) => row.bookingId === bookingId)).toBe(
      false,
    );
    expect(current.messages.filter(({ kind }) => kind === "text")).toHaveLength(
      2,
    );
    expect(
      current.bookings.some(({ title }) => title === "겹치는 비시드 예약"),
    ).toBe(true);
  });

  it("rolls back a failed meeting insert together with all schedule and chat replacement", async () => {
    await seed();
    await database.db
      .update(branches)
      .set({ name: "실패 전 지점" })
      .where(eq(branches.id, data.branches[0]!.id));
    const before = await state();
    const insert = meetingDal.insertSeedMeeting;
    vi.spyOn(meetingDal, "insertSeedMeeting").mockImplementationOnce(
      async (...args) => {
        await insert(...args);
        throw new Error("meeting failure");
      },
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
    ).toBe("실패 전 지점");
  });

  it.each(["full", "branches", "round2"])(
    "validates meeting references before any DB work in %s mode",
    async (mode) => {
      const input = structuredClone(meetingFile);
      input.messages[0]!.authorKey = "missing";
      vi.spyOn(meetingLoader, "loadSeedMeeting").mockImplementation(() =>
        meetingLoader.parseSeedMeeting(input, data, extras),
      );
      const transaction = vi.fn();
      await expect(
        runSeed({
          db: { transaction },
          auth,
          now,
          resetPasswords: false,
          ...(mode === "branches" ? { branchIds: [data.branches[0]!.id] } : {}),
          ...(mode === "round2"
            ? { bookingRound2: { hostHash: "a".repeat(64), receipt: null } }
            : {}),
        }),
      ).rejects.toBeInstanceOf(SeedError);
      expect(transaction).not.toHaveBeenCalled();
    },
  );
});

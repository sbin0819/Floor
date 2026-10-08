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
import { createDeskParts } from "@/features/bookings/desk-parts";
import * as authModule from "@/lib/auth/auth";
import * as participantDal from "@/lib/dal/booking-participants";
import * as notificationDal from "@/lib/dal/notifications";
import * as seedDal from "@/lib/dal/seed";
import * as round2Dal from "@/lib/dal/seed-round2";
import * as schema from "@/lib/db/schema";
import { createMemoryEmailSender } from "@/lib/email/memory";
import {
  bookingRound2HostHash,
  type BookingRound2Receipt,
} from "@/lib/seed/booking-round2-receipt";
import * as extrasLoader from "@/lib/seed/bookings-2";
import { loadSeedData } from "@/lib/seed/data";
import { runSeed } from "@/lib/seed/run-seed";
import { getOperatingDate } from "@/lib/time/open-hours";
import { createTestDatabase, type TestDatabase } from "./helper";

const {
  users,
  bookings,
  bookingParticipants,
  notifications,
  spaceBlocks,
  spaces,
  floors,
  branches,
  teamMembers,
} = schema;
const now = new Date("2026-10-08T00:00:00Z");
const previousSeedAt = new Date("2026-10-07T03:00:00Z");
const hostHash = bookingRound2HostHash("round2.example.test");
const data = loadSeedData();
const extras = extrasLoader.loadSeedBookings2(data);
const baseIds = data.bookings.map(({ id }) => id);
const countIds = extras.attendeeCounts.map(({ bookingId }) => bookingId);
const deskIds = extras.deskBookings.map(({ id }) => id);
const blockIds = extras.deskBlocks.map(({ id }) => id);
const protectedTables = [
  "users",
  "auth_accounts",
  "auth_sessions",
  "auth_verifications",
  "branches",
  "floors",
  "spaces",
  "teams",
  "team_members",
  "branch_staff",
  "access_grants",
  "role_settings",
  "space_photos",
  "floor_plans",
  "chat_rooms",
  "messages",
  "chat_spaces",
  "chat_room_reads",
  "chat_room_members",
  "chat_space_members",
  "chat_space_invites",
  "call_sessions",
  "call_participants",
];

describe("receipt-backed booking round 2 additions", () => {
  let database: TestDatabase;
  let auth: authModule.AuthInstance;
  const statements: { sql: string; params: unknown[] }[] = [];
  beforeAll(async () => {
    database = await createTestDatabase();
    database.db = drizzle({
      client: database.client,
      schema,
      logger: {
        logQuery(query, params) {
          statements.push({ sql: query, params });
        },
      },
    });
    auth = authModule.createAuth({
      db: database.db,
      email: createMemoryEmailSender(),
      secret: "round2-seed-tests-at-least-thirty-two-bytes",
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
    await runSeed({
      db: database.db,
      auth,
      now: previousSeedAt,
      resetPasswords: false,
    });
    await database.db.delete(notifications);
    await database.db.delete(bookingParticipants);
    await database.db.delete(bookings).where(inArray(bookings.id, deskIds));
    await database.db
      .delete(spaceBlocks)
      .where(inArray(spaceBlocks.id, blockIds));
    await database.db.update(bookings).set({ attendeeCount: null });
    statements.length = 0;
  });
  const seed = (receipt: BookingRound2Receipt | null = null, time = now) =>
    runSeed({
      db: database.db,
      now: time,
      resetPasswords: false,
      bookingRound2: { hostHash, receipt },
    });
  const writes = () =>
    statements.filter(({ sql: query }) =>
      /^(insert|update|delete)\b/iu.test(query),
    );
  const user = async (key: string) => {
    const [row] = await database.db
      .select()
      .from(users)
      .where(eq(users.email, data.users.find((row) => row.key === key)!.email));
    return row!;
  };
  const snapshot = async () => ({
    bookings: await database.db.select().from(bookings).orderBy(bookings.id),
    blocks: await database.db
      .select()
      .from(spaceBlocks)
      .orderBy(spaceBlocks.id),
    participants: await database.db
      .select()
      .from(bookingParticipants)
      .orderBy(bookingParticipants.bookingId, bookingParticipants.userId),
    notifications: await database.db
      .select()
      .from(notifications)
      .orderBy(notifications.id),
  });
  const preserved = async () => {
    const tables = await Promise.all(
      protectedTables.map(async (name) => {
        const rows = await database.db.execute(
          sql`select to_jsonb(t) as row from ${sql.identifier(name)} t order by to_jsonb(t)::text`,
        );
        return [name, rows.rows] as const;
      }),
    );
    const rows = await database.db
      .select()
      .from(bookings)
      .where(inArray(bookings.id, baseIds))
      .orderBy(bookings.id);
    const blocks = await database.db
      .select()
      .from(spaceBlocks)
      .where(
        inArray(
          spaceBlocks.id,
          data.spaceBlocks.map(({ id }) => id),
        ),
      )
      .orderBy(spaceBlocks.id);
    return {
      tables,
      blocks,
      bookings: rows.map((row) => ({
        ...row,
        attendeeCount: countIds.includes(row.id) ? null : row.attendeeCount,
      })),
    };
  };
  const firstRange = () => {
    const seedSpace = data.spaces.find(
      ({ id }) => id === extras.deskBookings[0]!.deskId,
    )!;
    const floor = data.floors.find(({ id }) => id === seedSpace.floorId)!;
    const branch = data.branches.find(({ id }) => id === floor.branchId)!;
    const part = createDeskParts({
      date: getOperatingDate(now, branch.timezone, branch.openHours, 0),
      timeZone: branch.timezone,
      openHours: branch.openHours,
    }).find(({ part }) => part === "day")!;
    return { start: new Date(part.start), end: new Date(part.end) };
  };

  it("changes only the six counts and adds five participants, nine desks, one block and future reminders", async () => {
    for (let index = 1; index <= 20; index++)
      await database.db.insert(users).values({
        email: `outsider${index}@ai.com`,
        name: `시드 외 회원 ${index}`,
        emailVerified: true,
      });
    const person = await user("member");
    const [room] = await database.db
      .select()
      .from(schema.chatRooms)
      .where(eq(schema.chatRooms.kind, "voice"))
      .limit(1);
    const [call] = await database.db
      .insert(schema.callSessions)
      .values({
        roomId: room!.id,
        kind: "voice",
        startedBy: person.id,
        startedAt: now,
      })
      .returning();
    await database.db
      .insert(schema.callParticipants)
      .values({
        sessionId: call!.id,
        userId: person.id,
        joinedAt: now,
        lastSeenAt: now,
      });
    const before = await preserved();
    const authRead = vi.spyOn(authModule, "getAuth").mockImplementation(() => {
      throw new Error("must not initialize auth");
    });
    const provision = vi.spyOn(authModule, "createProvisioningAuth");
    const beforeSeed = statements.length;
    const result = await seed();
    expect(result.counts).toMatchObject({
      attendeeCounts: 6,
      bookingParticipants: 5,
      bookings: 9,
      spaceBlocks: 1,
    });
    expect(result.counts.notifications).toBeGreaterThan(0);
    expect(result.skippedBookings).toBe(0);
    expect(result.accounts).toEqual([]);
    expect(result.bookingRound2?.applied).toBe(true);
    expect(result.bookingRound2?.receipt).toMatchObject({
      version: 1,
      mode: "booking-round2",
      hostHash,
      appliedAt: now.toISOString(),
    });
    expect(authRead).not.toHaveBeenCalled();
    expect(provision).not.toHaveBeenCalled();
    expect(
      statements
        .slice(beforeSeed)
        .filter(({ sql: query }) =>
          /\b(?:from|into|update|join)\s+"(?:chat_|call_|messages)/iu.test(
            query,
          ),
        ),
    ).toEqual([]);
    expect(await preserved()).toEqual(before);
    const current = await snapshot();
    expect(current.bookings).toHaveLength(30);
    expect(current.blocks).toHaveLength(5);
    expect(current.participants).toHaveLength(5);
    expect(
      current.bookings
        .filter(({ id }) => deskIds.includes(id))
        .every(({ createdAt }) => createdAt.getTime() === now.getTime()),
    ).toBe(true);
    for (const { bookingId, attendeeCount } of extras.attendeeCounts)
      expect(
        current.bookings.find(({ id }) => id === bookingId)?.attendeeCount,
      ).toBe(attendeeCount);
    for (const row of current.notifications) {
      expect(row.type).toBe("booking_reminder");
      expect(row.scheduledFor > now).toBe(true);
      expect(row.expiresAt).toEqual(
        current.bookings.find(({ id }) => id === row.bookingId)!.during.end,
      );
      expect(row.data).not.toHaveProperty("title");
      expect(baseIds).toContain(row.bookingId);
    }
  });

  it("performs no writes on receipt-backed reruns and preserves cancellation, left participants, read alerts and edits", async () => {
    const result = await seed();
    const receipt = result.bookingRound2!.receipt;
    await database.db
      .update(bookings)
      .set({ status: "cancelled", cancelledAt: now })
      .where(eq(bookings.id, deskIds[0]!));
    await database.db.delete(bookingParticipants);
    await database.db.update(notifications).set({ readAt: now });
    await database.db
      .update(bookings)
      .set({ attendeeCount: 1, title: "시드 후 바꾼 제목" })
      .where(eq(bookings.id, countIds[0]!));
    await database.db.update(branches).set({ openHours: {} });
    const before = await snapshot();
    statements.length = 0;
    const repeated = await seed(receipt, new Date("2026-11-08T00:00:00Z"));
    expect(writes()).toEqual([]);
    expect(
      statements.every(({ sql: query }) =>
        /^(select|begin|commit)/iu.test(query),
      ),
    ).toBe(true);
    expect(repeated).toEqual({
      counts: {},
      skippedBookings: 0,
      accounts: [],
      bookingRound2: { applied: false, receipt },
    });
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    "same count",
    "different count",
    "participant",
    "seat",
    "block",
    "reminder",
    "complete",
  ] as const)(
    "refuses %s evidence without a receipt and does not repair it",
    async (kind) => {
      const completed = await seed();
      const complete = await snapshot();
      if (kind !== "complete") {
        await database.db.delete(notifications);
        await database.db.delete(bookingParticipants);
        await database.db.delete(bookings).where(inArray(bookings.id, deskIds));
        await database.db
          .delete(spaceBlocks)
          .where(inArray(spaceBlocks.id, blockIds));
        await database.db
          .update(bookings)
          .set({ attendeeCount: null })
          .where(inArray(bookings.id, countIds));
        if (kind.includes("count"))
          await database.db
            .update(bookings)
            .set({
              attendeeCount:
                kind === "same count"
                  ? extras.attendeeCounts[0]!.attendeeCount
                  : 1,
            })
            .where(eq(bookings.id, countIds[0]!));
        if (kind === "participant")
          await database.db
            .insert(bookingParticipants)
            .values(complete.participants[0]!);
        if (kind === "seat")
          await database.db
            .insert(bookings)
            .values(complete.bookings.find(({ id }) => id === deskIds[0])!);
        if (kind === "block")
          await database.db
            .insert(spaceBlocks)
            .values(complete.blocks.find(({ id }) => id === blockIds[0])!);
        if (kind === "reminder")
          await database.db
            .insert(notifications)
            .values(complete.notifications[0]!);
      }
      expect(completed.bookingRound2?.applied).toBe(true);
      const before = await snapshot();
      statements.length = 0;
      await expect(seed()).rejects.toThrow("완료 기록 없이");
      expect(writes()).toEqual([]);
      expect(await snapshot()).toEqual(before);
    },
  );

  it.each(["host", "manifest", "bundle", "future"] as const)(
    "rejects a mismatched %s receipt",
    async (kind) => {
      const receipt = { ...(await seed()).bookingRound2!.receipt };
      if (kind === "host") receipt.hostHash = "a".repeat(64);
      if (kind === "manifest") receipt.manifestHash = "b".repeat(64);
      if (kind === "bundle") receipt.bundleHash = "c".repeat(64);
      if (kind === "future") receipt.appliedAt = "2099-01-01T00:00:00.000Z";
      statements.length = 0;
      await expect(seed(receipt)).rejects.toThrow(/완료 기록/u);
      expect(writes()).toEqual([]);
    },
  );

  it.each([
    "deleted seat",
    "moved seat",
    "changed dates",
    "changed owner",
    "deleted block",
  ] as const)(
    "rejects receipt-backed immutable bundle drift: %s",
    async (kind) => {
      const receipt = (await seed()).bookingRound2!.receipt;
      const [row] = await database.db
        .select()
        .from(bookings)
        .where(eq(bookings.id, deskIds[0]!));
      if (kind === "deleted seat")
        await database.db.delete(bookings).where(eq(bookings.id, row!.id));
      if (kind === "moved seat")
        await database.db
          .update(bookings)
          .set({ spaceId: extras.deskBlocks[0]!.spaceId })
          .where(eq(bookings.id, row!.id));
      if (kind === "changed dates")
        await database.db
          .update(bookings)
          .set({
            during: {
              start: new Date("2030-01-01T00:00:00Z"),
              end: new Date("2030-01-01T01:00:00Z"),
            },
          })
          .where(eq(bookings.id, row!.id));
      if (kind === "changed owner")
        await database.db
          .update(bookings)
          .set({ userId: (await user("member")).id })
          .where(eq(bookings.id, row!.id));
      if (kind === "deleted block")
        await database.db
          .delete(spaceBlocks)
          .where(eq(spaceBlocks.id, blockIds[0]!));
      statements.length = 0;
      await expect(seed(receipt)).rejects.toThrow(/불변 값/u);
      expect(writes()).toEqual([]);
    },
  );

  it.each([
    "unverified",
    "missing account",
    "missing booking",
    "cancelled participant target",
    "parent",
    "unbookable",
    "archived",
    "closed floor",
    "closed area",
    "capacity",
  ] as const)("rejects changed required state: %s", async (kind) => {
    const first = extras.deskBookings[0]!;
    const desk = data.spaces.find(({ id }) => id === first.deskId)!;
    if (kind === "unverified")
      await database.db
        .update(users)
        .set({ emailVerified: false })
        .where(eq(users.id, (await user(first.userKey)).id));
    if (kind === "missing account")
      await database.db
        .update(users)
        .set({ email: "renamed@round2.test" })
        .where(eq(users.id, (await user(first.userKey)).id));
    if (kind === "missing booking")
      await database.db.delete(bookings).where(eq(bookings.id, countIds[0]!));
    if (kind === "cancelled participant target")
      await database.db
        .update(bookings)
        .set({ status: "cancelled", cancelledAt: now })
        .where(eq(bookings.id, extras.participants[0]!.bookingId));
    if (kind === "parent")
      await database.db
        .update(spaces)
        .set({ parentId: null })
        .where(eq(spaces.id, desk.id));
    if (kind === "unbookable")
      await database.db
        .update(spaces)
        .set({ bookable: false })
        .where(eq(spaces.id, desk.id));
    if (kind === "archived")
      await database.db
        .update(spaces)
        .set({ archivedAt: now })
        .where(eq(spaces.id, desk.parentId!));
    if (kind === "closed floor")
      await database.db
        .update(floors)
        .set({ access: "closed" })
        .where(eq(floors.id, desk.floorId));
    if (kind === "closed area")
      await database.db
        .update(spaces)
        .set({ access: "closed" })
        .where(eq(spaces.id, desk.parentId!));
    if (kind === "capacity")
      await database.db
        .update(spaces)
        .set({ capacity: 1 })
        .where(
          eq(
            spaces.id,
            data.bookings.find(({ id }) => id === countIds[0])!.spaceId,
          ),
        );
    statements.length = 0;
    await expect(seed()).rejects.toThrow(/예약 2차/u);
    expect(writes()).toEqual([]);
  });

  it("checks current team membership for a requested team desk reservation", async () => {
    const input = structuredClone(extras);
    const first = input.deskBookings[0]!;
    first.teamId = data.teamMembers.find(
      ({ userKey }) => userKey === first.userKey,
    )!.teamId;
    vi.spyOn(extrasLoader, "loadSeedBookings2").mockReturnValue(input);
    const owner = await user(first.userKey);
    await database.db
      .delete(teamMembers)
      .where(
        and(
          eq(teamMembers.userId, owner.id),
          eq(teamMembers.teamId, first.teamId),
        ),
      );
    statements.length = 0;
    await expect(seed()).rejects.toThrow("팀 소속");
    expect(writes()).toEqual([]);
  });

  it.each([
    "same seat",
    "same user",
    "desk block",
    "area block",
    "new block occupied",
  ] as const)("rolls back instead of skipping a %s conflict", async (kind) => {
    const first = extras.deskBookings[0]!;
    const desk = data.spaces.find(({ id }) => id === first.deskId)!;
    const during = firstRange();
    if (kind === "desk block" || kind === "area block") {
      await database.db.insert(spaceBlocks).values({
        spaceId: kind === "area block" ? desk.parentId! : desk.id,
        during,
        createdBy: (await user("admin")).id,
      });
    } else {
      await database.db.insert(bookings).values({
        spaceId: kind === "same seat" ? desk.id : extras.deskBlocks[0]!.spaceId,
        userId: (await user(kind === "same user" ? first.userKey : "member"))
          .id,
        during,
      });
    }
    const before = await snapshot();
    statements.length = 0;
    await expect(seed()).rejects.toThrow("겹쳐요");
    expect(writes()).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it("checks cross-seat same-user overlap inside the prepared bundle", async () => {
    const input = structuredClone(extras);
    input.deskBookings[1]!.userKey = input.deskBookings[0]!.userKey;
    vi.spyOn(extrasLoader, "loadSeedBookings2").mockReturnValue(input);
    statements.length = 0;
    await expect(seed()).rejects.toThrow("묶음 안에서");
    expect(writes()).toEqual([]);
  });

  it.each(["count", "participants", "desk", "block", "reminders"] as const)(
    "rolls back all additions after a mid-transaction %s failure",
    async (kind) => {
      const before = await snapshot();
      const error = new Error("private database detail");
      if (kind === "count")
        vi.spyOn(round2Dal, "fillRound2AttendeeCount")
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(false);
      if (kind === "participants")
        vi.spyOn(
          participantDal,
          "insertBookingParticipants",
        ).mockRejectedValueOnce(error);
      if (kind === "desk")
        vi.spyOn(seedDal, "insertSeedBooking").mockRejectedValueOnce(error);
      if (kind === "block")
        vi.spyOn(seedDal, "insertSeedBlock").mockRejectedValueOnce(error);
      if (kind === "reminders")
        vi.spyOn(notificationDal, "insertNotifications").mockRejectedValueOnce(
          error,
        );
      await expect(seed()).rejects.not.toThrow("private database detail");
      expect(await snapshot()).toEqual(before);
    },
  );

  it("locks floor, parents, desks, sorted users at maximum strength, teams, then bookings and uses conditional count updates", async () => {
    await seed();
    const locks = statements.filter(({ sql: query }) =>
      /for (update|key share)/iu.test(query),
    );
    const kinds = locks.map(
      ({ sql: query }) => /from "([^"]+)"/u.exec(query)![1],
    );
    expect(kinds.indexOf("floors")).toBeLessThan(kinds.indexOf("spaces"));
    expect(kinds.lastIndexOf("spaces")).toBeLessThan(kinds.indexOf("users"));
    expect(kinds.lastIndexOf("users")).toBeLessThan(kinds.indexOf("teams"));
    expect(kinds.lastIndexOf("teams")).toBeLessThan(kinds.indexOf("bookings"));
    const userLocks = locks.filter(({ sql: query }) =>
      query.includes('from "users"'),
    );
    const ids = userLocks.map(({ params }) => params[0]);
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(ids.length);
    for (const userKey of new Set(
      extras.deskBookings.map(({ userKey }) => userKey),
    )) {
      const id = (await user(userKey)).id;
      expect(userLocks.find(({ params }) => params[0] === id)!.sql).toContain(
        "for update",
      );
    }
    const updates = writes().filter(({ sql: query }) =>
      query.startsWith('update "bookings"'),
    );
    expect(updates).toHaveLength(6);
    expect(
      updates.every(
        ({ sql: query }) =>
          query.includes('"attendee_count" is null') &&
          query.includes("returning"),
      ),
    ).toBe(true);
  });

  it("rejects conflicting mode flags and malformed receipts before opening a transaction or auth", async () => {
    const transaction = vi.fn();
    const getAuth = vi.spyOn(authModule, "getAuth");
    await expect(
      runSeed({
        db: { transaction },
        now,
        resetPasswords: true,
        bookingRound2: { hostHash, receipt: null },
      }),
    ).rejects.toThrow("함께");
    await expect(
      runSeed({
        db: { transaction },
        now,
        resetPasswords: false,
        branchIds: [],
        bookingRound2: { hostHash, receipt: null },
      }),
    ).rejects.toThrow("함께");
    await expect(
      runSeed({
        db: { transaction },
        now,
        resetPasswords: false,
        bookingRound2: { hostHash: "invalid", receipt: null },
      }),
    ).rejects.toThrow("호스트");
    await expect(
      runSeed({
        db: { transaction },
        now,
        resetPasswords: false,
        bookingRound2: { hostHash, receipt: {} as BookingRound2Receipt },
      }),
    ).rejects.toThrow("기록");
    expect(transaction).not.toHaveBeenCalled();
    expect(getAuth).not.toHaveBeenCalled();
  });
});

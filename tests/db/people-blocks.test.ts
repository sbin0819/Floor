import { eq } from "drizzle-orm";
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
import { createBookingActions } from "@/features/bookings/create-booking-factory";
import { createUpdateBookingAction } from "@/features/bookings/update-booking-factory";
import { createPeopleQueries } from "@/features/people/query-factory";
import { findParticipants } from "@/lib/dal/participant-search";
import * as participantDal from "@/lib/dal/booking-participants";
import {
  bookingParticipants,
  bookings,
  notifications,
  teamMembers,
  userBlocks,
  users,
} from "@/lib/db/schema";
import { relationOf } from "@/lib/people/friendship";
import { createMemoryRateLimiter } from "@/lib/rate-limit/memory";
import {
  bookingInput,
  bookingNow,
  bookingRange,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

describe("block-aware people lookup and new booking participants", () => {
  let database: TestDatabase;
  let fixture: BookingActors;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    fixture = await seedBookingActors(database);
    await database.db
      .insert(teamMembers)
      .values({
        teamId: fixture.teamId,
        userId: fixture.person.userId,
        role: "member",
      });
    await database.db
      .update(users)
      .set({ username: "shared.member" })
      .where(eq(users.id, fixture.member.userId));
  });
  const dependencies = () => ({
    database: database.db,
    getSession: async () => fixture.person,
    now: () => bookingNow,
    logError: vi.fn(),
  });
  const query = () =>
    createPeopleQueries({
      database: database.db,
      requireSession: async () => fixture.person,
      now: () => bookingNow,
      rateLimiter: createMemoryRateLimiter(),
    });
  const block = (direction: "mine" | "theirs", other = fixture.member.userId) =>
    database.db
      .insert(userBlocks)
      .values({
        blockerId: direction === "mine" ? fixture.person.userId : other,
        blockedId: direction === "mine" ? other : fixture.person.userId,
      });
  const invalid = {
    ok: false,
    code: "INVALID_INPUT",
    fieldErrors: {
      participants: ["초대할 수 없는 사람이 있어요. 다시 찾아서 넣어 주세요"],
    },
  };
  const input = () => ({
    ...bookingInput(fixture, {
      start: bookingRange("13:30", "14:30").start.toISOString(),
      end: bookingRange("13:30", "14:30").end.toISOString(),
    }),
    participants: [{ userId: fixture.member.userId }],
  });
  async function booking(existing: string[] = []) {
    const row = await insertFixtureBooking(database, fixture, {
      during: bookingRange("13:30", "14:30"),
      attendeeCount: 4,
    });
    if (existing.length)
      await database.db
        .insert(bookingParticipants)
        .values(existing.map((userId) => ({ bookingId: row.id, userId })));
    return {
      bookingId: row.id,
      start: row.during.start.toISOString(),
      end: row.during.end.toISOString(),
      attendeeCount: 4,
      title: "바꾼 제목",
      participants: existing.map((userId) => ({ userId })),
      participantIdsAtLoad: existing,
    };
  }
  it.each(["mine", "theirs"] as const)(
    "keeps exact matching but hides partial candidates and contacts for a %s block",
    async (direction) => {
      await block(direction);
      expect(await query().searchPeople("그로스 팀원")).toEqual([]);
      for (const search of ["shared.member", fixture.member.email]) {
        const rows = await query().searchPeople(search);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          userId: fixture.member.userId,
          relation: direction === "mine" ? "blocked" : "none",
          canDirectMessage: false,
          directRoomId: null,
        });
        expect(JSON.stringify(rows)).not.toContain(fixture.member.email);
      }
      expect(
        (await query().getMessageContacts()).some(
          ({ userId }) => userId === fixture.member.userId,
        ),
      ).toBe(false);
      const profile = await query().getPersonProfile(fixture.member.userId);
      expect(profile).toMatchObject({
        relation: direction === "mine" ? "blocked" : "none",
        canDirectMessage: false,
      });
      expect(profile).not.toHaveProperty("byThem");
      expect(profile).not.toHaveProperty("blockedByThem");
    },
  );
  it("only lists my blocks, sorted by name, without disclosing inbound blocks", async () => {
    await block("mine");
    await block("theirs", fixture.stranger.userId);
    const result = await query().getFriendsView("blocked");
    expect(result.rows.map(({ userId }) => userId)).toEqual([
      fixture.member.userId,
    ]);
    expect(JSON.stringify(result.rows)).not.toContain("@example.test");
    expect(
      relationOf(null, fixture.person.userId, bookingNow, {
        byMe: true,
        byThem: true,
      }),
    ).toBe("blocked");
    expect(
      relationOf(null, fixture.person.userId, bookingNow, {
        byMe: false,
        byThem: true,
      }),
    ).toBe("none");
  });
  it.each(["mine", "theirs"] as const)(
    "excludes %s blocks from partial and exact participant searches",
    async (direction) => {
      await block(direction);
      expect(
        await findParticipants(
          fixture.person.userId,
          fixture.member.email,
          database.db,
        ),
      ).toEqual([]);
      expect(
        await findParticipants(
          fixture.person.userId,
          "그로스 팀원",
          database.db,
        ),
      ).toEqual([]);
      expect(
        await findParticipants(
          fixture.person.userId,
          fixture.stranger.email,
          database.db,
        ),
      ).toHaveLength(1);
    },
  );
  it.each(["mine", "theirs"] as const)(
    "rejects %s blocks when creating with a same-team or fully-proven external participant",
    async (direction) => {
      await block(direction);
      expect(
        await createBookingActions(dependencies()).createBooking(input()),
      ).toEqual(invalid);
      await block(direction, fixture.stranger.userId);
      expect(
        await createBookingActions(dependencies()).createBooking({
          ...input(),
          participants: [
            { userId: fixture.stranger.userId, email: fixture.stranger.email },
          ],
        }),
      ).toEqual(invalid);
      expect(await database.db.select().from(bookings)).toEqual([]);
      expect(await database.db.select().from(bookingParticipants)).toEqual([]);
      expect(await database.db.select().from(notifications)).toEqual([]);
    },
  );
  it.each(["mine", "theirs"] as const)(
    "keeps an existing participant despite a %s block but rejects newly added blocked people",
    async (direction) => {
      const draft = await booking([fixture.member.userId]);
      await block(direction);
      expect(await createUpdateBookingAction(dependencies())(draft)).toEqual({
        ok: true,
        data: { bookingId: draft.bookingId },
      });
      expect(await database.db.select().from(bookingParticipants)).toEqual([
        { bookingId: draft.bookingId, userId: fixture.member.userId },
      ]);
      await block(direction, fixture.stranger.userId);
      const before = await database.db.select().from(bookings);
      expect(
        await createUpdateBookingAction(dependencies())({
          ...draft,
          participants: [
            ...draft.participants,
            { userId: fixture.stranger.userId, email: fixture.stranger.email },
          ],
        }),
      ).toEqual(invalid);
      expect(await database.db.select().from(bookings)).toEqual(before);
      expect(await database.db.select().from(bookingParticipants)).toHaveLength(
        1,
      );
    },
  );
  it.each(["create", "update"] as const)(
    "rechecks a new block after the %s user lock",
    async (operation) => {
      const draft = operation === "update" ? await booking() : null;
      const original = participantDal.lockParticipantBookingActor;
      vi.spyOn(
        participantDal,
        "lockParticipantBookingActor",
      ).mockImplementationOnce(async (input, tx) => {
        const result = await original(input, tx);
        await tx
          .insert(userBlocks)
          .values({
            blockerId: fixture.member.userId,
            blockedId: fixture.person.userId,
          });
        return result;
      });
      const result = draft
        ? await createUpdateBookingAction(dependencies())({
            ...draft,
            participants: [{ userId: fixture.member.userId }],
          })
        : await createBookingActions(dependencies()).createBooking(input());
      expect(result).toEqual(invalid);
      expect(await database.db.select().from(bookingParticipants)).toEqual([]);
      expect(await database.db.select().from(userBlocks)).toEqual([]);
    },
  );
  it("does not resurrect a departed participant from an old editor even if they are now blocked", async () => {
    const draft = await booking([fixture.member.userId]);
    await database.db
      .delete(bookingParticipants)
      .where(eq(bookingParticipants.userId, fixture.member.userId));
    await block("theirs");
    expect((await createUpdateBookingAction(dependencies())(draft)).ok).toBe(
      true,
    );
    expect(await database.db.select().from(bookingParticipants)).toEqual([]);
  });
  it("keeps lookup statement budgets constant after adding blocks", async () => {
    const meter = createQueryMeter(database.client);
    try {
      await block("mine");
      for (const [read, perStage] of [
        [() => query().searchPeople("shared.member"), [1]],
        [() => query().getPersonProfile(fixture.member.userId), [1]],
        [() => query().getFriendsView("blocked"), [3]],
        [() => query().getMessageContacts(), [1]],
        [
          () =>
            findParticipants(
              fixture.person.userId,
              fixture.member.email,
              database.db,
            ),
          [1],
        ],
      ] as const) {
        meter.start();
        await read();
        expect(meter.stop().perStage).toEqual(perStage);
      }
    } finally {
      meter.restore();
    }
  });
});

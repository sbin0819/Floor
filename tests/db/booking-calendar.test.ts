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
import { createBookingQueries } from "@/features/bookings/query-factory";
import { ActionError } from "@/lib/actions/result";
import * as bookingDal from "@/lib/dal/bookings";
import {
  bookings,
  branches,
  floors,
  roleSettings,
  spaces,
  spacePhotos,
  teamMembers,
  teams,
  users,
} from "@/lib/db/schema";
import { defaultPermissions } from "@/lib/permissions/defaults";
import { addDays, zonedDateTime } from "@/lib/time/zoned";
import {
  bookingNow,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

describe("my booking calendar query", () => {
  let database: TestDatabase;
  let actors: BookingActors;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  beforeEach(async () => {
    actors = await seedBookingActors(database);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await database?.client.close();
  });
  const query = (session = actors.person, now = bookingNow) =>
    createBookingQueries({
      database: database.db,
      requireSession: async () => session,
      now: () => now,
    });
  async function insert(
    date: string,
    time = "10:00",
    changes: Partial<typeof bookings.$inferInsert> = {},
    timezone = "Asia/Seoul",
  ) {
    const start = zonedDateTime(date, time, timezone);
    const [row] = await database.db
      .insert(bookings)
      .values({
        userId: actors.person.userId,
        spaceId: actors.publicSpaceId,
        during: { start, end: new Date(start.getTime() + 30 * 60_000) },
        ...changes,
      })
      .returning();
    if (!row) throw new Error("Missing calendar booking fixture.");
    return row;
  }
  const defaultBranch = (
    branchId = actors.branchId,
    userId = actors.person.userId,
  ) =>
    database.db
      .update(users)
      .set({ defaultBranchId: branchId })
      .where(eq(users.id, userId));

  it("checks the session before SQL, reading now, or normalizing arbitrary address values", async () => {
    const read = vi.spyOn(database.client, "query");
    const now = vi.fn(() => bookingNow);
    const queries = createBookingQueries({
      database: database.db,
      requireSession: async () => {
        throw new ActionError("UNAUTHENTICATED");
      },
      now,
    });
    await expect(
      queries.getMyBookingsMonth({ month: ["bad"], day: {} }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(read).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });

  it("uses Seoul without a home branch and acquires the injected clock exactly once", async () => {
    const now = vi.fn(() => new Date("2026-10-31T15:30:00Z"));
    const result = await createBookingQueries({
      database: database.db,
      requireSession: async () => actors.person,
      now,
    }).getMyBookingsMonth();
    expect(result).toMatchObject({
      today: "2026-11-01",
      month: "2026-11",
      day: "2026-11-01",
      timezone: "Asia/Seoul",
      now: "2026-10-31T15:30:00.000Z",
      bookings: [],
    });
    expect(now).toHaveBeenCalledOnce();
  });

  it("uses the same team-home fallback and explicit default-branch timezone as booking entry", async () => {
    await database.db
      .update(branches)
      .set({ timezone: "America/New_York" })
      .where(eq(branches.id, actors.branchId));
    const now = new Date("2026-10-01T03:00:00Z");
    expect(await query(actors.member, now).getBookingEntry()).toBe(
      actors.branchId,
    );
    expect(await query(actors.member, now).getMyBookingsMonth()).toMatchObject({
      today: "2026-09-30",
      month: "2026-09",
      timezone: "America/New_York",
    });
    await defaultBranch(actors.otherBranchId, actors.member.userId);
    expect(await query(actors.member, now).getMyBookingsMonth()).toMatchObject({
      today: "2026-10-01",
      month: "2026-10",
      timezone: "Asia/Seoul",
    });
  });

  it("includes only own confirmed personal/team bookings and keeps stable start order", async () => {
    const personal = await insert("2026-10-09", "10:00", {
      title: "내 개인 일정",
    });
    const team = await insert("2026-10-08", "10:00", {
      teamId: actors.teamId,
      title: "내 팀 일정",
    });
    const sameStart = await insert("2026-10-08", "10:00", {
      spaceId: actors.secondSpaceId,
    });
    await insert("2026-10-10", "10:00", {
      userId: actors.admin.userId,
      teamId: actors.teamId,
      title: "다른 사람 비공개 일정",
    });
    await insert("2026-10-11", "10:00", {
      status: "cancelled",
      cancelledAt: bookingNow,
      title: "취소 일정",
    });
    const result = await query().getMyBookingsMonth({
      month: "2026-10",
      day: "2026-10-08",
    });
    expect(result.bookings.map(({ id }) => id)).toEqual(
      [team.id, sameStart.id].sort().concat(personal.id),
    );
    expect(result.bookings.find(({ id }) => id === team.id)).toMatchObject({
      teamName: "그로스팀",
      title: "내 팀 일정",
      status: "confirmed",
      canCancel: true,
    });
    expect(
      result.bookings.find(({ id }) => id === personal.id)?.teamName,
    ).toBeNull();
    expect(JSON.stringify(result)).not.toContain("다른 사람 비공개 일정");
    expect(JSON.stringify(result)).not.toContain("취소 일정");
    expect(JSON.stringify(result)).not.toContain(actors.person.userId);
  });

  it("puts midnight-ending reservations in their local start month", async () => {
    const previous = await insert("2026-09-30", "23:30");
    const current = await insert("2026-10-31", "23:30");
    await insert("2026-11-01", "00:00");
    expect(
      (await query().getMyBookingsMonth({ month: "2026-10" })).bookings.map(
        ({ id }) => id,
      ),
    ).toEqual([current.id]);
    expect(
      (await query().getMyBookingsMonth({ month: "2026-09" })).bookings.map(
        ({ id }) => id,
      ),
    ).toEqual([previous.id]);
  });

  it("uses each booking branch's timezone at both UTC month boundaries", async () => {
    await database.db
      .update(branches)
      .set({ timezone: "Pacific/Kiritimati" })
      .where(eq(branches.id, actors.branchId));
    await database.db
      .update(branches)
      .set({ timezone: "Pacific/Honolulu" })
      .where(eq(branches.id, actors.otherBranchId));
    const first = await insert("2026-10-01", "00:00", {}, "Pacific/Kiritimati");
    await insert("2026-11-01", "00:00", {}, "Pacific/Kiritimati");
    const last = await insert(
      "2026-10-31",
      "23:30",
      { spaceId: actors.otherSpaceId },
      "Pacific/Honolulu",
    );
    await insert(
      "2026-09-30",
      "23:30",
      { spaceId: actors.otherSpaceId },
      "Pacific/Honolulu",
    );
    const result = await query().getMyBookingsMonth({ month: "2026-10" });
    expect(
      result.bookings.map(({ id, date, timezone }) => ({ id, date, timezone })),
    ).toEqual([
      { id: first.id, date: "2026-10-01", timezone: "Pacific/Kiritimati" },
      { id: last.id, date: "2026-10-31", timezone: "Pacific/Honolulu" },
    ]);
    expect(result.bookings[0]?.start).toBe("2026-09-30T10:00:00.000Z");
    expect(result.bookings[1]?.start).toBe("2026-11-01T09:30:00.000Z");
  });

  it("does not truncate an older month to the history list's 30-day or 50-row limits", async () => {
    const rows = Array.from({ length: 64 }, (_, index) => {
      const start = new Date(
        Date.parse("2026-04-10T00:00:00Z") + index * 30 * 60_000,
      );
      return {
        userId: actors.person.userId,
        spaceId: actors.publicSpaceId,
        during: { start, end: new Date(start.getTime() + 30 * 60_000) },
      };
    });
    await database.db.insert(bookings).values(rows);
    const result = await query().getMyBookingsMonth({ month: "2026-04" });
    expect(result.bookings).toHaveLength(64);
    expect(result.bookings.every(({ canCancel }) => !canCancel)).toBe(true);
    expect(result.previousHref).toBeNull();
  });

  it("allows March when the home-local today is December 31", async () => {
    const row = await insert("2027-03-01");
    const result = await query(
      actors.person,
      new Date("2026-12-31T03:00:00Z"),
    ).getMyBookingsMonth({ month: "2027-03", day: "2027-03-01" });
    expect(result.month).toBe("2027-03");
    expect(result.nextMonth).toBeNull();
    expect(result.bookings.map(({ id }) => id)).toEqual([row.id]);
  });

  it("computes cancellation from the exact injected end boundary independently of role permissions", async () => {
    await database.db.insert(roleSettings).values({
      branchId: actors.branchId,
      role: "user",
      permissions: defaultPermissions.user.filter(
        (permission) => permission !== "booking.own",
      ),
    });
    const now = new Date("2026-10-07T03:00:00Z");
    const ended = await insert("2026-10-07", "11:30");
    const active = await insert("2026-10-07", "12:00");
    const upcoming = await insert("2026-10-07", "13:00", {
      teamId: actors.teamId,
    });
    const result = await query(actors.person, now).getMyBookingsMonth();
    expect(
      result.bookings.map(({ id, canCancel }) => ({ id, canCancel })),
    ).toEqual([
      { id: ended.id, canCancel: false },
      { id: active.id, canCancel: true },
      { id: upcoming.id, canCancel: true },
    ]);
  });

  it("keeps the own-booking photo exception after access loss and does not read others' photos", async () => {
    await database.db.insert(spacePhotos).values([
      {
        spaceId: actors.restrictedSpaceId,
        path: "/seed/photos/meeting-large-clay.webp",
        alt: "예약한 회의실",
        sortOrder: 0,
      },
      {
        spaceId: actors.closedSpaceId,
        path: "/seed/photos/phone-booth-sage.webp",
        alt: "다른 사람의 공간",
        sortOrder: 0,
      },
    ]);
    const own = await insert("2026-10-08", "10:00", {
      spaceId: actors.restrictedSpaceId,
      userId: actors.member.userId,
      teamId: actors.teamId,
    });
    await insert("2026-10-08", "10:00", {
      spaceId: actors.closedSpaceId,
      userId: actors.admin.userId,
    });
    await database.db
      .delete(teamMembers)
      .where(eq(teamMembers.userId, actors.member.userId));
    await database.db
      .update(spaces)
      .set({ access: "closed" })
      .where(eq(spaces.id, actors.restrictedSpaceId));
    const result = await query(actors.member).getMyBookingsMonth();
    expect(result.bookings).toHaveLength(1);
    expect(result.bookings[0]).toMatchObject({
      id: own.id,
      canCancel: true,
      photo: {
        path: "/seed/photos/meeting-large-clay.webp",
        alt: "예약한 회의실",
      },
    });
    expect(Object.keys(result.bookings[0]!.photo!).sort()).toEqual([
      "alt",
      "path",
    ]);
    expect(JSON.stringify(result)).not.toContain("phone-booth-sage");
    await expect(
      query(actors.member).getSpaceDay(
        actors.branchId,
        actors.floorId,
        actors.restrictedSpaceId,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns null for a missing zero-order photo instead of selecting another photo", async () => {
    await database.db.insert(spacePhotos).values({
      spaceId: actors.publicSpaceId,
      path: "/seed/photos/meeting-large-clay.webp",
      alt: "두 번째 사진",
      sortOrder: 1,
    });
    await insert("2026-10-08");
    expect((await query().getMyBookingsMonth()).bookings[0]?.photo).toBeNull();
  });

  it("bounds its DAL read with explicit instants, owner and confirmed status and no row limit", async () => {
    const read = vi.spyOn(bookingDal, "listMyConfirmedBookingsBetween");
    const sql = vi.spyOn(database.client, "query");
    await query().getMyBookingsMonth({ month: "2026-10", day: "invalid" });
    expect(read).toHaveBeenCalledExactlyOnceWith(
      {
        userId: actors.person.userId,
        start: new Date("2026-09-30T00:00:00Z"),
        end: new Date("2026-11-02T00:00:00Z"),
      },
      database.db,
    );
    const [statement, parameters] = sql.mock.calls[1]!;
    expect(statement).toMatch(/"bookings"\."user_id" = \$\d+/);
    expect(statement).toMatch(/"bookings"\."status" = \$\d+/);
    expect(statement).not.toMatch(/limit|now\(\)/i);
    expect(parameters).toContain(actors.person.userId);
    expect(parameters).toContain("confirmed");
  });

  it("stays at two sequential single-statement reads with additional branches, floors and memberships", async () => {
    const meter = createQueryMeter(database.client);
    const expected = { stages: 2, statements: 2, perStage: [1, 1] };
    try {
      meter.start();
      await query().getMyBookingsMonth();
      expect(meter.stop()).toEqual(expected);
      const moreBranches = Array.from({ length: 8 }, (_, index) => ({
        id: crypto.randomUUID(),
        name: `달력 지점 ${index}`,
        timezone: index % 2 ? "America/Los_Angeles" : "Asia/Seoul",
      }));
      const moreFloors = moreBranches.map((branch) => ({
        id: crypto.randomUUID(),
        branchId: branch.id,
        name: "1F",
        level: 1,
      }));
      const moreSpaces = moreFloors.map((floor) => ({
        id: crypto.randomUUID(),
        floorId: floor.id,
        name: "가상 회의실",
        type: "meeting_room" as const,
      }));
      const moreTeams = moreBranches.map((branch, index) => ({
        id: crypto.randomUUID(),
        name: `달력 팀 ${index}`,
        homeBranchId: branch.id,
        createdBy: actors.person.userId,
      }));
      await database.db.insert(branches).values(moreBranches);
      await database.db.insert(floors).values(moreFloors);
      await database.db.insert(spaces).values(moreSpaces);
      await database.db.insert(teams).values(moreTeams);
      await database.db.insert(teamMembers).values(
        moreTeams.map((team) => ({
          teamId: team.id,
          userId: actors.person.userId,
        })),
      );
      for (const [index, space] of moreSpaces.entries())
        await insert(addDays("2026-10-08", index), "10:00", {
          spaceId: space.id,
        });
      meter.start();
      const result = await query().getMyBookingsMonth();
      expect(meter.stop()).toEqual(expected);
      expect(result.bookings).toHaveLength(8);
    } finally {
      meter.restore();
    }
  });
});

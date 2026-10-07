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
import type { Session } from "@/lib/auth/types";
import * as bookingDal from "@/lib/dal/bookings";
import * as spacesDal from "@/lib/dal/spaces";
import {
  bookings,
  roleSettings,
  spaceBlocks,
  teams,
  users,
} from "@/lib/db/schema";
import { defaultPermissions } from "@/lib/permissions/defaults";
import {
  bookingDate,
  bookingNow,
  bookingRange,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("booking query security and DTOs", () => {
  let database: TestDatabase;
  let fixture: BookingActors;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database?.client.close();
  });
  beforeEach(async () => {
    fixture = await seedBookingActors(database);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  function queries(session: Session = fixture.person) {
    return createBookingQueries({
      database: database.db,
      requireSession: async () => session,
      now: () => bookingNow,
    });
  }

  it("requires a session independently for every public query before reading invalid IDs", async () => {
    const requireSession = vi.fn(async (): Promise<Session> => {
      throw new ActionError("UNAUTHENTICATED");
    });
    const query = createBookingQueries({
      database: database.db,
      requireSession,
      now: () => bookingNow,
    });
    const calls = [
      () => query.getBranchList(),
      () => query.getBookingEntry(),
      () => query.getBranchFloors("invalid"),
      () => query.getBranchNavigation("invalid"),
      () => query.getFloorDay("invalid", "invalid"),
      () => query.getSpaceDay(fixture.branchId, fixture.floorId, "invalid"),
      () => query.getMyBookings(),
    ];
    for (const call of calls)
      await expect(call()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(requireSession).toHaveBeenCalledTimes(7);
  });

  it("never reads restricted room metadata or schedules and returns only its identity/type", async () => {
    const secret = await insertFixtureBooking(database, fixture, {
      spaceId: fixture.restrictedSpaceId,
      userId: fixture.member.userId,
      teamId: fixture.teamId,
      title: "비공개 전략 계획",
    });
    await database.db.insert(spaceBlocks).values({
      spaceId: fixture.restrictedSpaceId,
      during: bookingRange("14:00", "15:00"),
      createdBy: fixture.operator.userId,
      reason: "비공개 점검 이유",
    });
    const metadata = vi.spyOn(spacesDal, "getSpacesByIds");
    const schedule = vi.spyOn(bookingDal, "listSpaceBookings");
    const blocks = vi.spyOn(bookingDal, "listSpaceBlocks");
    const data = await queries().getFloorDay(
      fixture.branchId,
      fixture.floorId,
      bookingDate,
    );
    const encoded = JSON.stringify(data);
    for (const hidden of [
      "회의실 A",
      "비공개 전략 계획",
      "비공개 점검 이유",
      secret.id,
    ])
      expect(encoded).not.toContain(hidden);
    expect(
      data.spaces.find(({ id }) => id === fixture.restrictedSpaceId),
    ).toEqual({
      kind: "restricted",
      id: fixture.restrictedSpaceId,
      type: "meeting_room",
    });
    expect(metadata).toHaveBeenCalled();
    expect(schedule).toHaveBeenCalled();
    expect(blocks).toHaveBeenCalled();
    for (const [ids] of metadata.mock.calls)
      expect(ids).not.toContain(fixture.restrictedSpaceId);
    for (const [input] of [...schedule.mock.calls, ...blocks.mock.calls])
      expect(input.spaceIds).not.toContain(fixture.restrictedSpaceId);
  });

  it("shows room A and the restricted eighth floor only to an allowed team member", async () => {
    expect(
      JSON.stringify(
        await queries(fixture.member).getFloorDay(
          fixture.branchId,
          fixture.floorId,
          bookingDate,
        ),
      ),
    ).toContain("회의실 A");
    expect(
      (await queries().getBranchFloors(fixture.branchId)).floors.map(
        ({ id }) => id,
      ),
    ).toEqual([fixture.floorId]);
    expect(
      (
        await queries(fixture.member).getBranchFloors(fixture.branchId)
      ).floors.map(({ id }) => id),
    ).toEqual([fixture.floorId, fixture.restrictedFloorId]);
  });

  it("resolves uppercase branch, floor and space UUIDs to identical authorized DTOs", async () => {
    const query = queries(fixture.member);
    expect(await query.getBranchFloors(fixture.branchId.toUpperCase())).toEqual(
      await query.getBranchFloors(fixture.branchId),
    );
    expect(
      await query.getFloorDay(
        fixture.branchId.toUpperCase(),
        fixture.restrictedFloorId.toUpperCase(),
        bookingDate,
      ),
    ).toEqual(
      await query.getFloorDay(
        fixture.branchId,
        fixture.restrictedFloorId,
        bookingDate,
      ),
    );
    expect(
      await query.getSpaceDay(
        fixture.branchId,
        fixture.floorId,
        fixture.restrictedSpaceId.toUpperCase(),
        bookingDate,
      ),
    ).toEqual(
      await query.getSpaceDay(
        fixture.branchId,
        fixture.floorId,
        fixture.restrictedSpaceId,
        bookingDate,
      ),
    );
  });

  it("excludes archived rooms and individual desks but reports a desk area's seat count", async () => {
    const data = await queries().getFloorDay(
      fixture.branchId,
      fixture.floorId,
      bookingDate,
    );
    for (const id of [
      fixture.archivedSpaceId,
      fixture.deskId,
      fixture.otherDeskId,
    ])
      expect(data.spaces.map((space) => space.id)).not.toContain(id);
    expect(
      data.spaces.find(({ id }) => id === fixture.deskAreaId),
    ).toMatchObject({ kind: "accessible", bookable: false, deskCount: 2 });
  });

  it("returns NOT_FOUND for an inaccessible floor or room", async () => {
    await expect(
      queries().getFloorDay(
        fixture.branchId,
        fixture.restrictedFloorId,
        bookingDate,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      queries().getSpaceDay(
        fixture.branchId,
        fixture.floorId,
        fixture.restrictedSpaceId,
        bookingDate,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      queries().getSpaceDay(
        fixture.branchId,
        fixture.floorId,
        fixture.archivedSpaceId,
        bookingDate,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      queries().getSpaceDay(
        fixture.branchId,
        fixture.floorId,
        fixture.deskId,
        bookingDate,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("uses the floor's real branch and rejects a forged branch ID even for that branch's operator", async () => {
    await expect(
      queries(fixture.otherOperator).getFloorDay(
        fixture.otherBranchId,
        fixture.floorId,
        bookingDate,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      queries(fixture.operator).getFloorDay(
        fixture.otherBranchId,
        fixture.floorId,
        bookingDate,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects forged space parents before reading metadata, schedules or private titles", async () => {
    const metadata = vi.spyOn(spacesDal, "getSpacesByIds");
    const schedule = vi.spyOn(bookingDal, "listSpaceBookings");
    const blocks = vi.spyOn(bookingDal, "listSpaceBlocks");
    for (const [branchId, floorId, spaceId] of [
      [fixture.otherBranchId, fixture.floorId, fixture.publicSpaceId],
      [fixture.branchId, fixture.otherFloorId, fixture.otherSpaceId],
      [fixture.branchId, fixture.floorId, fixture.restrictedFloorSpaceId],
      [fixture.branchId, fixture.floorId, fixture.otherSpaceId],
    ] as const) {
      await expect(
        queries(fixture.operator).getSpaceDay(branchId, floorId, spaceId),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect(metadata).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    expect(blocks).not.toHaveBeenCalled();
  });

  it("does not select booking titles or actor names to compute floor counts and status", async () => {
    await insertFixtureBooking(database, fixture, {
      title: "합계에 필요하지 않은 제목",
    });
    const statements = vi.spyOn(database.client, "query");
    await queries().getFloorDay(fixture.branchId, fixture.floorId, bookingDate);
    const schedule = statements.mock.calls
      .map(([query]) => query)
      .find((query) => query.includes('from "bookings"'));
    expect(schedule).toBeDefined();
    expect(schedule).not.toMatch(/"title"|"name"|join "users"|join "teams"/);
    expect(schedule).toMatch(/"during"/);
  });

  it("returns only accessible navigation floors and server-owned time in the branch timezone", async () => {
    const data = await queries().getBranchNavigation(fixture.branchId);
    expect(data).toEqual({
      branch: {
        id: fixture.branchId,
        name: "강남점",
        address: "가상로 7",
        timezone: "Asia/Seoul",
        openHours: { sun: null },
      },
      floors: [{ id: fixture.floorId, name: "7F", level: 7, sortOrder: 1 }],
      branches: [
        { id: fixture.branchId, name: "강남점" },
        { id: fixture.otherBranchId, name: "서초점" },
      ],
      today: bookingDate,
      now: bookingNow.toISOString(),
    });
    expect(
      await queries().getBranchNavigation(fixture.branchId.toUpperCase()),
    ).toEqual(data);
    await expect(
      queries().getBranchNavigation(crypto.randomUUID()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns no floors and hides direct floor/space reads if floor.view is disabled", async () => {
    await database.db.insert(roleSettings).values({
      branchId: fixture.branchId,
      role: "user",
      permissions: defaultPermissions.user.filter(
        (key) => key !== "floor.view",
      ),
    });
    expect((await queries().getBranchFloors(fixture.branchId)).floors).toEqual(
      [],
    );
    await expect(
      queries().getFloorDay(fixture.branchId, fixture.floorId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      queries().getSpaceDay(
        fixture.branchId,
        fixture.floorId,
        fixture.publicSpaceId,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it.each(["bad-id", "\u0000", "00000000-0000-4000-8000-000000000000"])(
    "hides invalid/missing resource IDs: %j",
    async (id) => {
      await expect(queries().getBranchFloors(id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(
        queries().getFloorDay(fixture.branchId, id),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        queries().getSpaceDay(fixture.branchId, fixture.floorId, id),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    },
  );

  it("omits strangers' title keys entirely while retaining time and a booker name", async () => {
    const row = await insertFixtureBooking(database, fixture, {
      userId: fixture.stranger.userId,
      title: "개인 비공개 제목",
    });
    const data = await queries().getSpaceDay(
      fixture.branchId,
      fixture.floorId,
      fixture.publicSpaceId,
      bookingDate,
    );
    expect(JSON.stringify(data)).not.toContain("개인 비공개 제목");
    expect(data.bookings[0]).toEqual({
      id: row.id,
      start: row.during.start.toISOString(),
      end: row.during.end.toISOString(),
      bookerName: fixture.stranger.name,
      isMine: false,
      canCancel: false,
    });
    expect(Object.hasOwn(data.bookings[0]!, "title")).toBe(false);
    expect(data.space.status).toBe("busy");
  });

  it("reveals team titles to teammates, cancellation only to admins, and no title to other teams", async () => {
    await insertFixtureBooking(database, fixture, {
      userId: fixture.admin.userId,
      teamId: fixture.teamId,
      title: "그로스팀 전용 제목",
    });
    const member = await queries(fixture.member).getSpaceDay(
      fixture.branchId,
      fixture.floorId,
      fixture.publicSpaceId,
      bookingDate,
    );
    expect(member.bookings[0]).toMatchObject({
      title: "그로스팀 전용 제목",
      bookerName: "그로스팀",
      isMine: true,
      canCancel: false,
    });
    expect(member.space.status).toBe("mine");
    expect(
      (
        await queries(fixture.admin).getSpaceDay(
          fixture.branchId,
          fixture.floorId,
          fixture.publicSpaceId,
          bookingDate,
        )
      ).bookings[0]?.canCancel,
    ).toBe(true);
    expect(
      Object.hasOwn(
        (
          await queries(fixture.otherMember).getSpaceDay(
            fixture.branchId,
            fixture.floorId,
            fixture.publicSpaceId,
            bookingDate,
          )
        ).bookings[0]!,
        "title",
      ),
    ).toBe(false);
  });

  it("reveals an owner's own title and all titles only to the actual branch operator", async () => {
    await insertFixtureBooking(database, fixture, { title: "내 개인 제목" });
    expect(
      (
        await queries().getSpaceDay(
          fixture.branchId,
          fixture.floorId,
          fixture.publicSpaceId,
        )
      ).bookings[0],
    ).toMatchObject({ title: "내 개인 제목", isMine: true, canCancel: true });
    expect(
      (
        await queries(fixture.operator).getSpaceDay(
          fixture.branchId,
          fixture.floorId,
          fixture.publicSpaceId,
        )
      ).bookings[0],
    ).toMatchObject({ title: "내 개인 제목", canCancel: true });
    expect(
      Object.hasOwn(
        (
          await queries(fixture.otherOperator).getSpaceDay(
            fixture.branchId,
            fixture.floorId,
            fixture.publicSpaceId,
          )
        ).bookings[0]!,
        "title",
      ),
    ).toBe(false);
  });

  it("counts only confirmed daily bookings, prioritizes maintenance, and hides status on future dates", async () => {
    await insertFixtureBooking(database, fixture);
    await insertFixtureBooking(database, fixture, {
      status: "cancelled",
      cancelledAt: bookingNow,
    });
    await database.db.insert(spaceBlocks).values({
      spaceId: fixture.publicSpaceId,
      during: bookingRange(),
      createdBy: fixture.operator.userId,
    });
    const today = await queries().getFloorDay(
      fixture.branchId,
      fixture.floorId,
      bookingDate,
    );
    expect(
      today.spaces.find(({ id }) => id === fixture.publicSpaceId),
    ).toMatchObject({ bookingCount: 1, status: "maintenance" });
    const future = await queries().getFloorDay(
      fixture.branchId,
      fixture.floorId,
      "2026-10-08",
    );
    expect(future.isToday).toBe(false);
    for (const space of future.spaces)
      if (space.kind === "accessible") expect(space.status).toBeNull();
  });

  it("uses today's branch date for malformed, past and out-of-range dates", async () => {
    for (const value of [
      undefined,
      "not-a-date",
      "2026-02-30",
      "2026-10-06",
      "2026-12-07",
      [bookingDate],
    ]) {
      expect(
        (await queries().getFloorDay(fixture.branchId, fixture.floorId, value))
          .date,
      ).toBe(bookingDate);
    }
    expect(
      (
        await queries().getFloorDay(
          fixture.branchId,
          fixture.floorId,
          "2026-12-06",
        )
      ).date,
    ).toBe("2026-12-06");
  });

  it("returns exact personal/team modes with branch limits and remaining team usage", async () => {
    await insertFixtureBooking(database, fixture, {
      userId: fixture.admin.userId,
      teamId: fixture.teamId,
    });
    const common = await queries(fixture.member).getSpaceDay(
      fixture.branchId,
      fixture.floorId,
      fixture.publicSpaceId,
    );
    expect(common.hasTeams).toBe(true);
    expect(common.actors.map(({ teamId }) => teamId)).toEqual([
      null,
      fixture.teamId,
      fixture.otherTeamId,
    ]);
    expect(
      common.actors.find(({ teamId }) => teamId === fixture.teamId),
    ).toMatchObject({
      remainingMinutes: 420,
      limits: {
        maxMinutesPerBooking: 240,
        maxMinutesPerDay: 480,
        maxDaysAhead: 14,
      },
    });
    expect(
      (
        await queries(fixture.member).getSpaceDay(
          fixture.branchId,
          fixture.floorId,
          fixture.restrictedSpaceId,
        )
      ).actors.map(({ teamId }) => teamId),
    ).toEqual([fixture.teamId]);
    expect(
      (
        await queries().getSpaceDay(
          fixture.branchId,
          fixture.floorId,
          fixture.publicSpaceId,
        )
      ).hasTeams,
    ).toBe(false);
  });

  it("selects entry by user default, alphabetical team home branch, or null", async () => {
    expect(await queries().getBookingEntry()).toBeNull();
    expect(await queries(fixture.member).getBookingEntry()).toBe(
      fixture.branchId,
    );
    await database.db
      .update(teams)
      .set({ homeBranchId: null })
      .where(eq(teams.id, fixture.teamId));
    expect(await queries(fixture.member).getBookingEntry()).toBe(
      fixture.otherBranchId,
    );
    await database.db
      .update(users)
      .set({ defaultBranchId: fixture.branchId })
      .where(eq(users.id, fixture.member.userId));
    expect(await queries(fixture.member).getBookingEntry()).toBe(
      fixture.branchId,
    );
  });

  it("batches usage totals without mixing personal users, teams, branches, cancelled rows or dates", async () => {
    await insertFixtureBooking(database, fixture, {
      userId: fixture.member.userId,
    });
    await insertFixtureBooking(database, fixture, {
      userId: fixture.stranger.userId,
      during: bookingRange("13:00", "14:00"),
    });
    await insertFixtureBooking(database, fixture, {
      userId: fixture.admin.userId,
      teamId: fixture.teamId,
      during: bookingRange("14:00", "15:00"),
    });
    await insertFixtureBooking(database, fixture, {
      userId: fixture.otherMember.userId,
      teamId: fixture.otherTeamId,
      during: bookingRange("15:00", "16:00"),
    });
    await insertFixtureBooking(database, fixture, {
      userId: fixture.admin.userId,
      teamId: fixture.teamId,
      status: "cancelled",
      cancelledAt: bookingNow,
    });
    await insertFixtureBooking(database, fixture, {
      spaceId: fixture.otherSpaceId,
      userId: fixture.admin.userId,
      teamId: fixture.teamId,
    });
    await insertFixtureBooking(database, fixture, {
      userId: fixture.admin.userId,
      teamId: fixture.teamId,
      during: bookingRange("12:00", "13:00", "2026-10-08"),
    });
    const data = await queries(fixture.member).getSpaceDay(
      fixture.branchId,
      fixture.floorId,
      fixture.publicSpaceId,
      bookingDate,
    );
    expect(
      data.actors.map(({ teamId, remainingMinutes }) => ({
        teamId,
        remainingMinutes,
      })),
    ).toEqual([
      { teamId: null, remainingMinutes: 60 },
      { teamId: fixture.teamId, remainingMinutes: 420 },
      { teamId: fixture.otherTeamId, remainingMinutes: 420 },
    ]);
  });

  it("keeps a team's actual booking-mode name even without a home branch", async () => {
    await database.db
      .update(teams)
      .set({ homeBranchId: null })
      .where(eq(teams.id, fixture.teamId));
    const data = await queries(fixture.member).getSpaceDay(
      fixture.branchId,
      fixture.floorId,
      fixture.publicSpaceId,
    );
    expect(
      data.actors.find(({ teamId }) => teamId === fixture.teamId)?.name,
    ).toBe("그로스팀으로");
    expect(await queries(fixture.member).getBookingEntry()).toBe(
      fixture.otherBranchId,
    );
  });

  it("puts the default branch first and returns only intended branch fields and today's hours", async () => {
    await database.db
      .update(users)
      .set({ defaultBranchId: fixture.otherBranchId })
      .where(eq(users.id, fixture.person.userId));
    const list = await queries().getBranchList();
    expect(list[0]).toEqual({
      id: fixture.otherBranchId,
      name: "서초점",
      address: "가상로 8",
      timezone: "Asia/Seoul",
      openHours: {},
      isDefault: true,
      todayHours: { open: "09:00", close: "22:00" },
      accessibleFloorCount: 1,
      freeSpaceCount: 1,
      operatingState: {
        status: "open",
        date: bookingDate,
        hours: { open: "09:00", close: "22:00" },
        window: {
          start: "2026-10-07T00:00:00.000Z",
          end: "2026-10-07T13:00:00.000Z",
        },
        nextOpening: null,
      },
    });
    expect(list[1]?.isDefault).toBe(false);
  });

  it("splits own upcoming/past reservations, includes cancelled rows and excludes other bookers", async () => {
    const current = await insertFixtureBooking(database, fixture, {
      title: "진행 중",
    });
    const upcoming = await insertFixtureBooking(database, fixture, {
      during: bookingRange("14:00", "15:00"),
      title: "다가오는 예약",
    });
    const ended = await insertFixtureBooking(database, fixture, {
      during: bookingRange("10:00", "11:00"),
      title: "지난 예약",
    });
    const cancelled = await insertFixtureBooking(database, fixture, {
      during: bookingRange("16:00", "17:00"),
      status: "cancelled",
      cancelledAt: bookingNow,
      cancelledBy: fixture.person.userId,
    });
    await insertFixtureBooking(database, fixture, {
      spaceId: fixture.secondSpaceId,
      userId: fixture.stranger.userId,
      title: "다른 사람 예약",
    });
    await insertFixtureBooking(database, fixture, {
      during: bookingRange("12:00", "13:00", "2026-09-06"),
      title: "31일 전",
    });
    const data = await queries().getMyBookings();
    expect(data.upcoming.map(({ id }) => id)).toEqual([
      current.id,
      upcoming.id,
    ]);
    expect(data.past.map(({ id }) => id)).toEqual([cancelled.id, ended.id]);
    expect(data.past[0]).toMatchObject({
      status: "cancelled",
      cancelledAt: bookingNow.toISOString(),
    });
    expect(data.upcoming[0]).toMatchObject({
      branchId: fixture.branchId,
      floorId: fixture.floorId,
      spaceId: fixture.publicSpaceId,
      timezone: "Asia/Seoul",
      date: bookingDate,
    });
    expect(JSON.stringify(data)).not.toContain("다른 사람 예약");
    expect(JSON.stringify(data)).not.toContain("31일 전");
  });

  it("caps historical reservations at the latest 50 and includes the 30-day boundary", async () => {
    const day = bookingRange("12:00", "13:00", "2026-09-07");
    await database.db.insert(bookings).values(
      Array.from({ length: 51 }, (_, index) => ({
        spaceId: fixture.publicSpaceId,
        userId: fixture.person.userId,
        during: {
          start: new Date(day.start.getTime() + index * 60_000),
          end: new Date(day.end.getTime() + index * 60_000),
        },
        status: "cancelled" as const,
        cancelledAt: bookingNow,
        title: `지난 예약 ${index}`,
      })),
    );
    const data = await queries().getMyBookings();
    expect(data.past).toHaveLength(50);
    expect(data.past[0]?.title).toBe("지난 예약 50");
    expect(data.past[49]?.title).toBe("지난 예약 1");
  });
});

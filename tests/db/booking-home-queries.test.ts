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
import * as spaceDal from "@/lib/dal/spaces";
import {
  branches,
  floors,
  roleSettings,
  spaceBlocks,
  spaces,
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

describe("home and branch booking discovery", () => {
  let database: TestDatabase;
  let fixture: BookingActors;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    fixture = await seedBookingActors(database);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const queries = (session = fixture.person, now = bookingNow) =>
    createBookingQueries({
      database: database.db,
      requireSession: async () => session,
      now: () => now,
    });
  const selectBranch = (
    userId = fixture.person.userId,
    branchId = fixture.branchId,
  ) =>
    database.db
      .update(users)
      .set({ defaultBranchId: branchId })
      .where(eq(users.id, userId));

  it("checks the session before all five new reads without issuing SQL", async () => {
    const read = vi.spyOn(database.client, "query");
    const query = createBookingQueries({
      database: database.db,
      requireSession: async (): Promise<Session> => {
        throw new ActionError("UNAUTHENTICATED");
      },
    });
    for (const call of [
      query.getHomeHeader,
      query.getHomeUpcomingBookings,
      query.getHomeFreeSpaces,
      query.getHomeBookingLimits,
      query.getBookingDestination,
    ]) {
      await expect(call()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("returns a branchless home and Seoul date without inventing a branch", async () => {
    const query = queries(fixture.person, new Date("2026-10-07T16:00:00Z"));
    expect(await query.getHomeHeader()).toEqual({
      name: "김하은",
      now: "2026-10-07T16:00:00.000Z",
      date: "2026-10-08",
      branch: null,
      operatingState: null,
    });
    expect(await query.getHomeFreeSpaces()).toMatchObject({
      state: "no_branch",
      spaces: [],
      totalCount: 0,
      freeCount: 0,
    });
    expect(await query.getHomeBookingLimits()).toBeNull();
    expect(await query.getBookingDestination()).toBe("/branches");
  });

  it("uses the same team-name fallback and explicit default for every home card and destination", async () => {
    const query = queries(fixture.member);
    expect(await query.getBookingEntry()).toBe(fixture.branchId);
    expect((await query.getHomeHeader()).branch?.id).toBe(fixture.branchId);
    expect((await query.getHomeFreeSpaces()).branch?.id).toBe(fixture.branchId);
    expect((await query.getHomeBookingLimits())?.branch.id).toBe(
      fixture.branchId,
    );
    expect(await query.getBookingDestination()).toBe(
      `/branches/${fixture.branchId}/floors/${fixture.floorId}`,
    );
    await selectBranch(fixture.member.userId, fixture.otherBranchId);
    expect((await query.getHomeHeader()).branch?.id).toBe(
      fixture.otherBranchId,
    );
    expect((await query.getHomeFreeSpaces()).branch?.id).toBe(
      fixture.otherBranchId,
    );
    expect((await query.getHomeBookingLimits())?.branch.id).toBe(
      fixture.otherBranchId,
    );
    expect(await query.getBookingDestination()).toBe(
      `/branches/${fixture.otherBranchId}/floors/${fixture.otherFloorId}`,
    );
    await database.db
      .update(teams)
      .set({ homeBranchId: null })
      .where(eq(teams.id, fixture.teamId));
    await database.db
      .update(users)
      .set({ defaultBranchId: null })
      .where(eq(users.id, fixture.member.userId));
    expect(await query.getBookingEntry()).toBe(fixture.otherBranchId);
  });

  it("reports no accessible floors and redirects to the branch when scope denies every floor", async () => {
    await selectBranch();
    await database.db
      .update(floors)
      .set({ access: "closed" })
      .where(eq(floors.id, fixture.floorId));
    expect(await queries().getHomeFreeSpaces()).toMatchObject({
      state: "no_floors",
      spaces: [],
      totalCount: 0,
    });
    expect(await queries().getBookingDestination()).toBe(
      `/branches/${fixture.branchId}`,
    );
    expect(
      (await queries().getBranchList()).find(
        ({ id }) => id === fixture.branchId,
      ),
    ).toMatchObject({ accessibleFloorCount: 0, freeSpaceCount: 0 });
  });

  it.each(["floor", "space"] as const)(
    "does not count a restricted %s even when its schedule changes",
    async (scope) => {
      await selectBranch();
      const hiddenId =
        scope === "floor"
          ? fixture.restrictedFloorSpaceId
          : fixture.restrictedSpaceId;
      const metadata = vi.spyOn(spaceDal, "getSpacesByIds");
      const schedule = vi.spyOn(bookingDal, "listSpaceBookings");
      const blocks = vi.spyOn(bookingDal, "listSpaceBlocks");
      const before = await queries().getHomeFreeSpaces();
      const branchBefore = await queries().getBranchList();
      await insertFixtureBooking(database, fixture, {
        spaceId: hiddenId,
        userId: fixture.member.userId,
        teamId: fixture.teamId,
        title: "비공개 예약 제목",
      });
      await database.db
        .insert(spaceBlocks)
        .values({
          spaceId: hiddenId,
          during: bookingRange("13:00", "14:00"),
          createdBy: fixture.operator.userId,
          reason: "비공개 점검",
        });
      const after = await queries().getHomeFreeSpaces();
      const branchAfter = await queries().getBranchList();
      expect(after).toEqual(before);
      expect(branchAfter).toEqual(branchBefore);
      expect(before).toMatchObject({
        state: "ready",
        totalCount: 2,
        freeCount: 2,
      });
      for (const hidden of [
        "회의실 A",
        "8층 비공개 공간",
        "비공개 예약 제목",
        "비공개 점검",
        "닫힌 공간 비공개",
        "보관한 공간",
      ]) {
        expect(JSON.stringify([after, branchAfter])).not.toContain(hidden);
      }
      for (const [ids] of metadata.mock.calls)
        expect(ids).not.toContain(hiddenId);
      for (const [input] of [...schedule.mock.calls, ...blocks.mock.calls])
        expect(input.spaceIds).not.toContain(hiddenId);
      for (const [input] of schedule.mock.calls)
        expect(input).toHaveProperty("summaryOnly", true);
    },
  );

  it("reads no room names, booking titles or booker names while counting branches", async () => {
    const query = vi.spyOn(database.client, "query");
    await queries().getBranchList();
    const sql = query.mock.calls.map(([statement]) => statement).join("\n");
    expect(sql).not.toContain('"spaces"."name"');
    expect(sql).not.toContain('"bookings"."title"');
    expect(sql).not.toContain('"users"."name"');
  });

  it("counts only active, bookable non-seat spaces and respects current half-open boundaries", async () => {
    await selectBranch();
    await insertFixtureBooking(database, fixture, {
      during: bookingRange("11:00", "12:00"),
    });
    await insertFixtureBooking(database, fixture, {
      during: bookingRange("13:00", "14:00"),
    });
    await database.db
      .insert(spaceBlocks)
      .values({
        spaceId: fixture.secondSpaceId,
        during: bookingRange("12:00", "13:00"),
        createdBy: fixture.operator.userId,
      });
    const now = new Date("2026-10-07T03:00:00Z");
    expect(
      await queries(fixture.person, now).getHomeFreeSpaces(),
    ).toMatchObject({
      totalCount: 2,
      freeCount: 1,
      spaces: [
        { id: fixture.publicSpaceId, freeUntil: "2026-10-07T04:00:00.000Z" },
      ],
    });
    expect(
      (await queries(fixture.person, now).getBranchList()).find(
        ({ id }) => id === fixture.branchId,
      )?.freeSpaceCount,
    ).toBe(1);
  });

  it("sorts by free duration then floor order then name, caps four but retains complete counts", async () => {
    await selectBranch();
    await database.db
      .insert(spaces)
      .values(
        ["가", "나", "다", "라", "마"].map((name) => ({
          floorId: fixture.floorId,
          type: "phone_booth" as const,
          name,
        })),
      );
    await insertFixtureBooking(database, fixture, {
      during: bookingRange("14:00", "15:00"),
    });
    const data = await queries().getHomeFreeSpaces();
    expect(data).toMatchObject({ totalCount: 7, freeCount: 7 });
    expect(data.spaces.map(({ name }) => name)).toEqual([
      "가",
      "나",
      "다",
      "라",
    ]);
    expect(
      data.spaces.every(
        ({ freeUntil }) => freeUntil === "2026-10-07T13:00:00.000Z",
      ),
    ).toBe(true);
  });

  it("treats both own and other active bookings as occupied", async () => {
    await selectBranch();
    await insertFixtureBooking(database, fixture);
    await insertFixtureBooking(database, fixture, {
      spaceId: fixture.secondSpaceId,
      userId: fixture.stranger.userId,
    });
    expect(await queries().getHomeFreeSpaces()).toMatchObject({
      state: "ready",
      totalCount: 2,
      freeCount: 0,
      spaces: [],
    });
    expect(
      (await queries().getBranchList()).find(
        ({ id }) => id === fixture.branchId,
      )?.freeSpaceCount,
    ).toBe(0);
  });

  it.each([
    "2026-10-06T23:00:00Z",
    "2026-10-07T13:00:00Z",
    "2026-10-11T03:00:00Z",
  ])(
    "hides current free counts outside branch hours at %s",
    async (instant) => {
      await selectBranch();
      const metadata = vi.spyOn(spaceDal, "getSpacesByIds");
      const query = queries(fixture.person, new Date(instant));
      expect(await query.getHomeFreeSpaces()).toMatchObject({
        state: "outside_hours",
        spaces: [],
      });
      expect(
        (await query.getBranchList()).find(({ id }) => id === fixture.branchId)
          ?.freeSpaceCount,
      ).toBeNull();
      expect(metadata).not.toHaveBeenCalled();
    },
  );

  it("returns no next opening for a branch closed every day", async () => {
    await selectBranch();
    await database.db
      .update(branches)
      .set({
        openHours: {
          mon: null,
          tue: null,
          wed: null,
          thu: null,
          fri: null,
          sat: null,
          sun: null,
        },
      })
      .where(eq(branches.id, fixture.branchId));
    expect(await queries().getHomeFreeSpaces()).toMatchObject({
      state: "outside_hours",
      operatingState: { status: "closed", nextOpening: null },
    });
  });

  it("uses each branch timezone at midnight instead of the host timezone", async () => {
    await selectBranch();
    await database.db
      .update(branches)
      .set({
        timezone: "America/Los_Angeles",
        openHours: { tue: { open: "00:00", close: "23:30" } },
      })
      .where(eq(branches.id, fixture.branchId));
    const query = queries(fixture.person, new Date("2026-10-07T01:00:00Z"));
    expect(await query.getHomeHeader()).toMatchObject({
      date: "2026-10-06",
      operatingState: { status: "open" },
    });
    expect(await query.getHomeFreeSpaces()).toMatchObject({
      date: "2026-10-06",
      state: "ready",
    });
    expect(await query.getHomeBookingLimits()).toMatchObject({
      date: "2026-10-06",
    });
  });

  it("returns the earliest three own confirmed unended bookings across branches", async () => {
    const ongoing = await insertFixtureBooking(database, fixture);
    const second = await insertFixtureBooking(database, fixture, {
      spaceId: fixture.otherSpaceId,
      during: bookingRange("13:00", "14:00"),
      title: "내 예약",
    });
    const third = await insertFixtureBooking(database, fixture, {
      during: bookingRange("14:00", "15:00"),
    });
    await insertFixtureBooking(database, fixture, {
      during: bookingRange("15:00", "16:00"),
    });
    await insertFixtureBooking(database, fixture, {
      during: bookingRange("09:00", "10:00"),
    });
    await insertFixtureBooking(database, fixture, {
      spaceId: fixture.secondSpaceId,
      userId: fixture.stranger.userId,
      title: "남의 예약",
    });
    await insertFixtureBooking(database, fixture, {
      during: bookingRange("13:00", "14:00"),
      status: "cancelled",
      cancelledAt: bookingNow,
    });
    const result = await queries().getHomeUpcomingBookings();
    expect(result.bookings.map(({ id }) => id)).toEqual([
      ongoing.id,
      second.id,
      third.id,
    ]);
    expect(result.bookings[1]).toMatchObject({
      branchId: fixture.otherBranchId,
      title: "내 예약",
    });
    expect(JSON.stringify(result)).not.toContain("남의 예약");
  });

  it("calculates personal usage only in the selected branch and ignores team, cancelled and other-day bookings", async () => {
    await selectBranch(fixture.member.userId);
    await insertFixtureBooking(database, fixture, {
      userId: fixture.member.userId,
      during: bookingRange("09:00", "10:00"),
    });
    await insertFixtureBooking(database, fixture, {
      userId: fixture.member.userId,
      teamId: fixture.teamId,
    });
    await insertFixtureBooking(database, fixture, {
      userId: fixture.member.userId,
      spaceId: fixture.otherSpaceId,
    });
    await insertFixtureBooking(database, fixture, {
      userId: fixture.member.userId,
      during: bookingRange("14:00", "15:00"),
      status: "cancelled",
      cancelledAt: bookingNow,
    });
    await insertFixtureBooking(database, fixture, {
      userId: fixture.member.userId,
      during: bookingRange("12:00", "13:00", "2026-10-08"),
    });
    expect(await queries(fixture.member).getHomeBookingLimits()).toMatchObject({
      limitMinutes: 120,
      usedMinutes: 60,
      remainingMinutes: 60,
    });
  });

  it("uses role overrides and clamps exhausted personal minutes to zero", async () => {
    await selectBranch();
    await database.db
      .insert(roleSettings)
      .values({
        branchId: fixture.branchId,
        role: "user",
        permissions: [...defaultPermissions.user],
        limits: { maxMinutesPerDay: 30 },
      });
    await insertFixtureBooking(database, fixture);
    expect(await queries().getHomeBookingLimits()).toMatchObject({
      limitMinutes: 30,
      usedMinutes: 60,
      remainingMinutes: 0,
    });
  });

  it("omits limits when personal permission is absent or the scoped operator limit is unlimited", async () => {
    await selectBranch();
    await selectBranch(fixture.operator.userId);
    expect(await queries(fixture.operator).getHomeBookingLimits()).toBeNull();
    await database.db
      .insert(roleSettings)
      .values({
        branchId: fixture.branchId,
        role: "user",
        permissions: ["floor.view"],
      });
    expect(await queries().getHomeBookingLimits()).toBeNull();
    await selectBranch(fixture.operator.userId, fixture.otherBranchId);
    expect(
      await queries(fixture.operator).getHomeBookingLimits(),
    ).toMatchObject({ limitMinutes: 120 });
  });

  it("applies floor.view role overrides before reading room metadata or schedules", async () => {
    await selectBranch();
    await database.db
      .insert(roleSettings)
      .values({ branchId: fixture.branchId, role: "user", permissions: [] });
    const metadata = vi.spyOn(spaceDal, "getSpacesByIds");
    expect(await queries().getHomeFreeSpaces()).toMatchObject({
      state: "no_floors",
    });
    expect(
      (await queries().getBranchList()).find(
        ({ id }) => id === fixture.branchId,
      ),
    ).toMatchObject({ accessibleFloorCount: 0, freeSpaceCount: 0 });
    expect(metadata).not.toHaveBeenCalled();
  });

  it("adds only anonymous intervals and safe grouped counts to floor listings", async () => {
    await insertFixtureBooking(database, fixture, {
      userId: fixture.stranger.userId,
      title: "이름 없이 일정만",
    });
    await insertFixtureBooking(database, fixture, {
      spaceId: fixture.restrictedSpaceId,
      userId: fixture.member.userId,
      teamId: fixture.teamId,
    });
    const result = await queries().getFloorDay(
      fixture.branchId,
      fixture.floorId,
      bookingDate,
    );
    const room = result.spaces.find(({ id }) => id === fixture.publicSpaceId);
    expect(room).toMatchObject({
      intervals: [
        {
          start: "2026-10-07T03:00:00.000Z",
          end: "2026-10-07T04:00:00.000Z",
          kind: "other",
        },
      ],
      summary: { status: "busy" },
    });
    expect(result.groups.find(({ type }) => type === "meeting_room")).toEqual({
      type: "meeting_room",
      totalCount: 2,
      freeCount: 0,
    });
    expect(
      result.spaces
        .filter(({ type }) => type === "meeting_room")
        .map(({ kind }) => kind),
    ).toEqual(["accessible", "restricted"]);
    expect(
      result.spaces.find(({ id }) => id === fixture.restrictedSpaceId),
    ).toEqual({
      id: fixture.restrictedSpaceId,
      kind: "restricted",
      type: "meeting_room",
    });
    expect(
      result.spaces.find(({ id }) => id === fixture.deskAreaId),
    ).toMatchObject({ intervals: [], summary: null });
    for (const hidden of [
      "이름 없이 일정만",
      fixture.stranger.name,
      "회의실 A",
    ])
      expect(JSON.stringify(result)).not.toContain(hidden);
    if (room?.kind !== "accessible")
      throw new Error("Missing accessible room.");
    expect(Object.keys(room.intervals[0] ?? {}).sort()).toEqual([
      "end",
      "kind",
      "start",
    ]);
  });

  it("does not report now summaries or free counts for a future day", async () => {
    const result = await queries().getFloorDay(
      fixture.branchId,
      fixture.floorId,
      "2026-10-08",
    );
    expect(result.groups.every(({ freeCount }) => freeCount === null)).toBe(
      true,
    );
    expect(
      result.spaces
        .filter((space) => space.kind === "accessible")
        .every(({ summary }) => summary === null),
    ).toBe(true);
  });
});

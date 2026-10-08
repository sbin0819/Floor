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
import { eq } from "drizzle-orm";
import { createTeamQueries } from "@/features/teams/query-factory";
import { ActionError } from "@/lib/actions/result";
import type { Session } from "@/lib/auth/types";
import { loadPermissionContext } from "@/lib/permissions/context";
import { createTeamSpace } from "@/lib/dal/chat-write";
import * as manageDal from "@/lib/dal/teams-management-read";
import {
  bookings,
  bookingParticipants,
  branches,
  floors,
  roleSettings,
  spaces,
  teamInvites,
  teamJoinRequests,
  teamMembers,
  teams,
  users,
} from "@/lib/db/schema";
import { avatarColorFor } from "@/lib/avatar";
import { createTestDatabase, type TestDatabase } from "./helper";
import {
  bookingNow,
  bookingRange,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createQueryMeter } from "./query-meter";

describe("team management read permissions, privacy and budgets", () => {
  let database: TestDatabase;
  let actors: BookingActors;
  let meter: ReturnType<typeof createQueryMeter>;
  beforeAll(async () => {
    database = await createTestDatabase();
    meter = createQueryMeter(database.client);
  });
  beforeEach(async () => {
    actors = await seedBookingActors(database);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    meter.restore();
    await database.client.close();
  });
  const queries = (session: Session = actors.member) =>
    createTeamQueries({
      database: database.db,
      requireSession: async () => session,
      now: () => bookingNow,
    });
  const insert = (values: Partial<typeof bookings.$inferInsert> = {}) =>
    insertFixtureBooking(database, actors, {
      teamId: actors.teamId,
      userId: actors.member.userId,
      during: bookingRange("13:00", "14:00"),
      ...values,
    });

  it.each(["bookings", "removal", "delete"] as const)(
    "checks the session before %s input or database reads",
    async (kind) => {
      const subject = createTeamQueries({
        database: database.db,
        requireSession: async () => {
          throw new ActionError("UNAUTHENTICATED");
        },
      });
      meter.start();
      const task =
        kind === "bookings"
          ? subject.getTeamBookings("bad", { view: "bad" })
          : kind === "removal"
            ? subject.getTeamRemovalPreview("bad", "bad")
            : subject.getTeamDeletePreview("bad");
      await expect(task).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
      expect(meter.stop().statements).toBe(0);
    },
  );
  it("rejects malformed route and filter values before SQL", async () => {
    meter.start();
    await expect(queries().getTeamBookings("bad")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    for (const query of [
      { view: "all" },
      { branchId: "bad" },
      { view: "past", extra: true },
    ])
      await expect(
        queries().getTeamBookings(actors.teamId, query),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      queries().getTeamRemovalPreview(actors.teamId, "bad"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(queries().getTeamDeletePreview("bad")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(meter.stop().statements).toBe(0);
  });
  it("conceals missing, deleted and nonmember teams including operator-only access", async () => {
    await insert();
    for (const viewer of [actors.person, actors.operator, actors.stranger]) {
      await expect(
        queries(viewer).getTeamBookings(actors.teamId),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(
        await manageDal.readTeamBookingRows(
          {
            teamId: actors.teamId,
            userId: viewer.userId,
            view: "upcoming",
            now: bookingNow,
          },
          database.db,
        ),
      ).toEqual([]);
      expect(
        await manageDal.listTeamBookingBranches(
          actors.teamId,
          viewer.userId,
          database.db,
        ),
      ).toEqual([]);
    }
    await expect(
      queries().getTeamBookings(crypto.randomUUID()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await database.db
      .update(teams)
      .set({ deletedAt: bookingNow, deletedBy: actors.admin.userId })
      .where(eq(teams.id, actors.teamId));
    await expect(
      queries().getTeamBookings(actors.teamId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      queries(actors.admin).getTeamDeletePreview(actors.teamId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      await manageDal.readTeamBookingRows(
        {
          teamId: actors.teamId,
          userId: actors.member.userId,
          view: "upcoming",
          now: bookingNow,
        },
        database.db,
      ),
    ).toEqual([]);
  });
  it("returns expanded public header, administrator-first members and admin-only settings", async () => {
    const space = await createTeamSpace(actors.teamId, database.db);
    await insert({ during: bookingRange("12:00", "13:00") });
    await insert({ during: bookingRange("14:00", "15:00") });
    await insert({ during: bookingRange("10:00", "11:00") });
    await database.db
      .update(users)
      .set({ name: "가장 앞인 일반 회원", username: "member_name" })
      .where(eq(users.id, actors.member.userId));
    const member = await queries().getTeamPageData(actors.teamId);
    expect(member).toMatchObject({
      userId: actors.member.userId,
      homeBranchName: "강남점",
      space: { id: space.spaceId, initial: "그" },
      upcomingBookingCount: 2,
    });
    expect(member?.members.map(({ id }) => id)).toEqual([
      actors.admin.userId,
      actors.member.userId,
    ]);
    expect(member?.members[1]).toMatchObject({ username: "member_name" });
    expect(JSON.stringify(member)).not.toContain("@example.test");
    for (const field of [
      "headcount",
      "contactPhone",
      "homeBranchId",
      "sentInvites",
      "joinRequests",
      "branches",
    ])
      expect(member).not.toHaveProperty(field);
    const admin = await queries(actors.admin).getTeamPageData(actors.teamId);
    expect(admin).toMatchObject({
      role: "admin",
      homeBranchId: actors.branchId,
      headcount: null,
      pendingJoinRequestCount: 0,
    });
    if (admin?.role !== "admin") throw new Error("Expected administrator");
    expect(admin.branches).toHaveLength(2);
    expect(admin.members.map(({ email }) => email)).toEqual([
      actors.admin.email,
      actors.member.email,
    ]);
  });
  it("returns only team booking metadata, owner/invite chat flags and no private location identifiers", async () => {
    const own = await insert({ title: "팀 업무" });
    const invited = await insert({
      userId: actors.admin.userId,
      spaceId: actors.restrictedFloorSpaceId,
    });
    const other = await insert({
      userId: actors.admin.userId,
      spaceId: actors.secondSpaceId,
    });
    const desk = await insert({ spaceId: actors.deskId });
    await database.db.insert(bookingParticipants).values([
      { bookingId: invited.id, userId: actors.member.userId },
      { bookingId: invited.id, userId: actors.stranger.userId },
    ]);
    await insert({
      teamId: null,
      spaceId: actors.otherSpaceId,
      title: "개인 비공개",
    });
    await insert({
      teamId: actors.otherTeamId,
      spaceId: actors.publicSpaceId,
      during: bookingRange("15:00", "16:00"),
      title: "다른 팀 비공개",
    });
    const data = await queries().getTeamBookings(actors.teamId.toUpperCase());
    expect(data.bookings).toHaveLength(4);
    expect(data.bookings.find(({ id }) => id === own.id)).toMatchObject({
      canChat: true,
      canCancel: true,
      kind: "time",
      booker: {
        id: actors.member.userId,
        name: actors.member.name,
        avatar: {
          color: avatarColorFor(actors.member.userId, null),
          photoUrl: null,
        },
      },
    });
    expect(data.bookings.find(({ id }) => id === invited.id)).toMatchObject({
      canChat: true,
      canCancel: false,
      participantCount: 2,
      restricted: true,
    });
    expect(data.bookings.find(({ id }) => id === other.id)).toMatchObject({
      canChat: false,
      canCancel: false,
      restricted: false,
    });
    expect(data.bookings.find(({ id }) => id === desk.id)).toMatchObject({
      canChat: false,
      canCancel: true,
      kind: "desk",
    });
    for (const booking of data.bookings)
      expect(Object.keys(booking).sort()).toEqual(
        [
          "id",
          "kind",
          "startAt",
          "endAt",
          "title",
          "spaceName",
          "floorName",
          "branchName",
          "timezone",
          "restricted",
          "booker",
          "participantCount",
          "canChat",
          "canCancel",
        ].sort(),
      );
    const json = JSON.stringify(data.bookings);
    for (const hidden of [
      "@example.test",
      actors.stranger.name,
      actors.branchId,
      actors.floorId,
      actors.publicSpaceId,
      "개인 비공개",
      "다른 팀 비공개",
      "roomId",
      "photos",
      "email",
    ])
      expect(json).not.toContain(hidden);
  });
  it("uses parent desk-area restrictions, never a child desk's access value", async () => {
    await database.db
      .update(spaces)
      .set({ access: "teams" })
      .where(eq(spaces.id, actors.deskAreaId));
    await insert({ spaceId: actors.deskId });
    expect(
      (await queries().getTeamBookings(actors.teamId)).bookings[0],
    ).toMatchObject({ restricted: true, canChat: false });
  });
  it("loads branch-specific cancellation overrides in one batch while preserving owner and operator rules", async () => {
    const denied = await insert();
    const allowed = await insert({ spaceId: actors.otherSpaceId });
    const own = await insert({
      userId: actors.admin.userId,
      spaceId: actors.secondSpaceId,
    });
    await database.db.insert(roleSettings).values({
      branchId: actors.branchId,
      role: "team_admin",
      permissions: [],
      limits: {},
    });
    const data = await queries(actors.admin).getTeamBookings(actors.teamId);
    expect(data.bookings.find(({ id }) => id === denied.id)?.canCancel).toBe(
      false,
    );
    expect(data.bookings.find(({ id }) => id === allowed.id)?.canCancel).toBe(
      true,
    );
    expect(data.bookings.find(({ id }) => id === own.id)?.canCancel).toBe(true);
    await database.db
      .insert(teamMembers)
      .values({ teamId: actors.teamId, userId: actors.operator.userId });
    const operator = await queries(actors.operator).getTeamBookings(
      actors.teamId,
    );
    expect(
      operator.bookings.find(({ id }) => id === denied.id)?.canCancel,
    ).toBe(true);
    expect(
      operator.bookings.find(({ id }) => id === allowed.id)?.canCancel,
    ).toBe(false);
    await database.db
      .update(roleSettings)
      .set({ permissions: ["booking.manage_team"] })
      .where(eq(roleSettings.branchId, actors.branchId));
    expect(
      (
        await queries(actors.admin).getTeamBookings(actors.teamId)
      ).bookings.find(({ id }) => id === denied.id)?.canCancel,
    ).toBe(true);
  });
  it("uses the supplied database for multibranch permissions without memoizing changed roles", async () => {
    const before = await loadPermissionContext(
      actors.admin,
      [actors.branchId, actors.otherBranchId, actors.branchId],
      database.db,
    );
    expect(before.roleSettings).toEqual({});
    await database.db.insert(roleSettings).values({
      branchId: actors.branchId,
      role: "team_admin",
      permissions: [],
      limits: {},
    });
    const after = await loadPermissionContext(
      actors.admin,
      [actors.branchId, actors.otherBranchId],
      database.db,
    );
    expect(after.roleSettings[actors.branchId]?.team_admin).toEqual([]);
  });
  it("keeps branch choices for the whole team while filtering the returned booking rows", async () => {
    await insert();
    const other = await insert({ spaceId: actors.otherSpaceId });
    const data = await queries().getTeamBookings(actors.teamId, {
      branchId: actors.otherBranchId.toUpperCase(),
    });
    expect(data.bookings.map(({ id }) => id)).toEqual([other.id]);
    expect(data.branchId).toBe(actors.otherBranchId);
    expect(data.branches).toEqual([
      { id: actors.branchId, name: "강남점" },
      { id: actors.otherBranchId, name: "서초점" },
    ]);
    expect(
      (
        await queries().getTeamBookings(actors.teamId, {
          branchId: crypto.randomUUID(),
        })
      ).bookings,
    ).toEqual([]);
  });
  it("separates ended, current and future confirmed rows at the exact end boundary", async () => {
    const ended = await insert({
      during: { start: new Date("2026-10-07T02:00:00Z"), end: bookingNow },
    });
    const current = await insert({
      during: { start: bookingNow, end: new Date("2026-10-07T04:00:00Z") },
    });
    const future = await insert({ during: bookingRange("14:00", "15:00") });
    expect(
      (await queries().getTeamBookings(actors.teamId)).bookings.map(
        ({ id }) => id,
      ),
    ).toEqual([current.id, future.id]);
    const past = await queries().getTeamBookings(actors.teamId, {
      view: "past",
    });
    expect(past.bookings.map(({ id }) => id)).toEqual([ended.id]);
    expect(past.bookings[0]?.canCancel).toBe(false);
  });
  it("calculates the inclusive past cutoff in each branch timezone, not the server timezone", async () => {
    await database.db
      .update(branches)
      .set({ timezone: "America/Los_Angeles" })
      .where(eq(branches.id, actors.otherBranchId));
    const seoul = await insert({
      during: {
        start: new Date("2026-09-06T15:00:00Z"),
        end: new Date("2026-09-06T16:00:00Z"),
      },
    });
    await insert({
      spaceId: actors.secondSpaceId,
      during: {
        start: new Date("2026-09-06T14:00:00Z"),
        end: new Date("2026-09-06T15:00:00Z"),
      },
    });
    const la = await insert({
      spaceId: actors.otherSpaceId,
      during: {
        start: new Date("2026-09-06T07:00:00Z"),
        end: new Date("2026-09-06T08:00:00Z"),
      },
    });
    await insert({
      spaceId: actors.otherSpaceId,
      during: {
        start: new Date("2026-09-06T06:59:59Z"),
        end: new Date("2026-09-06T07:00:00Z"),
      },
    });
    await insert({
      spaceId: actors.otherSpaceId,
      during: {
        start: new Date("2026-09-06T04:00:00Z"),
        end: new Date("2026-09-06T06:59:59Z"),
      },
      status: "cancelled",
      cancelledAt: new Date("2026-09-06T06:59:59Z"),
      cancelledBy: actors.member.userId,
    });
    expect(
      (
        await queries().getTeamBookings(actors.teamId, { view: "past" })
      ).bookings.map(({ id }) => id),
    ).toEqual([seoul.id, la.id]);
    expect(
      (await queries().getTeamBookings(actors.teamId, { view: "cancelled" }))
        .bookings,
    ).toEqual([]);
  });
  it("filters cancelled rows by cancellation time and sorts most recently cancelled first", async () => {
    const make = (cancelledAt: string) =>
      insert({
        status: "cancelled",
        cancelledAt: new Date(cancelledAt),
        cancelledBy: actors.admin.userId,
      });
    const cutoff = await make("2026-09-06T15:00:00Z");
    const latest = await make("2026-10-07T03:00:00Z");
    await make("2026-09-06T14:59:59Z");
    const data = await queries(actors.admin).getTeamBookings(actors.teamId, {
      view: "cancelled",
    });
    expect(data.bookings.map(({ id }) => id)).toEqual([latest.id, cutoff.id]);
    expect(data.bookings.every(({ canCancel }) => !canCancel)).toBe(true);
  });
  it.each(["upcoming", "past", "cancelled"] as const)(
    "limits %s to 100 rows with deterministic time ordering",
    async (view) => {
      const start =
        bookingNow.getTime() + (view === "upcoming" ? 1 : -102) * 60_000;
      const values = Array.from({ length: 101 }, (_, index) => ({
        spaceId: actors.publicSpaceId,
        userId: actors.member.userId,
        teamId: actors.teamId,
        during: {
          start: new Date(start + index * 60_000),
          end: new Date(start + (index + 1) * 60_000),
        },
        title: `예약 ${index}`,
        ...(view === "cancelled"
          ? {
              status: "cancelled" as const,
              cancelledAt: new Date(start + index * 60_000),
              cancelledBy: actors.admin.userId,
            }
          : {}),
      }));
      await database.db.insert(bookings).values(values);
      const data = await queries().getTeamBookings(actors.teamId, { view });
      expect(data.bookings).toHaveLength(100);
      expect(data.bookings[0]?.title).toBe(
        view === "upcoming" ? "예약 0" : "예약 100",
      );
      expect(data.bookings[99]?.title).toBe(
        view === "upcoming" ? "예약 99" : "예약 1",
      );
    },
  );
  it("allows only the member's own removal preview or a manager's target preview", async () => {
    const future = await insert();
    await insert({ during: bookingRange("15:00", "16:00") });
    await insert({ during: bookingRange("12:00", "13:00") });
    await insert({
      during: { start: bookingNow, end: new Date("2026-10-07T05:00:00Z") },
      spaceId: actors.secondSpaceId,
    });
    await insert({ teamId: null, spaceId: actors.otherSpaceId });
    await insert({
      userId: actors.admin.userId,
      spaceId: actors.restrictedSpaceId,
    });
    const mine = await queries().getTeamRemovalPreview(
      actors.teamId,
      actors.member.userId,
    );
    expect(mine).toMatchObject({
      bookingCount: 2,
      firstBooking: {
        id: future.id,
        spaceName: "회의실 B",
        startAt: future.during.start.toISOString(),
      },
    });
    expect(
      await queries(actors.admin).getTeamRemovalPreview(
        actors.teamId,
        actors.member.userId,
      ),
    ).toEqual(mine);
    expect(JSON.stringify(mine)).not.toContain("@example.test");
    const read = vi.spyOn(manageDal, "readTeamRemovalPreview");
    await expect(
      queries().getTeamRemovalPreview(actors.teamId, actors.admin.userId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      queries(actors.operator).getTeamRemovalPreview(
        actors.teamId,
        actors.member.userId,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      queries(actors.admin).getTeamRemovalPreview(
        actors.teamId,
        actors.stranger.userId,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(read).not.toHaveBeenCalled();
  });
  it("returns a stable zero preview without inventing a first booking", async () => {
    expect(
      await queries().getTeamRemovalPreview(
        actors.teamId,
        actors.member.userId,
      ),
    ).toEqual({
      teamId: actors.teamId,
      userId: actors.member.userId,
      bookingCount: 0,
      firstBooking: null,
    });
  });
  it("provides managers the exact destructive scope without tokens, emails or booking details", async () => {
    await insert();
    await insert({ during: bookingRange("12:00", "13:00") });
    await insert({
      spaceId: actors.otherSpaceId,
      during: bookingRange("15:00", "16:00"),
      status: "cancelled",
      cancelledAt: bookingNow,
      cancelledBy: actors.admin.userId,
    });
    await database.db.insert(teamInvites).values([
      {
        teamId: actors.teamId,
        email: actors.stranger.email,
        token: "private-token",
        createdBy: actors.admin.userId,
        expiresAt: new Date(0),
      },
      {
        teamId: actors.teamId,
        email: actors.person.email,
        token: "accepted-token",
        createdBy: actors.admin.userId,
        acceptedAt: bookingNow,
      },
    ]);
    await database.db.insert(teamJoinRequests).values([
      { teamId: actors.teamId, userId: actors.stranger.userId },
      {
        teamId: actors.teamId,
        userId: actors.person.userId,
        status: "rejected",
        decidedAt: bookingNow,
        decidedBy: actors.admin.userId,
      },
    ]);
    const data = await queries(actors.admin).getTeamDeletePreview(
      actors.teamId,
    );
    expect(data).toMatchObject({
      memberCount: 2,
      inviteCount: 1,
      requestCount: 1,
      bookingCount: 1,
    });
    expect(data.accessGrants).toEqual([
      {
        targetType: "space",
        floorId: actors.floorId,
        spaceId: actors.restrictedSpaceId,
        branchName: "강남점",
        floorName: "7F",
        spaceName: "회의실 A",
      },
      {
        targetType: "floor",
        floorId: actors.restrictedFloorId,
        spaceId: null,
        branchName: "강남점",
        floorName: "8F",
        spaceName: null,
      },
    ]);
    expect(JSON.stringify(data)).not.toMatch(
      /private-token|@example\.test|bookingId|title/,
    );
    const counts = vi.spyOn(manageDal, "readTeamDeleteCounts");
    const grants = vi.spyOn(manageDal, "listTeamAccessGrants");
    await expect(
      queries().getTeamDeletePreview(actors.teamId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      queries(actors.operator).getTeamDeletePreview(actors.teamId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(counts).not.toHaveBeenCalled();
    expect(grants).not.toHaveBeenCalled();
  });
  it("holds all four query budgets with many branches, members and bookings", async () => {
    const moreMembers = Array.from({ length: 10 }, (_, index) => ({
      id: crypto.randomUUID(),
      name: `새 팀원 ${index}`,
      email: `query-member${index}@example.test`,
    }));
    await database.db.insert(users).values(moreMembers);
    await database.db
      .insert(teamMembers)
      .values(
        moreMembers.map(({ id }) => ({ teamId: actors.teamId, userId: id })),
      );
    const extra = Array.from({ length: 12 }, (_, index) => ({
      id: crypto.randomUUID(),
      name: `추가 지점 ${index}`,
    }));
    await database.db.insert(branches).values(extra);
    const extraFloors = extra.map(({ id }) => ({
      id: crypto.randomUUID(),
      branchId: id,
      level: 1,
      name: "1층",
    }));
    await database.db.insert(floors).values(extraFloors);
    const extraSpaces = extraFloors.map(({ id }) => ({
      id: crypto.randomUUID(),
      floorId: id,
      name: "회의실",
      type: "meeting_room" as const,
    }));
    await database.db.insert(spaces).values(extraSpaces);
    await database.db.insert(bookings).values(
      extraSpaces.map(({ id }) => ({
        spaceId: id,
        userId: actors.member.userId,
        teamId: actors.teamId,
        during: bookingRange("15:00", "16:00"),
      })),
    );
    const cases = [
      [
        "admin",
        () => queries(actors.admin).getTeamPageData(actors.teamId),
        [3, 6],
      ],
      ["member", () => queries().getTeamPageData(actors.teamId), [3, 2]],
      [
        "bookings",
        () => queries(actors.admin).getTeamBookings(actors.teamId),
        [3, 3],
      ],
      [
        "removal",
        () =>
          queries(actors.admin).getTeamRemovalPreview(
            actors.teamId,
            actors.member.userId,
          ),
        [4, 1],
      ],
      [
        "leave",
        () =>
          queries().getTeamRemovalPreview(actors.teamId, actors.member.userId),
        [2, 1],
      ],
      [
        "delete",
        () => queries(actors.admin).getTeamDeletePreview(actors.teamId),
        [3, 2],
      ],
    ] as const;
    for (const [name, query, budget] of cases) {
      meter.start();
      await query();
      const result = meter.stop();
      expect(result.perStage, name).toEqual(budget);
    }
  });
});

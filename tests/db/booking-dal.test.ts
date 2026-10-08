import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  cancelBookingRecord,
  getBookingWithLocation,
  getUserDefaultBranch,
  insertBooking,
  listMyBookings,
  listSpaceBlocks,
  listSpaceBookings,
  listUserTeamHomeBranches,
  lockBookingActor,
  lockFloorForBooking,
  lockSpaceForBooking,
  setUserDefaultBranch,
  sumBookedMinutes,
} from "@/lib/dal/bookings";
import {
  getBranch,
  getFloorWithAccess,
  listBranchDetails,
  listFloorsWithAccess,
} from "@/lib/dal/branches";
import {
  getDeskCounts,
  getSpacesByIds,
  listFloorSpaceAccess,
} from "@/lib/dal/spaces";
import { withTransaction } from "@/lib/dal/database";
import * as schema from "@/lib/db/schema";
import {
  accessGrants,
  bookings,
  branches,
  floors,
  spaceBlocks,
  spaces,
  teamMembers,
  teams,
  users,
} from "@/lib/db/schema";
import { createTestDatabase, type TestDatabase } from "./helper";

const now = new Date("2026-10-07T10:30:00+09:00");
const day = {
  start: new Date("2026-10-07T00:00:00+09:00"),
  end: new Date("2026-10-08T00:00:00+09:00"),
};
function range(start: string, end: string, date = "2026-10-07") {
  return {
    start: new Date(`${date}T${start}:00+09:00`),
    end: new Date(`${date}T${end}:00+09:00`),
  };
}

describe("booking data access", () => {
  let database: TestDatabase;
  let userId: string;
  let otherUserId: string;
  let branchId: string;
  let otherBranchId: string;
  let floorId: string;
  let otherFloorId: string;
  let spaceId: string;
  let secondSpaceId: string;
  let otherSpaceId: string;
  let teamId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database?.client.close();
  });
  beforeEach(async () => {
    await database.db.execute(sql`TRUNCATE TABLE users, branches CASCADE`);
    [
      userId,
      otherUserId,
      branchId,
      otherBranchId,
      floorId,
      otherFloorId,
      spaceId,
      secondSpaceId,
      otherSpaceId,
      teamId,
    ] = Array.from({ length: 10 }, () => crypto.randomUUID()) as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    await database.db.insert(users).values([
      { id: userId, email: "member@example.test", name: "가상 회원" },
      { id: otherUserId, email: "other@example.test", name: "다른 회원" },
    ]);
    await database.db.insert(branches).values([
      { id: branchId, name: "가상 서울점", timezone: "Asia/Seoul" },
      { id: otherBranchId, name: "가상 뉴욕점", timezone: "America/New_York" },
    ]);
    await database.db.insert(floors).values([
      { id: floorId, branchId, level: 7, name: "7F" },
      { id: otherFloorId, branchId: otherBranchId, level: 2, name: "2F" },
    ]);
    await database.db.insert(spaces).values([
      { id: spaceId, floorId, type: "meeting_room", name: "가상 회의실 A" },
      {
        id: secondSpaceId,
        floorId,
        type: "meeting_room",
        name: "가상 회의실 B",
      },
      {
        id: otherSpaceId,
        floorId: otherFloorId,
        type: "meeting_room",
        name: "가상 회의실 C",
      },
    ]);
    await database.db.insert(teams).values({
      id: teamId,
      name: "가상 팀",
      createdBy: userId,
      homeBranchId: branchId,
    });
  });

  function book(input: Partial<typeof bookings.$inferInsert> = {}) {
    return insertBooking(
      {
        spaceId,
        userId,
        during: range("09:00", "10:00"),
        createdAt: now,
        ...input,
      },
      database.db,
    );
  }

  it("reads actual branch data and separately scoped floor grants", async () => {
    const extraFloorId = crypto.randomUUID();
    await database.db.insert(floors).values({
      id: extraFloorId,
      branchId,
      level: 8,
      name: "8F",
      sortOrder: 2,
      access: "teams",
    });
    await database.db.insert(accessGrants).values([
      { targetType: "floor", targetId: extraFloorId, teamId },
      { targetType: "space", targetId: floorId, teamId },
    ]);
    expect(await listBranchDetails(database.db)).toHaveLength(2);
    expect(await getBranch(branchId, database.db)).toMatchObject({
      id: branchId,
      timezone: "Asia/Seoul",
      openHours: {},
    });
    expect(await getBranch(crypto.randomUUID(), database.db)).toBeNull();
    expect(await getFloorWithAccess(extraFloorId, database.db)).toMatchObject({
      branchId,
      allowedTeamIds: [teamId],
    });
    expect(
      await getFloorWithAccess(crypto.randomUUID(), database.db),
    ).toBeNull();
    const result = await listFloorsWithAccess(branchId, database.db);
    expect(result.map((row) => row.id)).toEqual([floorId, extraFloorId]);
    expect(result[0]?.allowedTeamIds).toEqual([]);
    expect(result[1]?.allowedTeamIds).toEqual([teamId]);
  });

  it("separates minimal space access reads from permitted metadata", async () => {
    const archivedId = crypto.randomUUID();
    const areaId = crypto.randomUUID();
    const deskId = crypto.randomUUID();
    await database.db
      .update(spaces)
      .set({ access: "teams" })
      .where(eq(spaces.id, spaceId));
    await database.db.insert(spaces).values([
      {
        id: archivedId,
        floorId,
        name: "보관 공간",
        type: "meeting_room",
        archivedAt: now,
      },
      {
        id: areaId,
        floorId,
        name: "가상 데스크 구역",
        type: "desk_area",
        bookable: false,
      },
    ]);
    await database.db.insert(spaces).values([
      { id: deskId, floorId, parentId: areaId, name: "좌석1", type: "desk" },
      {
        floorId,
        parentId: areaId,
        name: "좌석2",
        type: "desk",
        archivedAt: now,
      },
    ]);
    await database.db
      .insert(accessGrants)
      .values({ targetType: "space", targetId: spaceId, teamId });
    const identities = await listFloorSpaceAccess(floorId, database.db);
    expect(identities).toHaveLength(3);
    for (const row of identities) {
      expect(Object.keys(row).sort()).toEqual([
        "access",
        "allowedTeamIds",
        "bookable",
        "id",
        "type",
      ]);
      expect([archivedId, deskId]).not.toContain(row.id);
    }
    expect(
      identities.find((row) => row.id === spaceId)?.allowedTeamIds,
    ).toEqual([teamId]);
    const visible = await getSpacesByIds(
      [secondSpaceId, archivedId, deskId],
      database.db,
    );
    expect(visible.map((row) => row.id)).toEqual([secondSpaceId]);
    expect(await getDeskCounts([areaId], database.db)).toEqual([
      { parentId: areaId, count: 1 },
    ]);
    expect(await getSpacesByIds([], database.db)).toEqual([]);
    expect(await getDeskCounts([], database.db)).toEqual([]);
  });

  it("uses half-open overlap for confirmed schedules and resolves actor names", async () => {
    await book({ during: range("09:00", "10:00") });
    const middle = await book({
      during: range("10:00", "11:00"),
      teamId,
      title: "가상 회의",
    });
    await book({ during: range("11:00", "12:00") });
    await book({
      during: range("10:00", "11:00"),
      status: "cancelled",
      cancelledAt: now,
      cancelledBy: userId,
    });
    await book({ spaceId: otherSpaceId, during: range("10:00", "11:00") });
    const rows = await listSpaceBookings(
      { spaceIds: [spaceId], during: range("10:00", "11:00") },
      database.db,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: middle.id,
      userName: "가상 회원",
      teamName: "가상 팀",
      title: "가상 회의",
    });
    expect(
      await listSpaceBookings({ spaceIds: [], during: day }, database.db),
    ).toEqual([]);
    const joined = await getBookingWithLocation(middle.id, database.db);
    expect(joined).toMatchObject({
      booking: { id: middle.id },
      space: { id: spaceId },
      floor: { id: floorId },
      branch: { id: branchId },
      userName: "가상 회원",
      teamName: "가상 팀",
    });
    expect(
      await getBookingWithLocation(crypto.randomUUID(), database.db),
    ).toBeNull();
  });

  it("finds overlapping blocks but excludes adjoining blocks and other spaces", async () => {
    await database.db.insert(spaceBlocks).values([
      { spaceId, during: range("09:00", "10:00"), createdBy: userId },
      {
        spaceId,
        during: range("10:30", "11:30"),
        createdBy: userId,
        reason: "점검",
      },
      { spaceId, during: range("11:00", "12:00"), createdBy: userId },
      {
        spaceId: otherSpaceId,
        during: range("10:00", "11:00"),
        createdBy: userId,
      },
    ]);
    const rows = await listSpaceBlocks(
      { spaceIds: [spaceId], during: range("10:00", "11:00") },
      database.db,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reason).toBe("점검");
    expect(
      await listSpaceBlocks({ spaceIds: [], during: day }, database.db),
    ).toEqual([]);
  });

  it("sums only personal confirmed minutes in the actor branch and start date", async () => {
    await book();
    await book({ spaceId: secondSpaceId, during: range("10:00", "10:30") });
    await book({ during: range("11:00", "12:00"), teamId });
    await book({ during: range("12:00", "13:00"), userId: otherUserId });
    await book({
      during: range("09:00", "10:00"),
      status: "cancelled",
      cancelledAt: now,
    });
    await book({ spaceId: otherSpaceId });
    await book({ during: range("09:00", "10:00", "2026-10-08") });
    expect(
      await sumBookedMinutes(
        { branchId, during: day, actor: { userId } },
        database.db,
      ),
    ).toBe(90);
    expect(
      await sumBookedMinutes(
        { branchId, during: day, actor: { userId: crypto.randomUUID() } },
        database.db,
      ),
    ).toBe(0);
  });

  it("counts a team's reservations across creators but not personal or other-branch bookings", async () => {
    await book({ teamId });
    await book({
      teamId,
      userId: otherUserId,
      during: range("10:00", "11:30"),
    });
    await book({ during: range("12:00", "13:00") });
    await book({ teamId, spaceId: otherSpaceId });
    await book({ teamId, status: "cancelled", cancelledAt: now });
    expect(
      await sumBookedMinutes(
        { branchId, during: day, actor: { teamId } },
        database.db,
      ),
    ).toBe(150);
  });

  it("cancels an unfinished confirmed reservation once with the injected audit time", async () => {
    const row = await book({ during: range("10:00", "11:00") });
    const result = await cancelBookingRecord(
      { bookingId: row.id, userId: otherUserId, now },
      database.db,
    );
    expect(result).toMatchObject({
      id: row.id,
      status: "cancelled",
      cancelledAt: now,
      cancelledBy: otherUserId,
    });
    expect(
      await cancelBookingRecord(
        { bookingId: row.id, userId, now },
        database.db,
      ),
    ).toBeNull();
    expect(
      await sumBookedMinutes(
        { branchId, during: day, actor: { userId } },
        database.db,
      ),
    ).toBe(0);
    expect(await database.db.select().from(bookings)).toHaveLength(1);
  });

  it("does not cancel ended or missing reservations", async () => {
    const row = await book({ during: range("10:00", "10:30") });
    expect(
      await cancelBookingRecord(
        { bookingId: row.id, userId, now },
        database.db,
      ),
    ).toBeNull();
    expect(
      await cancelBookingRecord(
        { bookingId: crypto.randomUUID(), userId, now },
        database.db,
      ),
    ).toBeNull();
  });

  it("reads and writes default branches and name-ordered team home branches", async () => {
    expect(await getUserDefaultBranch(userId, database.db)).toBeNull();
    expect(await setUserDefaultBranch(userId, branchId, database.db)).toEqual({
      id: userId,
      defaultBranchId: branchId,
    });
    expect(await getUserDefaultBranch(userId, database.db)).toBe(branchId);
    expect(
      await setUserDefaultBranch(crypto.randomUUID(), branchId, database.db),
    ).toBeNull();
    const [withoutHome, firstTeam] = await database.db
      .insert(teams)
      .values([
        { name: "가 나중 팀", createdBy: userId },
        { name: "가 먼저 팀", createdBy: userId, homeBranchId: otherBranchId },
      ])
      .returning();
    if (!withoutHome || !firstTeam) throw new Error("Missing teams.");
    await database.db.insert(teamMembers).values([
      { userId, teamId },
      { userId, teamId: withoutHome.id },
      { userId, teamId: firstTeam.id },
    ]);
    const memberTeams = await listUserTeamHomeBranches(userId, database.db);
    expect(memberTeams.map((row) => row.id)).toEqual([
      withoutHome.id,
      firstTeam.id,
      teamId,
    ]);
    expect(memberTeams[0]).toMatchObject({
      name: withoutHome.name,
      homeBranchId: null,
    });
  });

  it("separates future and ended/cancelled history using the given clock", async () => {
    const ended = await book();
    const active = await book({ during: range("10:00", "11:00") });
    const future = await book({ during: range("12:00", "13:00") });
    const cancelledFuture = await book({
      during: range("14:00", "15:00"),
      status: "cancelled",
      cancelledAt: now,
    });
    await book({ during: range("09:00", "10:00", "2026-09-06") });
    await book({ spaceId: secondSpaceId, userId: otherUserId });
    const result = await listMyBookings(userId, now, database.db);
    expect(result.upcoming.map((row) => row.booking.id)).toEqual([
      active.id,
      future.id,
    ]);
    expect(result.past.map((row) => row.booking.id)).toEqual([
      cancelledFuture.id,
      ended.id,
    ]);
    expect(await listMyBookings(crypto.randomUUID(), now, database.db)).toEqual(
      { upcoming: [], past: [] },
    );
  });

  it("uses each branch's local midnight for the thirty-day history boundary", async () => {
    const cutoffNow = new Date("2026-10-07T00:30:00Z");
    const seoulIncluded = await book({
      during: {
        start: new Date("2026-09-06T15:00:00Z"),
        end: new Date("2026-09-06T15:30:00Z"),
      },
    });
    await book({
      during: {
        start: new Date("2026-09-06T14:30:00Z"),
        end: new Date("2026-09-06T15:00:00Z"),
      },
    });
    const newYorkIncluded = await book({
      spaceId: otherSpaceId,
      during: {
        start: new Date("2026-09-06T04:00:00Z"),
        end: new Date("2026-09-06T04:30:00Z"),
      },
    });
    await book({
      spaceId: otherSpaceId,
      during: {
        start: new Date("2026-09-06T03:30:00Z"),
        end: new Date("2026-09-06T04:00:00Z"),
      },
    });
    const result = await listMyBookings(userId, cutoffNow, database.db);
    expect(result.past.map((row) => row.booking.id)).toEqual([
      seoulIncluded.id,
      newYorkIncluded.id,
    ]);
  });

  it("limits the recent history to fifty rows in descending start order", async () => {
    const rows = await database.db
      .insert(bookings)
      .values(
        Array.from({ length: 55 }, (_, index) => ({
          spaceId,
          userId,
          during: {
            start: new Date(now.getTime() - (index + 2) * 3_600_000),
            end: new Date(now.getTime() - (index + 1) * 3_600_000),
          },
        })),
      )
      .returning();
    const result = await listMyBookings(userId, now, database.db);
    expect(result.past).toHaveLength(50);
    expect(result.past.map((row) => row.booking.id)).toEqual(
      rows.slice(0, 50).map((row) => row.id),
    );
  });

  it.each([null, "team"])(
    "records the floor → space → user → team lock order for %s",
    async (actor) => {
      const statements: string[] = [];
      const logged = drizzle({
        client: database.client,
        schema,
        logger: {
          logQuery(query) {
            statements.push(query);
          },
        },
      });
      await withTransaction(async (transaction) => {
        expect(await lockFloorForBooking(floorId, transaction)).toMatchObject({
          id: floorId,
        });
        expect(await lockSpaceForBooking(spaceId, transaction)).toMatchObject({
          id: spaceId,
        });
        expect(
          await lockBookingActor(
            { userId, teamId: actor ? teamId : null },
            transaction,
          ),
        ).toBe(true);
      }, logged);
      const locks = statements.filter((statement) =>
        /for (?:share|key share|update)/u.test(statement),
      );
      expect(locks).toHaveLength(actor ? 4 : 3);
      expect(locks[0]).toMatch(/from "floors".*for share/u);
      expect(locks[1]).toMatch(/from "spaces".*for share/u);
      expect(locks[2]).toMatch(
        actor ? /from "users".*for key share/u : /from "users".*for update/u,
      );
      if (actor) expect(locks[3]).toMatch(/from "teams".*for update/u);
    },
  );

  it("returns absence from locking helpers and records a conditional cancellation statement", async () => {
    const statements: string[] = [];
    const parameters: unknown[][] = [];
    const logged = drizzle({
      client: database.client,
      schema,
      logger: {
        logQuery(query, params) {
          statements.push(query);
          parameters.push(params);
        },
      },
    });
    await withTransaction(async (transaction) => {
      expect(
        await lockFloorForBooking(crypto.randomUUID(), transaction),
      ).toBeNull();
      expect(
        await lockSpaceForBooking(crypto.randomUUID(), transaction),
      ).toBeNull();
      expect(
        await lockBookingActor(
          { userId: crypto.randomUUID(), teamId: null },
          transaction,
        ),
      ).toBe(false);
      expect(
        await lockBookingActor(
          { userId, teamId: crypto.randomUUID() },
          transaction,
        ),
      ).toBe(false);
    }, logged);
    const booking = await book({ during: range("11:00", "12:00") });
    await cancelBookingRecord({ bookingId: booking.id, userId, now }, logged);
    const index = statements.findIndex((statement) =>
      statement.startsWith('update "bookings"'),
    );
    expect(index).toBeGreaterThanOrEqual(0);
    expect(statements[index]).toMatch(
      /where .*"status" = .*upper\("bookings"\."during"\) > .* returning/u,
    );
    expect(statements[index]).not.toMatch(/now\(\)/iu);
    expect(parameters[index]).toContain(now.toISOString());
  });
});

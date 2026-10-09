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
import { createMaintenanceQueries } from "@/features/admin/maintenance-query-factory";
import type {
  MaintenanceListInput,
  PreviewMaintenanceInput,
} from "@/features/admin/maintenance-schema";
import { ActionError } from "@/lib/actions/result";
import type { Session } from "@/lib/auth/types";
import * as read from "@/lib/dal/maintenance-read";
import {
  bookingParticipants,
  bookings,
  branches,
  roleSettings,
  spaceBlocks,
  spaces,
  teams,
} from "@/lib/db/schema";
import {
  bookingNow,
  bookingRange,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

describe("maintenance server queries", () => {
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
  const query = (session: Session = actors.operator, now = bookingNow) =>
    createMaintenanceQueries({
      database: database.db,
      requireSession: async () => session,
      now: () => now,
    });
  const preview = (
    spaceId = actors.publicSpaceId,
  ): PreviewMaintenanceInput => ({
    spaceId,
    start: { kind: "at", at: "2026-10-07T12:30:00+09:00" },
    end: "2026-10-07T14:00:00+09:00",
  });
  async function block(
    spaceId: string,
    start = "12:00",
    end = "13:00",
    date = "2026-10-07",
    reason: string | null = "모니터 점검",
  ) {
    const [row] = await database.db
      .insert(spaceBlocks)
      .values({
        spaceId,
        during: bookingRange(start, end, date),
        reason,
        createdBy: actors.operator.userId,
      })
      .returning();
    return row!;
  }
  it("checks the session before strict parsing or any SQL", async () => {
    const subject = createMaintenanceQueries({
      database: database.db,
      requireSession: async () => {
        throw new ActionError("UNAUTHENTICATED");
      },
    });
    meter.start();
    await expect(
      subject.getMaintenanceList({ branchId: "bad" }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(
      subject.previewMaintenance({ ...preview(), spaceId: "bad" }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(meter.stop().statements).toBe(0);
  });
  it("strictly parses runtime query arguments without trusting TypeScript callers", async () => {
    meter.start();
    for (const value of [
      { branchId: "bad" },
      { branchId: actors.branchId, tab: "all" },
      { branchId: actors.branchId, userId: actors.operator.userId },
    ])
      await expect(
        query().getMaintenanceList(value as MaintenanceListInput),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    for (const value of [
      { ...preview(), spaceId: "bad" },
      { ...preview(), reason: "not part of a read" },
      { ...preview(), start: { kind: "now", at: "2026-10-07T12:30:00Z" } },
      { ...preview(), end: "bad" },
    ])
      await expect(
        query().previewMaintenance(value as PreviewMaintenanceInput),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(meter.stop().statements).toBe(0);
  });
  it.each(["person", "otherOperator"] as const)(
    "does not expose a branch's bookings or maintenance to %s",
    async (actor) => {
      const overlap = vi.spyOn(read, "listMaintenanceOverlaps");
      const rows = vi.spyOn(read, "listMaintenanceRows");
      const options = vi.spyOn(read, "listMaintenanceSpaces");
      await expect(
        query(actors[actor]).previewMaintenance(preview()),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        query(actors[actor]).getMaintenanceList({ branchId: actors.branchId }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(overlap).not.toHaveBeenCalled();
      expect(rows).not.toHaveBeenCalled();
      expect(options).not.toHaveBeenCalled();
    },
  );
  it("uses the actual space branch and denies disabled space.manage before overlap or list data", async () => {
    await database.db
      .insert(roleSettings)
      .values({
        branchId: actors.branchId,
        role: "operator",
        permissions: ["booking.manage_all", "plan.edit", "stats.view"],
      });
    const overlap = vi.spyOn(read, "listMaintenanceOverlaps");
    const rows = vi.spyOn(read, "listMaintenanceRows");
    await expect(query().previewMaintenance(preview())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      query().getMaintenanceList({ branchId: actors.branchId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      query().previewMaintenance(preview(actors.otherSpaceId)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(overlap).not.toHaveBeenCalled();
    expect(rows).not.toHaveBeenCalled();
  });
  it("allows space.manage without booking.manage_all, including a permission inherited from another held role", async () => {
    await insertFixtureBooking(database, actors);
    await database.db.insert(roleSettings).values([
      { branchId: actors.branchId, role: "operator", permissions: [] },
      {
        branchId: actors.branchId,
        role: "user",
        permissions: ["space.manage"],
      },
    ]);
    expect((await query().previewMaintenance(preview())).bookings).toHaveLength(
      1,
    );
    expect(
      (await query().getMaintenanceList({ branchId: actors.branchId })).spaces
        .length,
    ).toBeGreaterThan(0);
  });
  it("rejects missing, lounge, archived and invalid seat parents without reading overlaps", async () => {
    const [lounge] = await database.db
      .insert(spaces)
      .values({ floorId: actors.floorId, name: "활성 라운지", type: "lounge" })
      .returning();
    const overlap = vi.spyOn(read, "listMaintenanceOverlaps");
    for (const id of [crypto.randomUUID(), actors.archivedSpaceId, lounge!.id])
      await expect(
        query().previewMaintenance(preview(id)),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await database.db
      .update(spaces)
      .set({ archivedAt: bookingNow })
      .where(eq(spaces.id, actors.deskAreaId));
    await expect(
      query().previewMaintenance(preview(actors.deskId)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(overlap).not.toHaveBeenCalled();
    await database.db
      .update(spaces)
      .set({ archivedAt: null })
      .where(eq(spaces.id, actors.deskAreaId));
    await database.db
      .update(spaces)
      .set({ parentId: null })
      .where(eq(spaces.id, actors.deskId));
    await expect(
      query().previewMaintenance(preview(actors.deskId)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("returns reusable parent/floor/branch metadata in one SQL statement", async () => {
    meter.start();
    const row = await read.getMaintenanceSpace(actors.deskId, database.db);
    expect(meter.stop().perStage).toEqual([1]);
    expect(row).toEqual({
      space: {
        id: actors.deskId,
        floorId: actors.floorId,
        parentId: actors.deskAreaId,
        name: "좌석 1",
        type: "desk",
        archivedAt: null,
      },
      parent: {
        id: actors.deskAreaId,
        floorId: actors.floorId,
        name: "데스크 구역",
        type: "desk_area",
        archivedAt: null,
      },
      floor: { id: actors.floorId, branchId: actors.branchId, name: "7F" },
      branch: { id: actors.branchId, name: "강남점", timezone: "Asia/Seoul" },
    });
  });
  it("includes only overlapping confirmed bookings, not touching or cancelled bookings, and never selects titles/emails", async () => {
    const touchingBefore = await insertFixtureBooking(database, actors, {
      during: bookingRange("11:00", "12:30"),
    });
    const target = await insertFixtureBooking(database, actors, {
      during: bookingRange("12:30", "13:00"),
      teamId: actors.teamId,
      title: "보이면 안 되는 제목",
    });
    await insertFixtureBooking(database, actors, {
      during: bookingRange("13:00", "13:30"),
      status: "cancelled",
      cancelledAt: bookingNow,
      cancelledBy: actors.person.userId,
    });
    const explicit = await insertFixtureBooking(database, actors, {
      during: bookingRange("13:30", "14:00"),
      attendeeCount: 5,
    });
    await insertFixtureBooking(database, actors, {
      during: bookingRange("14:00", "15:00"),
    });
    await insertFixtureBooking(database, actors, {
      spaceId: actors.otherSpaceId,
      during: bookingRange("12:30", "13:00"),
    });
    await database.db
      .insert(bookingParticipants)
      .values({
        bookingId: target.id,
        userId: actors.member.userId,
        createdAt: bookingNow,
      });
    await database.db
      .update(teams)
      .set({ deletedAt: bookingNow, deletedBy: actors.admin.userId })
      .where(eq(teams.id, actors.teamId));
    const sql = vi.spyOn(database.client, "query");
    const result = await query().previewMaintenance(preview());
    expect(result).toEqual({
      branchId: actors.branchId,
      window: {
        start: "2026-10-07T03:30:00.000Z",
        end: "2026-10-07T05:00:00.000Z",
      },
      bookings: [
        {
          id: target.id,
          start: target.during.start.toISOString(),
          end: target.during.end.toISOString(),
          bookerName: actors.person.name,
          teamName: "지운 팀",
          attendeeCount: 2,
        },
        {
          id: explicit.id,
          start: explicit.during.start.toISOString(),
          end: explicit.during.end.toISOString(),
          bookerName: actors.person.name,
          teamName: null,
          attendeeCount: 5,
        },
      ],
    });
    expect(result.bookings.some(({ id }) => id === touchingBefore.id)).toBe(
      false,
    );
    expect(
      sql.mock.calls.map(([statement]) => statement).join("\n"),
    ).not.toMatch(/"title"|"email"/);
    expect(JSON.stringify(result)).not.toContain("보이면 안 되는 제목");
  });
  it("expands desk areas to their seat bookings while a single seat stays isolated", async () => {
    const first = await insertFixtureBooking(database, actors, {
      spaceId: actors.deskId,
      during: bookingRange("12:00", "13:00"),
    });
    const second = await insertFixtureBooking(database, actors, {
      spaceId: actors.otherDeskId,
      during: bookingRange("13:00", "14:00"),
    });
    const area = await insertFixtureBooking(database, actors, {
      spaceId: actors.deskAreaId,
      during: bookingRange("12:30", "13:00"),
    });
    const other = await insertFixtureBooking(database, actors, {
      during: bookingRange("12:30", "13:00"),
    });
    const result = await query().previewMaintenance(preview(actors.deskAreaId));
    expect(new Set(result.bookings.map(({ id }) => id))).toEqual(
      new Set([first.id, second.id, area.id]),
    );
    expect(result.bookings.some(({ id }) => id === other.id)).toBe(false);
    expect(
      (await query().previewMaintenance(preview(actors.deskId))).bookings.map(
        ({ id }) => id,
      ),
    ).toEqual([first.id]);
  });
  it("uses minute-floored now but omits bookings that have already ended during that minute", async () => {
    await insertFixtureBooking(database, actors, {
      during: {
        start: new Date("2026-10-07T03:00:00Z"),
        end: new Date("2026-10-07T03:10:10Z"),
      },
    });
    const target = await insertFixtureBooking(database, actors, {
      during: {
        start: new Date("2026-10-07T03:10:10Z"),
        end: new Date("2026-10-07T03:30:00Z"),
      },
    });
    const now = new Date("2026-10-07T03:10:45Z");
    const result = await query(actors.operator, now).previewMaintenance({
      ...preview(),
      start: { kind: "now" },
    });
    expect(result.window.start).toBe("2026-10-07T03:10:00.000Z");
    expect(result.bookings.map(({ id }) => id)).toEqual([target.id]);
  });
  it("validates local alignment using the actual branch timezone before overlap SQL", async () => {
    await database.db
      .update(branches)
      .set({ timezone: "Asia/Kathmandu" })
      .where(eq(branches.id, actors.branchId));
    const overlap = vi.spyOn(read, "listMaintenanceOverlaps");
    await expect(
      query().previewMaintenance({
        ...preview(),
        start: { kind: "at", at: "2026-10-07T04:00:00Z" },
        end: "2026-10-07T05:00:00Z",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
      details: { fieldErrors: { start: expect.any(Array) } },
    });
    expect(overlap).not.toHaveBeenCalled();
    expect(
      (
        await query().previewMaintenance({
          ...preview(),
          start: { kind: "at", at: "2026-10-07T04:15:00Z" },
          end: "2026-10-07T05:15:00Z",
        })
      ).window.start,
    ).toBe("2026-10-07T04:15:00.000Z");
  });
  it("lists each block without merging area/seat overlap and counts active and upcoming rows", async () => {
    const ongoing = await block(actors.publicSpaceId);
    const future = await block(actors.publicSpaceId, "14:00", "15:00");
    const area = await block(actors.deskAreaId);
    const seat = await block(actors.deskId);
    await block(actors.publicSpaceId, "10:00", "11:00");
    await block(actors.otherSpaceId);
    const result = await query().getMaintenanceList({
      branchId: actors.branchId.toUpperCase(),
    });
    expect(result).toMatchObject({
      branch: { id: actors.branchId, name: "강남점", timezone: "Asia/Seoul" },
      now: bookingNow.toISOString(),
      tab: "active",
      activeCount: 4,
    });
    expect(new Set(result.rows.map(({ id }) => id))).toEqual(
      new Set([ongoing.id, future.id, area.id, seat.id]),
    );
    expect(result.rows.find(({ id }) => id === ongoing.id)).toEqual({
      id: ongoing.id,
      space: {
        id: actors.publicSpaceId,
        name: "회의실 B",
        floorName: "7F",
        type: "meeting_room",
      },
      start: ongoing.during.start.toISOString(),
      end: ongoing.during.end.toISOString(),
      reason: "모니터 점검",
      state: "ongoing",
      createdByName: actors.operator.name,
    });
    expect(result.rows.at(-1)?.state).toBe("upcoming");
    expect(JSON.stringify(result)).not.toContain("email");
    const past = await query().getMaintenanceList({
      branchId: actors.branchId,
      tab: "past",
    });
    expect(past.activeCount).toBe(4);
    expect(past.rows).toHaveLength(1);
    expect(past.rows[0]?.state).toBe("past");
  });
  it("limits picker options but retains legacy/archived maintenance history", async () => {
    const [lounge] = await database.db
      .insert(spaces)
      .values({
        floorId: actors.floorId,
        type: "lounge",
        name: "레거시 라운지",
      })
      .returning();
    await block(lounge!.id, "10:00", "11:00", "2026-10-07", null);
    await block(actors.archivedSpaceId, "10:00", "11:00");
    await database.db
      .update(spaces)
      .set({ archivedAt: bookingNow })
      .where(eq(spaces.id, actors.deskAreaId));
    const result = await query().getMaintenanceList({
      branchId: actors.branchId,
      tab: "past",
    });
    expect(result.rows).toHaveLength(2);
    expect(
      result.rows.find(({ space }) => space.id === lounge!.id)?.reason,
    ).toBeNull();
    for (const id of [
      lounge!.id,
      actors.archivedSpaceId,
      actors.deskAreaId,
      actors.deskId,
      actors.otherDeskId,
      actors.otherSpaceId,
    ])
      expect(result.spaces.some((space) => space.id === id)).toBe(false);
    expect(result.spaces.some(({ id }) => id === actors.closedSpaceId)).toBe(
      true,
    );
    expect(
      result.spaces.some(({ id }) => id === actors.restrictedFloorSpaceId),
    ).toBe(true);
  });
  it("uses the branch-local thirty-day cutoff for past end times and includes a block ending exactly now", async () => {
    const cutoff = await block(
      actors.publicSpaceId,
      "23:30",
      "24:00",
      "2026-09-06",
    );
    await block(actors.publicSpaceId, "22:00", "23:30", "2026-09-06");
    const endedNow = await block(actors.publicSpaceId, "12:00", "12:10");
    await block(actors.secondSpaceId, "12:00", "13:00");
    const result = await query().getMaintenanceList({
      branchId: actors.branchId,
      tab: "past",
    });
    expect(result.rows.map(({ id }) => id)).toEqual([endedNow.id, cutoff.id]);
    expect(result.activeCount).toBe(1);
  });
  it("uses a Los Angeles cutoff independently of the test process timezone", async () => {
    await database.db
      .update(branches)
      .set({ timezone: "America/Los_Angeles" })
      .where(eq(branches.id, actors.branchId));
    const rows = await database.db
      .insert(spaceBlocks)
      .values([
        {
          spaceId: actors.publicSpaceId,
          createdBy: actors.operator.userId,
          during: {
            start: new Date("2026-09-07T06:30:00Z"),
            end: new Date("2026-09-07T07:00:00Z"),
          },
        },
        {
          spaceId: actors.secondSpaceId,
          createdBy: actors.operator.userId,
          during: {
            start: new Date("2026-09-07T06:00:00Z"),
            end: new Date("2026-09-07T06:30:00Z"),
          },
        },
      ])
      .returning();
    const result = await query(
      actors.operator,
      new Date("2026-10-07T15:00:00Z"),
    ).getMaintenanceList({ branchId: actors.branchId, tab: "past" });
    expect(result.rows.map(({ id }) => id)).toEqual([rows[0]!.id]);
  });
  it("keeps populated preview [4,1] and list [4,3] budgets stable as bookings and spaces grow", async () => {
    await insertFixtureBooking(database, actors);
    await block(actors.publicSpaceId);
    for (const count of [0, 20]) {
      if (count) {
        const rows = await database.db
          .insert(spaces)
          .values(
            Array.from({ length: count }, (_, index) => ({
              floorId: actors.floorId,
              parentId: actors.deskAreaId,
              type: "desk" as const,
              name: `좌석 추가 ${index}`,
            })),
          )
          .returning();
        await database.db
          .insert(bookings)
          .values(
            rows.map((row) => ({
              spaceId: row.id,
              userId: actors.member.userId,
              during: bookingRange("13:00", "14:00"),
            })),
          );
        await database.db
          .insert(spaceBlocks)
          .values(
            rows.map((row) => ({
              spaceId: row.id,
              createdBy: actors.operator.userId,
              during: bookingRange("12:00", "13:00"),
            })),
          );
      }
      meter.start();
      const detail = await query().previewMaintenance(
        preview(count ? actors.deskAreaId : actors.publicSpaceId),
      );
      expect(meter.stop().perStage).toEqual([4, 1]);
      expect(detail.bookings).toHaveLength(count || 1);
      meter.start();
      const list = await query().getMaintenanceList({
        branchId: actors.branchId,
      });
      expect(meter.stop().perStage).toEqual([4, 3]);
      expect(list.rows).toHaveLength(count + 1);
      expect(list.spaces.length).toBeGreaterThan(0);
    }
  });
  it("uses read-only SQL with a supplied clock and does not perform writes or implicit now() calls", async () => {
    await block(actors.publicSpaceId);
    await insertFixtureBooking(database, actors);
    const sql = vi.spyOn(database.client, "query");
    await query().previewMaintenance(preview());
    await query().getMaintenanceList({ branchId: actors.branchId });
    for (const [statement] of sql.mock.calls) {
      expect(statement.trim()).toMatch(/^select\b/i);
      expect(statement).not.toMatch(/\b(?:insert|update|delete|now)\s*\(/i);
    }
  });
});

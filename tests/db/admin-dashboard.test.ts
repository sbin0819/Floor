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
import { createAdminDashboardQueries } from "@/features/admin/dashboard-query-factory";
import {
  dashboardOpenRanges,
  utilizationOf,
} from "@/features/admin/utilization";
import { ActionError } from "@/lib/actions/result";
import type { Session } from "@/lib/auth/types";
import * as dashboardDal from "@/lib/dal/admin-dashboard";
import {
  bookingParticipants,
  bookings,
  branches,
  floorPlans,
  floors,
  roleSettings,
  spaceBlocks,
  spaces,
  teams,
} from "@/lib/db/schema";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";
import {
  bookingNow,
  bookingRange,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

describe("operator dashboard queries and utilization", () => {
  let database: TestDatabase;
  let actors: BookingActors;
  let meter: ReturnType<typeof createQueryMeter>;
  beforeAll(async () => {
    database = await createTestDatabase();
    meter = createQueryMeter(database.client);
  });
  afterAll(async () => {
    meter.restore();
    await database.client.close();
  });
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    actors = await seedBookingActors(database);
    await database.db
      .update(branches)
      .set({ openHours: { wed: { open: "09:00", close: "18:00" }, sun: null } })
      .where(eq(branches.id, actors.branchId));
  });
  const subject = (session: Session = actors.operator, now = bookingNow) =>
    createAdminDashboardQueries({
      database: database.db,
      requireSession: async () => session,
      now: () => now,
    });
  const query = (
    input: Partial<
      Parameters<ReturnType<typeof subject>["getAdminDashboard"]>[0]
    > = {},
  ) => subject().getAdminDashboard({ branchId: actors.branchId, ...input });
  const block = (
    spaceId: string,
    start: string,
    end: string,
    date = "2026-10-07",
    reason = "점검",
  ) =>
    database.db.insert(spaceBlocks).values({
      spaceId,
      during: bookingRange(start, end, date),
      createdBy: actors.operator.userId,
      reason,
    });
  async function publishedPlan() {
    const document: FloorPlanDocument = {
      schema: 1,
      unit: "mm",
      bounds: { w: 10000, h: 10000 },
      walls: [],
      openings: [],
      fixtures: [],
      spaces: [
        {
          id: "room",
          spaceId: actors.publicSpaceId,
          polygon: [
            [0, 0],
            [4000, 0],
            [4000, 4000],
            [0, 4000],
          ],
          label: { at: [2000, 2000] },
        },
      ],
      seats: [
        {
          id: "seat",
          spaceId: actors.deskId,
          at: [5000, 5000],
          size: [1400, 700],
          rotation: 0,
        },
      ],
      background: { transform: [1, 0, 0, 1, 0, 0], opacity: 0.5 },
    };
    const withEditorFields = {
      ...document,
      editorNote: "private-editor-note",
      seats: document.seats.map((seat) => ({
        ...seat,
        label: "private-seat-name",
      })),
    };
    const [plan] = await database.db
      .insert(floorPlans)
      .values({
        floorId: actors.floorId,
        version: 1,
        status: "published",
        createdBy: actors.operator.userId,
        publishedAt: bookingNow,
        backgroundImage: "private-background-key.webp",
        document: withEditorFields,
      })
      .returning();
    await database.db
      .update(floors)
      .set({ publishedPlanId: plan!.id })
      .where(eq(floors.id, actors.floorId));
    return plan!;
  }
  const isoRanges = (ranges: ReturnType<typeof bookingRange>[]) =>
    ranges.map(({ start, end }) => ({
      start: start.toISOString(),
      end: end.toISOString(),
    }));

  it("authenticates before validation or SQL", async () => {
    meter.start();
    await expect(
      createAdminDashboardQueries({
        database: database.db,
        requireSession: async () => {
          throw new ActionError("UNAUTHENTICATED");
        },
      }).getAdminDashboard({ branchId: "invalid" }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(meter.stop().statements).toBe(0);
  });
  it.each(["person", "otherOperator"] as const)(
    "hides another branch from %s without reading any statistics",
    async (actor) => {
      const data = vi.spyOn(dashboardDal, "readDashboardUtilization");
      const upcoming = vi.spyOn(dashboardDal, "listDashboardUpcoming");
      await expect(
        subject(actors[actor]).getAdminDashboard({ branchId: actors.branchId }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(data).not.toHaveBeenCalled();
      expect(upcoming).not.toHaveBeenCalled();
    },
  );
  it("requires stats.view even for assigned operators and does not read person data or plan documents", async () => {
    await publishedPlan();
    await database.db.insert(roleSettings).values({
      branchId: actors.branchId,
      role: "operator",
      permissions: ["space.manage", "plan.edit"],
    });
    const records = vi.spyOn(database.client, "query");
    const data = vi.spyOn(dashboardDal, "readDashboardUtilization");
    await expect(query({ floorId: actors.floorId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(data).not.toHaveBeenCalled();
    const sql = records.mock.calls.map(([statement]) => statement).join("\n");
    expect(sql).not.toMatch(
      /"bookings"|"space_blocks"|"document"|"email"|"title"/,
    );
  });
  it("returns NOT_FOUND for malformed, missing and cross-branch identifiers", async () => {
    for (const input of [
      { branchId: "bad" },
      { branchId: crypto.randomUUID() },
      { floorId: "bad" },
      { floorId: crypto.randomUUID() },
      { floorId: actors.otherFloorId },
    ]) {
      await expect(query(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });
  it("matches pure utilization after cutting bookings and merging overlapping maintenance, including comparison period", async () => {
    const reserved = [
      bookingRange("08:00", "14:00"),
      bookingRange("17:00", "20:00"),
    ];
    for (const during of reserved)
      await insertFixtureBooking(database, actors, { during });
    await insertFixtureBooking(database, actors, {
      during: bookingRange("14:00", "17:00"),
      status: "cancelled",
      cancelledBy: actors.person.userId,
      cancelledAt: bookingNow,
    });
    const blocked = [
      bookingRange("10:00", "12:00"),
      bookingRange("11:00", "13:00"),
    ];
    await block(actors.publicSpaceId, "10:00", "12:00");
    await block(actors.publicSpaceId, "11:00", "13:00");
    await insertFixtureBooking(database, actors, {
      during: bookingRange("09:00", "12:00", "2026-09-30"),
    });
    const current = dashboardOpenRanges(
      "2026-10-07",
      "2026-10-08",
      "Asia/Seoul",
      { wed: { open: "09:00", close: "18:00" } },
    );
    const previous = dashboardOpenRanges(
      "2026-09-30",
      "2026-10-01",
      "Asia/Seoul",
      { wed: { open: "09:00", close: "18:00" } },
    );
    const [row] = await dashboardDal.readDashboardUtilization(
      {
        scope: { branchId: actors.branchId, userId: actors.operator.userId },
        spaceIds: [actors.publicSpaceId],
        current,
        previous,
      },
      database.db,
    );
    const calculated = utilizationOf({
      open: current,
      bookings: isoRanges(reserved),
      blocks: isoRanges(blocked),
    });
    expect(row).toMatchObject({
      operatingMinutes: calculated.operatingMinutes,
      bookedMinutes: calculated.bookedMinutes,
      previousOperatingMinutes: 540,
      previousBookedMinutes: 180,
    });
    expect(row).toMatchObject({ operatingMinutes: 360, bookedMinutes: 180 });
    const result = await query();
    expect(
      result.spaces.find(({ id }) => id === actors.publicSpaceId)?.utilization,
    ).toBe(0.5);
    expect(result.cards.meetingUtilization).toBeCloseTo(180 / (360 + 540 * 4));
    expect(result.cards.previousMeetingUtilization).toBeCloseTo(
      180 / (540 * 5),
    );
  });
  it("averages eligible seat ratios, applies area and seat blocks as a union, and excludes blocked-out, unavailable and archived seats", async () => {
    await insertFixtureBooking(database, actors, {
      spaceId: actors.deskId,
      during: bookingRange("09:00", "18:00"),
    });
    await insertFixtureBooking(database, actors, {
      spaceId: actors.otherDeskId,
      during: bookingRange("13:00", "15:00"),
    });
    await block(actors.deskAreaId, "09:00", "10:00");
    await block(actors.deskId, "09:30", "11:00");
    let result = await query();
    expect(
      result.spaces.find(({ id }) => id === actors.deskAreaId)?.utilization,
    ).toBeCloseTo((1 + 120 / 480) / 2);
    expect(result.spaces.some(({ type }) => type === "desk")).toBe(false);
    await database.db
      .update(spaces)
      .set({ bookable: false })
      .where(eq(spaces.id, actors.otherDeskId));
    result = await query();
    expect(
      result.spaces.find(({ id }) => id === actors.deskAreaId)?.utilization,
    ).toBe(1);
    await database.db
      .update(spaces)
      .set({ bookable: true, archivedAt: bookingNow })
      .where(eq(spaces.id, actors.otherDeskId));
    expect(
      (await query()).spaces.find(({ id }) => id === actors.deskAreaId)
        ?.utilization,
    ).toBe(1);
    await block(actors.deskId, "09:00", "18:00");
    expect(
      (await query()).spaces.find(({ id }) => id === actors.deskAreaId)
        ?.utilization,
    ).toBeNull();
  });
  it("does not double-count desk parents in floor or branch ratios and excludes archived parents", async () => {
    await database.db.update(spaces).set({ bookable: false });
    for (const id of [actors.deskId, actors.otherDeskId])
      await database.db
        .update(spaces)
        .set({ bookable: true })
        .where(eq(spaces.id, id));
    await insertFixtureBooking(database, actors, {
      spaceId: actors.deskId,
      during: bookingRange("09:00", "18:00"),
    });
    const result = await query();
    expect(result.branch.utilization).toBe(0.5);
    expect(
      result.floors.find(({ id }) => id === actors.floorId)?.utilization,
    ).toBe(0.5);
    expect(
      result.spaces.find(({ id }) => id === actors.deskAreaId)?.utilization,
    ).toBe(0.5);
    await database.db
      .update(spaces)
      .set({ archivedAt: bookingNow })
      .where(eq(spaces.id, actors.deskAreaId));
    const archived = await query();
    expect(archived.branch.utilization).toBeNull();
    expect(
      archived.spaces.find(({ id }) => id === actors.deskAreaId)?.utilization,
    ).toBeNull();
  });
  it.each([
    ["2026-03-08", "2026-03-09", 180],
    ["2026-11-01", "2026-11-02", 300],
  ] as const)(
    "matches pure elapsed-time utilization across %s DST in SQL",
    async (date, end, minutes) => {
      const current = dashboardOpenRanges(date, end, "America/Los_Angeles", {
        sun: { open: "00:00", close: "04:00" },
      });
      await insertFixtureBooking(database, actors, {
        during: {
          start: new Date(current[0]!.start),
          end: new Date(current[0]!.end),
        },
      });
      const [row] = await dashboardDal.readDashboardUtilization(
        {
          scope: { branchId: actors.branchId, userId: actors.operator.userId },
          spaceIds: [actors.publicSpaceId],
          current,
          previous: [],
        },
        database.db,
      );
      expect(row).toMatchObject({
        bookedMinutes: minutes,
        operatingMinutes: minutes,
        previousBookedMinutes: 0,
        previousOperatingMinutes: 0,
      });
      expect(
        utilizationOf({ open: current, bookings: current, blocks: [] }),
      ).toEqual({
        bookedMinutes: minutes,
        operatingMinutes: minutes,
        utilization: 1,
      });
    },
  );
  it("normalizes invalid ranges and bases today and counts on the branch timezone across midnight", async () => {
    const instant = new Date("2026-10-07T16:00:00Z");
    await insertFixtureBooking(database, actors, {
      during: bookingRange("01:00", "02:00", "2026-10-08"),
    });
    const inSeoul = await subject(actors.operator, instant).getAdminDashboard({
      branchId: actors.branchId,
      date: "invalid",
      range: "invalid",
    });
    expect(inSeoul).toMatchObject({
      date: "2026-10-08",
      isToday: true,
      range: "day",
      cards: { bookingCount: 1, ongoingCount: 1, remainingCount: 0 },
    });
    await database.db
      .update(branches)
      .set({ timezone: "America/Los_Angeles" })
      .where(eq(branches.id, actors.branchId));
    const inLosAngeles = await subject(
      actors.operator,
      instant,
    ).getAdminDashboard({ branchId: actors.branchId });
    expect(inLosAngeles).toMatchObject({
      date: "2026-10-07",
      isToday: true,
      cards: { bookingCount: 1 },
    });
  });
  it("filters selected-floor statistics without including another floor or branch", async () => {
    await insertFixtureBooking(database, actors, {
      spaceId: actors.restrictedFloorSpaceId,
      during: bookingRange("09:00", "18:00"),
    });
    await insertFixtureBooking(database, actors, {
      spaceId: actors.otherSpaceId,
      during: bookingRange("09:00", "18:00"),
    });
    const selected = await query({ floorId: actors.floorId });
    expect(selected.cards.bookingCount).toBe(0);
    expect(selected.cards.meetingUtilization).toBe(0);
    expect(selected.branch.utilization).toBe(0);
    expect(
      selected.spaces.every(({ floorId }) => floorId === actors.floorId),
    ).toBe(true);
    const otherFloor = await query({ floorId: actors.restrictedFloorId });
    expect(otherFloor.cards.bookingCount).toBe(1);
    expect(otherFloor.cards.meetingUtilization).toBe(1);
    expect(otherFloor.spaces).toHaveLength(1);
  });
  it("uses null for lounge, unavailable area, archived space and closed days", async () => {
    const [emptyArea, lounge] = await database.db
      .insert(spaces)
      .values([
        {
          floorId: actors.floorId,
          name: "예약 안 되는 구역",
          type: "desk_area",
          bookable: false,
        },
        { floorId: actors.floorId, name: "라운지", type: "lounge" },
      ])
      .returning();
    const result = await query();
    for (const id of [emptyArea!.id, lounge!.id, actors.archivedSpaceId])
      expect(
        result.spaces.find((row) => row.id === id)?.utilization,
      ).toBeNull();
    const closed = await query({ date: "2026-10-11" });
    expect(closed.spaces.every(({ utilization }) => utilization === null)).toBe(
      true,
    );
    expect(closed.cards.meetingUtilization).toBeNull();
    expect(closed.branch.utilization).toBeNull();
  });
  it("weights meeting cards and floor summaries by available minutes, not room ratios", async () => {
    await database.db.update(spaces).set({ bookable: false });
    await database.db
      .update(spaces)
      .set({ bookable: true })
      .where(eq(spaces.id, actors.publicSpaceId));
    await database.db
      .update(spaces)
      .set({ bookable: true })
      .where(eq(spaces.id, actors.secondSpaceId));
    await block(actors.publicSpaceId, "10:00", "18:00");
    await insertFixtureBooking(database, actors, {
      during: bookingRange("09:00", "10:00"),
    });
    const result = await query();
    expect(result.cards.meetingUtilization).toBe(60 / 600);
    expect(result.branch.utilization).toBe(60 / 600);
    expect(
      result.floors.find(({ id }) => id === actors.floorId)?.utilization,
    ).toBe(60 / 600);
    expect(
      result.spaces.find(({ id }) => id === actors.publicSpaceId)?.utilization,
    ).toBe(1);
  });
  it("counts confirmed starts on the local date, including seats, and hides today-only values on another date", async () => {
    await insertFixtureBooking(database, actors);
    await insertFixtureBooking(database, actors, {
      spaceId: actors.deskId,
      during: bookingRange("13:00", "18:00"),
    });
    await insertFixtureBooking(database, actors, {
      spaceId: actors.secondSpaceId,
      during: bookingRange("23:30", "24:00", "2026-10-06"),
    });
    await insertFixtureBooking(database, actors, {
      during: bookingRange("15:00", "16:00"),
      status: "cancelled",
      cancelledAt: bookingNow,
      cancelledBy: actors.person.userId,
    });
    await insertFixtureBooking(database, actors, {
      spaceId: actors.otherSpaceId,
    });
    expect((await query()).cards).toMatchObject({
      bookingCount: 2,
      ongoingCount: 1,
      remainingCount: 1,
    });
    const historical = await query({ date: "2026-10-06" });
    expect(historical.cards).toMatchObject({
      bookingCount: 1,
      ongoingCount: null,
      remainingCount: null,
    });
  });
  it("limits upcoming to four ordered starts within two hours, omits cancelled/outside bookings, and exposes no email/title", async () => {
    const ids: string[] = [];
    const spaceIds = [
      actors.deskId,
      actors.secondSpaceId,
      actors.restrictedSpaceId,
      actors.closedSpaceId,
      actors.publicSpaceId,
    ];
    for (const [index, minute] of [10, 20, 30, 40, 50].entries()) {
      const row = await insertFixtureBooking(database, actors, {
        during: bookingRange(`12:${minute}`, `13:${minute}`),
        spaceId: spaceIds[index]!,
        teamId: index === 0 ? actors.teamId : null,
        attendeeCount: index === 1 ? 4 : null,
        title: "private-title",
      });
      ids.push(row.id);
    }
    await database.db.insert(bookingParticipants).values({
      bookingId: ids[0]!,
      userId: actors.member.userId,
      createdAt: bookingNow,
    });
    await database.db
      .update(teams)
      .set({ deletedAt: bookingNow, deletedBy: actors.admin.userId })
      .where(eq(teams.id, actors.teamId));
    await insertFixtureBooking(database, actors, {
      during: bookingRange("14:10", "15:00"),
    });
    await insertFixtureBooking(database, actors, {
      spaceId: actors.archivedSpaceId,
      during: bookingRange("12:15", "13:00"),
      status: "cancelled",
      cancelledBy: actors.person.userId,
      cancelledAt: bookingNow,
    });
    await insertFixtureBooking(database, actors, {
      spaceId: actors.otherSpaceId,
      during: bookingRange("12:15", "13:00"),
    });
    const result = await query();
    expect(result.upcoming.map(({ id }) => id)).toEqual(ids.slice(0, 4));
    expect(result.upcoming[0]).toMatchObject({
      attendeeCount: 2,
      teamName: "지운 팀",
      spaceName: "좌석 좌석 1 · 데스크 구역",
    });
    expect(result.upcoming[1]?.attendeeCount).toBe(4);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("email");
    expect(serialized).not.toContain("private-title");
  });
  it("lists ongoing and the next local seven days of maintenance and filters selected floors", async () => {
    await block(actors.publicSpaceId, "12:00", "13:00");
    await block(actors.restrictedFloorSpaceId, "13:00", "14:00");
    await block(actors.publicSpaceId, "12:00", "13:00", "2026-10-14");
    await block(
      actors.publicSpaceId,
      "12:10",
      "13:00",
      "2026-10-14",
      "경계 밖",
    );
    await block(
      actors.publicSpaceId,
      "11:00",
      "12:10",
      "2026-10-07",
      "끝난 점검",
    );
    await block(
      actors.otherSpaceId,
      "12:00",
      "13:00",
      "2026-10-07",
      "다른 지점",
    );
    const result = await query({ floorId: actors.floorId });
    expect(result.cards.maintenanceCount).toBe(1);
    expect(result.maintenance).toHaveLength(2);
    expect(result.maintenance.map(({ status }) => status)).toEqual([
      "ongoing",
      "upcoming",
    ]);
    expect(
      result.maintenance.every(({ floorName }) => floorName === "7F"),
    ).toBe(true);
  });
  it("uses the existing first-valid-time rule when the seven-day maintenance boundary falls in a DST gap", async () => {
    await database.db
      .update(branches)
      .set({ timezone: "America/Los_Angeles" })
      .where(eq(branches.id, actors.branchId));
    const now = new Date("2026-03-01T10:30:00Z");
    // 다음 주의 02:30은 존재하지 않는다. 기존 시간 함수는 03:00으로 맞춘다.
    const rows = await database.db
      .insert(spaceBlocks)
      .values([
        {
          spaceId: actors.publicSpaceId,
          createdBy: actors.operator.userId,
          during: {
            start: new Date("2026-03-08T09:59:00Z"),
            end: new Date("2026-03-08T11:00:00Z"),
          },
          reason: "경계 안",
        },
        {
          spaceId: actors.publicSpaceId,
          createdBy: actors.operator.userId,
          during: {
            start: new Date("2026-03-08T10:00:00Z"),
            end: new Date("2026-03-08T11:00:00Z"),
          },
          reason: "경계 밖",
        },
      ])
      .returning();
    const result = await subject(actors.operator, now).getAdminDashboard({
      branchId: actors.branchId,
    });
    expect(result.maintenance.map(({ id }) => id)).toEqual([rows[0]!.id]);
  });
  it("allows a stats-only operator to read a restricted floor's allowlisted published document", async () => {
    const plan = await publishedPlan();
    await database.db
      .update(floors)
      .set({ access: "closed" })
      .where(eq(floors.id, actors.floorId));
    await database.db.insert(roleSettings).values({
      branchId: actors.branchId,
      role: "operator",
      permissions: ["stats.view"],
    });
    const result = await query({ floorId: actors.floorId });
    expect(result.plan).toMatchObject({ id: plan.id, version: 1 });
    const serialized = JSON.stringify(result);
    for (const secret of [
      "background",
      "editorNote",
      "private-background-key",
      "private-seat-name",
      actors.person.email,
    ])
      expect(serialized).not.toContain(secret);
    expect(result.plan?.document.spaces).toHaveLength(1);
    expect((await query()).plan).toBeNull();
  });
  it("keeps the populated plan budget at exactly [6,5] as rooms/bookings grow and binds all clocks", async () => {
    await publishedPlan();
    await insertFixtureBooking(database, actors);
    await block(actors.publicSpaceId, "12:00", "13:00");
    for (const count of [0, 20]) {
      if (count) {
        const rows = await database.db
          .insert(spaces)
          .values(
            Array.from({ length: count }, (_, index) => ({
              floorId: actors.floorId,
              type: "meeting_room" as const,
              name: `추가 회의실 ${index}`,
            })),
          )
          .returning();
        await database.db.insert(bookings).values(
          rows.map((row) => ({
            spaceId: row.id,
            userId: actors.member.userId,
            during: bookingRange("13:00", "14:00"),
          })),
        );
      }
      const records = vi.spyOn(database.client, "query");
      meter.start();
      const result = await query({ floorId: actors.floorId });
      const budget = meter.stop();
      expect(budget).toEqual({ stages: 2, statements: 11, perStage: [6, 5] });
      expect(result.spaces.length).toBeGreaterThan(0);
      expect(result.cards.bookingCount).toBe(count + 1);
      expect(
        records.mock.calls.map(([statement]) => statement).join("\n"),
      ).not.toMatch(/\bnow\s*\(/i);
      records.mockRestore();
    }
    meter.start();
    await query();
    expect(meter.stop().perStage).toEqual([6, 4]);
  });
});

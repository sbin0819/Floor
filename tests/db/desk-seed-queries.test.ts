import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBookingQueries } from "@/features/bookings/query-factory";
import { createDeskParts } from "@/features/bookings/desk-parts";
import { createAuth } from "@/lib/auth/auth";
import type { Session } from "@/lib/auth/types";
import { users } from "@/lib/db/schema";
import { createMemoryEmailSender } from "@/lib/email/memory";
import { loadSeedData } from "@/lib/seed/data";
import { runSeed } from "@/lib/seed/run-seed";
import { expandSeedSchedule, loadSeedSchedule } from "@/lib/seed/schedule";
import { localDate } from "@/lib/time/zoned";
import { createTestDatabase, type TestDatabase } from "./helper";

// 수요일 09:00 KST. 좌석 단골과 채우기가 모두 있는 평일이다.
const now = new Date("2026-11-04T00:00:00Z");
const data = loadSeedData();
const schedule = expandSeedSchedule(loadSeedSchedule(data), data, now);
const area = data.spaces.find(
  ({ type, name }) => type === "desk_area" && name === "오픈 데스크",
)!;
const floor = data.floors.find(({ id }) => id === area.floorId)!;
const branch = data.branches.find(({ id }) => id === floor.branchId)!;
const desks = data.spaces.filter(
  (space) => space.type === "desk" && space.parentId === area.id,
);

/** 시드 일정에서 그날 좌석 구간마다 비어 있는 자리 수를 계산한다. */
function expectedFreeCounts(date: string) {
  const parts = createDeskParts({
    date,
    timeZone: branch.timezone,
    openHours: branch.openHours,
  });
  const busy = (deskId: string, start: number, end: number) =>
    schedule.bookings.some(
      (booking) =>
        booking.spaceId === deskId &&
        booking.status === "confirmed" &&
        booking.during.start.getTime() < end &&
        start < booking.during.end.getTime(),
    ) ||
    schedule.blocks.some(
      (block) =>
        (block.spaceId === deskId || block.spaceId === area.id) &&
        block.during.start.getTime() < end &&
        start < block.during.end.getTime(),
    );
  return parts.map(
    ({ start, end }) =>
      desks.filter((desk) => !busy(desk.id, Date.parse(start), Date.parse(end)))
        .length,
  );
}

describe("seeded seat availability", () => {
  let database: TestDatabase;
  let session: Session;
  beforeAll(async () => {
    database = await createTestDatabase();
    const auth = createAuth({
      db: database.db,
      email: createMemoryEmailSender(),
      secret: "desk-seed-query-secret-with-at-least-32-bytes",
      baseUrl: "http://localhost:3000",
      rateLimit: { enabled: false },
    });
    await runSeed({ db: database.db, auth, now, resetPasswords: false });
    const [member] = await database.db
      .select()
      .from(users)
      .where(eq(users.email, "test1@ai.com"));
    session = { userId: member!.id, email: member!.email, name: member!.name };
  });
  afterAll(async () => {
    await database.client.close();
  });
  const query = (current = now) =>
    createBookingQueries({
      database: database.db,
      requireSession: async () => session,
      now: () => current,
    });
  const today = localDate(now, branch.timezone);
  const tomorrow = "2026-11-05";

  it.each([today, tomorrow])(
    "reports exactly the free counts implied by the seeded schedule for %s",
    async (date) => {
      const counts = expectedFreeCounts(date);
      expect(counts).toHaveLength(3);
      expect(counts.some((count) => count < desks.length)).toBe(true);
      const result = await query().getSpaceDay(
        floor.branchId,
        floor.id,
        area.id,
        date,
      );
      expect(result.desk?.parts.map(({ freeCount }) => freeCount)).toEqual(
        counts,
      );
      expect(result.desk?.seats).toHaveLength(24);
      // 책상 수리 중인 A-24는 모든 구간이 점검이다.
      expect(
        result.desk?.seats.find(({ name }) => name === "A-24")?.states,
      ).toEqual({ am: "blocked", pm: "blocked", day: "blocked" });
      const row = (
        await query().getFloorDay(floor.branchId, floor.id, date)
      ).spaces.find(({ id }) => id === area.id)!;
      expect(row.kind).toBe("accessible");
      if (row.kind === "accessible")
        expect(row.deskParts?.map(({ freeCount }) => freeCount)).toEqual(
          counts.slice(0, 2),
        );
    },
  );

  it("shows the member's own seat for a regular day, the exact layout and no other occupant identity", async () => {
    const result = await query().getSpaceDay(
      floor.branchId,
      floor.id,
      area.id,
      tomorrow,
    );
    // 김하은은 화·목 종일 A-15 단골이다.
    expect(result.desk?.myBookings).toEqual([
      expect.objectContaining({
        deskName: "A-15",
        part: "day",
        canCancel: true,
      }),
    ]);
    expect(
      result.desk?.seats.find(({ name }) => name === "A-01"),
    ).toMatchObject({ row: 0, column: 0 });
    expect(
      result.desk?.seats.find(({ name }) => name === "A-24"),
    ).toMatchObject({ row: 3, column: 5 });
    for (const other of data.users.filter(({ key }) => key !== "member"))
      expect(JSON.stringify(result.desk)).not.toContain(other.name);
  });

  it("marks every part unselectable after closing without pretending the booked seats are free", async () => {
    const result = await query(new Date("2026-11-04T14:00:00Z")).getSpaceDay(
      floor.branchId,
      floor.id,
      area.id,
      today,
    );
    expect(result.desk?.parts.every(({ selectable }) => !selectable)).toBe(
      true,
    );
    expect(result.desk?.parts.map(({ freeCount }) => freeCount)).toEqual(
      expectedFreeCounts(today),
    );
  });
});

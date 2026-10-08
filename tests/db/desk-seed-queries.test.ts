import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBookingQueries } from "@/features/bookings/query-factory";
import { createAuth } from "@/lib/auth/auth";
import type { Session } from "@/lib/auth/types";
import { users } from "@/lib/db/schema";
import { createMemoryEmailSender } from "@/lib/email/memory";
import { loadSeedData } from "@/lib/seed/data";
import { runSeed } from "@/lib/seed/run-seed";
import { createTestDatabase, type TestDatabase } from "./helper";

const now = new Date("2026-10-08T00:00:00Z");
const data = loadSeedData();
const area = data.spaces.find(
  ({ type, name }) => type === "desk_area" && name === "오픈 데스크",
)!;
const floor = data.floors.find(({ id }) => id === area.floorId)!;

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
  it.each([
    ["2026-10-08", [19, 19, 18]],
    ["2026-10-09", [20, 20, 19]],
  ])("reports the exact seeded free counts for %s", async (date, counts) => {
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
  });
  it("shows the member's next operating day seat, exact layout and no other occupant identity", async () => {
    const result = await query().getSpaceDay(
      floor.branchId,
      floor.id,
      area.id,
      "2026-10-09",
    );
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
    const result = await query(new Date("2026-10-08T14:00:00Z")).getSpaceDay(
      floor.branchId,
      floor.id,
      area.id,
      "2026-10-08",
    );
    expect(result.desk?.parts.every(({ selectable }) => !selectable)).toBe(
      true,
    );
    expect(result.desk?.parts.map(({ freeCount }) => freeCount)).toEqual([
      19, 19, 18,
    ]);
  });
});

import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createAdminShellQueries } from "@/features/admin/admin-shell-query-factory";
import { ActionError } from "@/lib/actions/result";
import {
  branches,
  branchStaff,
  roleSettings,
  spaceBlocks,
} from "@/lib/db/schema";
import * as shellDal from "@/lib/dal/admin-shell";
import type { Session } from "@/lib/auth/types";
import { createTestDatabase, type TestDatabase } from "./helper";
import {
  bookingNow,
  bookingRange,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createQueryMeter } from "./query-meter";

describe("operator shell projection and budget", () => {
  let database: TestDatabase;
  let actors: BookingActors;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    actors = await seedBookingActors(database);
  });
  const query = (session?: Session) =>
    createAdminShellQueries({
      database: database.db,
      requireSession: async () => session ?? actors.operator,
      now: () => bookingNow,
    });

  it("checks session before malformed input or any SQL", async () => {
    const read = vi.spyOn(database.client, "query");
    const service = createAdminShellQueries({
      database: database.db,
      requireSession: async () => {
        throw new ActionError("UNAUTHENTICATED");
      },
    });
    await expect(service.getAdminShell("bad")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
  });
  it.each(["bad", "missing", "other", "member"])(
    "does not reveal %s branch",
    async (kind) => {
      const id =
        kind === "bad"
          ? "bad"
          : kind === "missing"
            ? crypto.randomUUID()
            : kind === "other"
              ? actors.otherBranchId
              : actors.branchId;
      await expect(
        query(kind === "member" ? actors.person : undefined).getAdminShell(id),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    },
  );
  it("returns only current operator branch names, implemented menus and own name", async () => {
    const result = await query().getAdminShell(actors.branchId.toUpperCase());
    expect(result).toEqual({
      branchId: actors.branchId,
      branches: [
        {
          id: actors.branchId,
          name: "강남점",
          menus: ["dashboard", "bookings", "spaces", "maintenance"],
          maintenanceCount: 0,
        },
      ],
      user: { name: actors.operator.name },
    });
    expect(JSON.stringify(result)).not.toContain(actors.operator.email);
  });
  it("computes each branch menu using can rather than copying the current branch permissions", async () => {
    await database.db.insert(branchStaff).values({
      branchId: actors.otherBranchId,
      userId: actors.operator.userId,
    });
    await database.db.insert(roleSettings).values([
      {
        branchId: actors.branchId,
        role: "operator",
        permissions: ["booking.manage_all"],
      },
      {
        branchId: actors.otherBranchId,
        role: "operator",
        permissions: ["plan.edit"],
      },
    ]);
    const result = await query().getAdminShell(actors.branchId);
    expect(result.branches.map((row) => row.menus)).toEqual([
      ["bookings"],
      ["spaces"],
    ]);
    await database.db
      .update(roleSettings)
      .set({ permissions: [] })
      .where(eq(roleSettings.branchId, actors.branchId));
    expect(
      (await query().getAdminShell(actors.branchId)).branches[0]!.menus,
    ).toEqual([]);
  });
  it("still honors a permission granted by another held role", async () => {
    await database.db.insert(roleSettings).values([
      { branchId: actors.branchId, role: "operator", permissions: [] },
      { branchId: actors.branchId, role: "user", permissions: ["stats.view"] },
    ]);
    expect(
      (await query().getAdminShell(actors.branchId)).branches[0]!.menus,
    ).toEqual(["dashboard"]);
  });
  it("uses two stages [4,1] including authorized maintenance counts independent of the number of assigned branches", async () => {
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      await query().getAdminShell(actors.branchId);
      expect(meter.stop()).toEqual({
        stages: 2,
        statements: 5,
        perStage: [4, 1],
      });
      const extra = Array.from({ length: 8 }, (_, index) => ({
        id: crypto.randomUUID(),
        name: `추가 ${index}점`,
      }));
      await database.db.insert(branches).values(extra);
      await database.db.insert(branchStaff).values(
        extra.map(({ id }) => ({
          branchId: id,
          userId: actors.operator.userId,
        })),
      );
      meter.start();
      const result = await query().getAdminShell(actors.branchId);
      expect(meter.stop()).toEqual({
        stages: 2,
        statements: 5,
        perStage: [4, 1],
      });
      expect(result.branches).toHaveLength(9);
    } finally {
      meter.restore();
    }
  });
  it("counts ongoing blocks only and never queries counts for a branch without space.manage", async () => {
    await database.db.insert(spaceBlocks).values([
      {
        spaceId: actors.publicSpaceId,
        during: bookingRange("12:00", "13:00"),
        createdBy: actors.operator.userId,
      },
      {
        spaceId: actors.publicSpaceId,
        during: bookingRange("13:00", "14:00"),
        createdBy: actors.operator.userId,
      },
      {
        spaceId: actors.secondSpaceId,
        during: bookingRange("11:00", "12:10"),
        createdBy: actors.operator.userId,
      },
    ]);
    expect(
      (await query().getAdminShell(actors.branchId)).branches[0]
        ?.maintenanceCount,
    ).toBe(1);
    await database.db
      .insert(roleSettings)
      .values({
        branchId: actors.branchId,
        role: "operator",
        permissions: ["stats.view"],
      });
    const read = vi.spyOn(shellDal, "getOngoingMaintenanceCounts");
    const result = await query().getAdminShell(actors.branchId);
    expect(read).toHaveBeenCalledWith([], bookingNow, database.db);
    expect(result.branches[0]).not.toHaveProperty("maintenanceCount");
    read.mockRestore();
  });
});

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
import { createAdminQueries } from "@/features/admin/query-factory";
import { ActionError } from "@/lib/actions/result";
import * as adminDal from "@/lib/dal/admin";
import type { Session } from "@/lib/auth/types";
import { roleSettings, teams } from "@/lib/db/schema";
import { createTestDatabase, type TestDatabase } from "./helper";
import { seedBookingActors, type BookingActors } from "./booking-helper";

describe("operator administration query boundaries", () => {
  let database: TestDatabase;
  let fixture: BookingActors;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    fixture = await seedBookingActors(database);
  });
  const queries = (session?: Session) =>
    createAdminQueries({
      database: database.db,
      requireSession: async () => session ?? fixture.operator,
    });

  it("requires a session before either public query validates IDs or reads data", async () => {
    const requireSession = vi.fn(async (): Promise<Session> => {
      throw new ActionError("UNAUTHENTICATED");
    });
    const subject = createAdminQueries({
      database: database.db,
      requireSession,
    });
    await expect(subject.getAdminBranch("bad")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    await expect(
      subject.getAdminFloor("bad", "bad", "검색"),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(requireSession).toHaveBeenCalledTimes(2);
  });
  it.each(["person", "otherOperator"] as const)(
    "hides another operator's branch and floor from %s",
    async (key) => {
      const metadata = vi.spyOn(adminDal, "listAdminSpaceDetails");
      const counts = vi.spyOn(adminDal, "countActiveSpacesByFloor");
      await expect(
        queries(fixture[key]).getAdminBranch(fixture.branchId),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(metadata).not.toHaveBeenCalled();
      expect(counts).not.toHaveBeenCalled();
      await expect(
        queries(fixture[key]).getAdminFloor(fixture.branchId, fixture.floorId),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(metadata).not.toHaveBeenCalled();
      expect(counts).not.toHaveBeenCalled();
    },
  );
  it("makes malformed, nonexistent and forged branch/floor combinations indistinguishable", async () => {
    for (const id of ["bad", crypto.randomUUID()]) {
      await expect(queries().getAdminBranch(id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(
        queries().getAdminFloor(fixture.branchId, id),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    await expect(
      queries().getAdminFloor(fixture.branchId, fixture.otherFloorId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      queries().getAdminFloor(fixture.otherBranchId, fixture.floorId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("returns managed branch fields, ordered floors and only active non-seat counts", async () => {
    const result = await queries().getAdminBranch(fixture.branchId);
    expect(result.branch).toEqual({
      id: fixture.branchId,
      name: "강남점",
      address: "가상로 7",
      timezone: "Asia/Seoul",
      openHours: { sun: null },
    });
    expect(result.floors.map(({ id }) => id)).toEqual([
      fixture.floorId,
      fixture.restrictedFloorId,
    ]);
    expect(result.floors[0]).toMatchObject({
      spaceCount: 5,
      access: "everyone",
    });
    expect(result.floors[1]).toMatchObject({ spaceCount: 1, access: "teams" });
    expect(result.permissions).toEqual({
      manageSpaces: true,
      editAccess: true,
    });
  });
  it("exposes permission flags without hiding the read-only management sections", async () => {
    await database.db.insert(roleSettings).values({
      branchId: fixture.branchId,
      role: "operator",
      permissions: ["space.manage"],
    });
    const data = await queries().getAdminFloor(
      fixture.branchId,
      fixture.floorId,
    );
    expect(data.permissions).toEqual({ manageSpaces: true, editAccess: false });
    expect(data.spaces.length).toBeGreaterThan(0);
    await database.db
      .update(roleSettings)
      .set({ permissions: [] })
      .where(eq(roleSettings.branchId, fixture.branchId));
    await expect(
      queries().getAdminBranch(fixture.branchId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      queries().getAdminFloor(fixture.branchId, fixture.floorId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      queries().getAdminFloor(fixture.branchId, fixture.otherFloorId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("includes archived rooms and grant names, counts seats without returning seat rows or contact fields", async () => {
    await database.db.update(teams).set({ contactPhone: "010-9999-8888" });
    const result = await queries().getAdminFloor(
      fixture.branchId,
      fixture.floorId,
      "그로스",
    );
    expect(result.spaces).toHaveLength(6);
    expect(
      result.spaces.find(({ id }) => id === fixture.archivedSpaceId)
        ?.archivedAt,
    ).toBeTypeOf("string");
    expect(
      result.spaces.find(({ id }) => id === fixture.deskAreaId)?.deskCount,
    ).toBe(2);
    expect(result.spaces.some(({ id }) => id === fixture.deskId)).toBe(false);
    expect(
      result.spaces.find(({ id }) => id === fixture.restrictedSpaceId)
        ?.allowedTeams,
    ).toEqual([{ id: fixture.teamId, name: "그로스팀" }]);
    const restricted = await queries().getAdminFloor(
      fixture.branchId,
      fixture.restrictedFloorId,
    );
    expect(restricted.floor.allowedTeams).toEqual([
      { id: fixture.teamId, name: "그로스팀" },
    ]);
    const json = JSON.stringify(result);
    for (const hidden of [
      "010-9999-8888",
      "contactPhone",
      "email",
      "userId",
      "createdBy",
      "members",
      "bookingRules",
      "publishedPlanId",
    ])
      expect(json).not.toContain(hidden);
    expect(result.teamSearch.results).toEqual([
      { id: fixture.teamId, name: "그로스팀", homeBranchName: "강남점" },
    ]);
  });
  it.each([
    undefined,
    "",
    "  ",
    "가",
    "가\0나",
    "가".repeat(41),
    ["가상", "팀"],
  ])("does not search for invalid terms %j", async (query) => {
    const result = await queries().getAdminFloor(
      fixture.branchId,
      fixture.floorId,
      query,
    );
    expect(result.teamSearch.valid).toBe(false);
    expect(result.teamSearch.results).toEqual([]);
  });
  it("uses the shared literal name search, NFC/whitespace normalization and ten-result limit", async () => {
    await database.db.insert(teams).values(
      Array.from({ length: 12 }, (_, index) => ({
        name: `가상 팀 ${index}`,
        createdBy: fixture.person.userId,
      })),
    );
    await database.db
      .insert(teams)
      .values({ name: "표시%_\\팀", createdBy: fixture.person.userId });
    const data = await queries().getAdminFloor(
      fixture.branchId,
      fixture.floorId,
      "  가상   팀  ",
    );
    expect(data.teamSearch.query).toBe("가상 팀");
    expect(data.teamSearch.results).toHaveLength(10);
    const literal = await queries().getAdminFloor(
      fixture.branchId,
      fixture.floorId,
      "%_\\",
    );
    expect(literal.teamSearch.results.map(({ name }) => name)).toEqual([
      "표시%_\\팀",
    ]);
    const decomposed = await queries().getAdminFloor(
      fixture.branchId,
      fixture.floorId,
      "그로스".normalize("NFD"),
    );
    expect(decomposed.teamSearch.results[0]?.id).toBe(fixture.teamId);
  });
});

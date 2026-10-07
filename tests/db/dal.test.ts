import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  getMemberships,
  getRoleSettings,
  getSpaceForAccess,
  getUserById,
  withTransaction,
} from "@/lib/dal";
import {
  accessGrants,
  branches,
  branchStaff,
  floors,
  roleSettings,
  spaces,
  teamMembers,
  teams,
  users,
} from "@/lib/db/schema";
import { loadPermissionContext } from "@/lib/permissions/context";
import { can } from "@/lib/permissions/can";
import { canAccess } from "@/lib/permissions/can-access";

import { createTestDatabase, type TestDatabase } from "./helper";

describe("injectable data access layer", () => {
  let database: TestDatabase;
  let userId: string;
  let otherUserId: string;
  let branchId: string;
  let floorId: string;
  let spaceId: string;
  let teamId: string;
  let otherTeamId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database?.client.close();
  });
  beforeEach(async () => {
    await database.db.execute(sql`TRUNCATE TABLE users, branches CASCADE`);
    userId = crypto.randomUUID();
    otherUserId = crypto.randomUUID();
    branchId = crypto.randomUUID();
    floorId = crypto.randomUUID();
    spaceId = crypto.randomUUID();
    teamId = crypto.randomUUID();
    otherTeamId = crypto.randomUUID();
    await database.db.insert(users).values([
      { id: userId, name: "가상 멤버", email: "member@example.test" },
      { id: otherUserId, name: "다른 멤버", email: "other@example.test" },
    ]);
    await database.db
      .insert(branches)
      .values({ id: branchId, name: "가상 지점" });
    await database.db
      .insert(floors)
      .values({ id: floorId, branchId, name: "7F", level: 7, access: "teams" });
    await database.db.insert(spaces).values({
      id: spaceId,
      floorId,
      name: "가상 회의실",
      type: "meeting_room",
      access: "teams",
    });
    await database.db.insert(teams).values([
      { id: teamId, name: "가상 A팀", createdBy: userId },
      { id: otherTeamId, name: "가상 B팀", createdBy: otherUserId },
    ]);
  });

  it("finds the requested profile or returns null", async () => {
    await expect(getUserById(userId, database.db)).resolves.toMatchObject({
      id: userId,
      email: "member@example.test",
      name: "가상 멤버",
    });
    await expect(
      getUserById(crypto.randomUUID(), database.db),
    ).resolves.toBeNull();
  });

  it("returns only the requested user’s team roles and staff branches", async () => {
    await database.db.insert(teamMembers).values([
      { teamId, userId, role: "admin" },
      { teamId: otherTeamId, userId, role: "member" },
      { teamId: otherTeamId, userId: otherUserId, role: "admin" },
    ]);
    await database.db.insert(branchStaff).values({ branchId, userId });
    const memberships = await getMemberships(userId, database.db);
    expect(memberships.teams).toHaveLength(2);
    expect(memberships.teams).toEqual(
      expect.arrayContaining([
        { teamId, role: "admin" },
        { teamId: otherTeamId, role: "member" },
      ]),
    );
    expect(memberships.staffBranchIds).toEqual([branchId]);
    await expect(
      getMemberships(crypto.randomUUID(), database.db),
    ).resolves.toEqual({ teams: [], staffBranchIds: [] });
  });

  it("keeps missing role settings absent and preserves empty permissions and null limits", async () => {
    await expect(getRoleSettings(branchId, database.db)).resolves.toEqual({});
    await database.db.insert(roleSettings).values([
      {
        branchId,
        role: "user",
        permissions: ["floor.view", "unknown.permission"],
        limits: { maxMinutesPerBooking: null },
      },
      { branchId, role: "operator", permissions: [], limits: {} },
    ]);
    await expect(getRoleSettings(branchId, database.db)).resolves.toEqual({
      user: {
        permissions: ["floor.view"],
        limits: { maxMinutesPerBooking: null },
      },
      operator: { permissions: [], limits: {} },
    });
    await expect(
      getRoleSettings(crypto.randomUUID(), database.db),
    ).resolves.toEqual({});
  });

  it("loads the space and floor with separately scoped allowed-team lists", async () => {
    await database.db.insert(accessGrants).values([
      { targetType: "floor", targetId: floorId, teamId },
      { targetType: "floor", targetId: floorId, teamId: otherTeamId },
      { targetType: "space", targetId: spaceId, teamId },
      { targetType: "space", targetId: floorId, teamId: otherTeamId },
      { targetType: "floor", targetId: spaceId, teamId: otherTeamId },
    ]);
    const space = await getSpaceForAccess(spaceId, database.db);
    expect(space).toMatchObject({
      id: spaceId,
      name: "가상 회의실",
      access: "teams",
      allowedTeamIds: [teamId],
      floor: { id: floorId, branchId, access: "teams" },
    });
    expect(space?.floor.allowedTeamIds).toEqual(
      expect.arrayContaining([teamId, otherTeamId]),
    );
    expect(space?.floor.allowedTeamIds).toHaveLength(2);
    await expect(
      getSpaceForAccess(crypto.randomUUID(), database.db),
    ).resolves.toBeNull();
  });

  it("loads a permission context that can use the same access predicates as actions", async () => {
    await database.db
      .insert(teamMembers)
      .values({ teamId, userId, role: "admin" });
    await database.db
      .insert(roleSettings)
      .values({ branchId, role: "user", permissions: ["floor.view"] });
    await database.db.insert(accessGrants).values([
      { targetType: "floor", targetId: floorId, teamId },
      { targetType: "space", targetId: spaceId, teamId },
    ]);
    const context = await loadPermissionContext(
      { userId, name: "가상 멤버", email: "member@example.test" },
      branchId,
      database.db,
    );
    const space = await getSpaceForAccess(spaceId, database.db);
    if (!space) throw new Error("Expected the fixture space");
    expect(can(context, "booking.own", { branchId })).toBe(false);
    expect(can(context, "booking.team", { branchId, teamId })).toBe(true);
    expect(canAccess(context, space)).toBe(true);
  });

  it("commits a transaction and lets reads use its uncommitted changes", async () => {
    const result = await withTransaction(async (transaction) => {
      await transaction
        .update(users)
        .set({ name: "변경된 이름" })
        .where(eq(users.id, userId));
      return getUserById(userId, transaction);
    }, database.db);
    expect(result?.name).toBe("변경된 이름");
    expect((await getUserById(userId, database.db))?.name).toBe("변경된 이름");
  });

  it("rolls back all transaction changes when a callback fails", async () => {
    const failure = new Error("abort transaction");
    await expect(
      withTransaction(async (transaction) => {
        await transaction
          .update(users)
          .set({ name: "롤백할 이름" })
          .where(eq(users.id, userId));
        expect((await getUserById(userId, transaction))?.name).toBe(
          "롤백할 이름",
        );
        throw failure;
      }, database.db),
    ).rejects.toBe(failure);
    expect((await getUserById(userId, database.db))?.name).toBe("가상 멤버");
  });
});

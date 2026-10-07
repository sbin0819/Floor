import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import { createTeamActions } from "@/features/teams/create-team-factory";
import { branches, teamMembers, teams } from "@/lib/db/schema";
import { createTestDatabase, type TestDatabase } from "./helper";
import { seedTeam, seedTeamActors, type TeamActors } from "./team-helper";

describe("team creation actions", () => {
  let database: TestDatabase;
  let actors: TeamActors;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    actors = await seedTeamActors(database);
  });
  const input = (name = "가상 팀") => ({
    name,
    homeBranchId: actors.branchId,
    headcount: 12,
    contactPhone: "+82 10-1234-5678",
    title: "  팀장  ",
  });
  const actions = () =>
    createTeamActions({
      database: database.db,
      getSession: async () => actors.owner,
      logError: vi.fn(),
    });

  it("creates a normalized team and its session-derived administrator atomically", async () => {
    const result = await actions().createTeam(input("  가상   팀  "));
    expect(result).toMatchObject({
      ok: true,
      data: { id: expect.any(String) },
    });
    if (!result.ok) throw new Error("Expected team creation success.");
    expect((await database.db.select().from(teams))[0]).toMatchObject({
      id: result.data.id,
      name: "가상 팀",
      createdBy: actors.owner.userId,
      homeBranchId: actors.branchId,
      headcount: 12,
      contactPhone: "+821012345678",
    });
    expect(await database.db.select().from(teamMembers)).toMatchObject([
      {
        teamId: result.data.id,
        userId: actors.owner.userId,
        role: "admin",
        title: "팀장",
      },
    ]);
  });

  it.each([
    ["Acme", "acme "],
    ["Acme  Inc", "Acme Inc"],
    ["가상", "가상"],
  ])(
    "maps the actual unique violation for %s and %s",
    async (first, duplicate) => {
      expect((await actions().createTeam(input(first))).ok).toBe(true);
      expect(await actions().createTeam(input(duplicate))).toEqual({
        ok: false,
        code: "TEAM_NAME_TAKEN",
      });
      expect(await database.db.select().from(teams)).toHaveLength(1);
      expect(await database.db.select().from(teamMembers)).toHaveLength(1);
    },
  );

  it("rejects the sixth managed team without adding any team or membership", async () => {
    for (let index = 0; index < 5; index++)
      await seedTeam(database, actors.owner, `가상 팀 ${index}`);
    expect(await actions().createTeam(input("여섯 번째 팀"))).toEqual({
      ok: false,
      code: "LIMIT_EXCEEDED",
    });
    expect(await database.db.select().from(teams)).toHaveLength(5);
    expect(await database.db.select().from(teamMembers)).toHaveLength(5);
  });

  it("requires an existing branch when there are branches", async () => {
    expect(
      await actions().createTeam({ ...input(), homeBranchId: null }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(
      await actions().createTeam({
        ...input(),
        homeBranchId: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await database.db.select().from(teams)).toHaveLength(0);
  });

  it("allows an omitted branch when no branches exist", async () => {
    await database.db.delete(branches).where(eq(branches.id, actors.branchId));
    expect(
      (await actions().createTeam({ ...input(), homeBranchId: null })).ok,
    ).toBe(true);
    expect(
      (await database.db.select().from(teams))[0]?.homeBranchId,
    ).toBeNull();
  });

  it("authenticates before validating input and never accepts a forged owner", async () => {
    const anonymous = createTeamActions({
      database: database.db,
      getSession: async () => null,
    });
    expect(await anonymous.createTeam(null)).toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    expect(
      await actions().createTeam({
        ...input(),
        userId: actors.otherOwner.userId,
      }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await database.db.select().from(teams)).toHaveLength(0);
  });

  it("allows only one same-name creation across separate authenticated callers", async () => {
    const other = createTeamActions({
      database: database.db,
      getSession: async () => actors.otherOwner,
      logError: vi.fn(),
    });
    const results = await Promise.all([
      actions().createTeam(input("동시 팀")),
      other.createTeam(input("동시 팀")),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, code: "TEAM_NAME_TAKEN" },
    ]);
    expect(await database.db.select().from(teams)).toHaveLength(1);
    expect(await database.db.select().from(teamMembers)).toHaveLength(1);
  });
});

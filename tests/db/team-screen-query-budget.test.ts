import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTeamQueries } from "@/features/teams/query-factory";
import { createHomeQueries } from "@/features/home/query-factory";
import { ActionError } from "@/lib/actions/result";
import {
  teamInvites,
  teamJoinRequests,
  teamMembers,
  teams,
} from "@/lib/db/schema";
import { createTestDatabase, type TestDatabase } from "./helper";
import { seedTeam, seedTeamActors, type TeamActors } from "./team-helper";
import { createQueryMeter } from "./query-meter";

describe("team screen projections and query budgets", () => {
  let database: TestDatabase;
  let actors: TeamActors;
  let teamId: string;
  let meter: ReturnType<typeof createQueryMeter>;
  const now = new Date("2030-01-31T12:00:00Z");
  beforeAll(async () => {
    database = await createTestDatabase();
    actors = await seedTeamActors(database);
    const team = await seedTeam(database, actors.owner, "가상 대표 팀");
    teamId = team.id;
    await database.db
      .update(teams)
      .set({ homeBranchId: actors.branchId })
      .where(eq(teams.id, teamId));
    await database.db
      .insert(teamMembers)
      .values({ teamId, userId: actors.member.userId });
    await database.db.insert(teamInvites).values({
      teamId,
      createdBy: actors.owner.userId,
      email: actors.outsider.email,
      token: "screen-budget-recipient-token",
      expiresAt: new Date("2030-02-01T12:00:00Z"),
    });
    const cases = [
      {
        name: "경계 포함",
        status: "rejected",
        decidedAt: new Date("2030-01-01T12:00:00Z"),
      },
      {
        name: "경계 밖",
        status: "rejected",
        decidedAt: new Date("2030-01-01T11:59:59Z"),
      },
      { name: "승인됨", status: "approved", decidedAt: now },
      { name: "취소됨", status: "cancelled", decidedAt: now },
      { name: "재요청", status: "rejected", decidedAt: now },
      { name: "다시 취소", status: "rejected", decidedAt: now },
      { name: "이미 소속", status: "rejected", decidedAt: now },
      { name: "여러 거절", status: "rejected", decidedAt: now },
    ] as const;
    for (const item of cases) {
      const row = await seedTeam(database, actors.owner, item.name);
      await database.db.insert(teamJoinRequests).values({
        teamId: row.id,
        userId: actors.outsider.userId,
        status: item.status,
        decidedAt: item.decidedAt,
        createdAt: new Date("2029-12-31T00:00:00Z"),
        message: "older",
      });
      if (
        item.name === "재요청" ||
        item.name === "다시 취소" ||
        item.name === "여러 거절"
      )
        await database.db.insert(teamJoinRequests).values({
          teamId: row.id,
          userId: actors.outsider.userId,
          status:
            item.name === "재요청"
              ? "pending"
              : item.name === "다시 취소"
                ? "cancelled"
                : "rejected",
          decidedAt: item.name === "재요청" ? null : now,
          createdAt: new Date("2030-01-30T00:00:00Z"),
          message: "newer",
        });
      if (item.name === "이미 소속")
        await database.db
          .insert(teamMembers)
          .values({ teamId: row.id, userId: actors.outsider.userId });
    }
    meter = createQueryMeter(database.client);
  });
  afterAll(async () => {
    meter.restore();
    await database.client.close();
  });
  const queries = (session = actors.outsider) =>
    createTeamQueries({
      database: database.db,
      requireSession: async () => session,
      now: () => now,
    });

  it("includes exactly the thirty-day rejection cutoff and only the latest request for a nonmember", async () => {
    const data = await queries().getTeamsData();
    expect(data.requests.map((request) => request.teamName).sort()).toEqual(
      ["경계 포함", "여러 거절", "재요청"].sort(),
    );
    expect(
      data.requests.find((request) => request.teamName === "경계 포함")
        ?.decidedAt,
    ).toBe("2030-01-01T12:00:00.000Z");
    expect(
      data.requests.find((request) => request.teamName === "여러 거절")
        ?.message,
    ).toBe("newer");
    expect(
      data.requests.find((request) => request.teamName === "재요청")?.status,
    ).toBe("pending");
  });
  it("counts only my teams and exposes their public home branch without privileged fields", async () => {
    const data = await queries(actors.member).getTeamsData();
    expect(data.teams).toEqual([
      {
        id: teamId,
        name: "가상 대표 팀",
        role: "member",
        memberCount: 2,
        homeBranchName: "가상 지점",
      },
    ]);
    expect(JSON.stringify(data)).not.toContain("contactPhone");
    expect(JSON.stringify(data)).not.toContain(actors.owner.email);
    expect(
      (await queries().getTeamsData()).teams.map((team) => team.name),
    ).toEqual(["이미 소속"]);
  });
  it("keeps search and home projections smaller than the team hub", async () => {
    const search = await queries().getTeamStartData("재요청");
    expect(search.search.results[0]).toMatchObject({
      hasRequest: true,
      isMember: false,
      hasInvite: false,
    });
    expect(search.search.results[0]).not.toHaveProperty("memberCount");
    expect(search.invites).toEqual([{ teamName: "가상 대표 팀" }]);
    expect(search).not.toHaveProperty("requests");
    const home = await createHomeQueries({
      database: database.db,
      requireSession: async () => actors.outsider,
      now: () => now,
    }).getHomeTodo();
    expect(home.teamInvites).toBe(1);
    expect(home).not.toHaveProperty("teams");
    expect(JSON.stringify(home)).not.toContain("screen-budget-recipient-token");
  });
  it("checks the session for the team hub before database access", async () => {
    const denied = createTeamQueries({
      database: database.db,
      requireSession: async () => {
        throw new ActionError("UNAUTHENTICATED");
      },
    });
    meter.start();
    await expect(denied.getTeamsData()).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(meter.stop().statements).toBe(0);
  });
  it.each([
    "hub",
    "start-search",
    "start-empty",
    "detail-admin",
    "detail-member",
    "invite",
  ])(
    "keeps %s within two stages and six statements per stage",
    async (kind) => {
      meter.start();
      if (kind === "hub") await queries().getTeamsData();
      if (kind === "start-search") await queries().getTeamStartData("재요청");
      if (kind === "start-empty") await queries().getTeamStartData();
      if (kind === "detail-admin")
        await queries(actors.owner).getTeamPageData(teamId);
      if (kind === "detail-member")
        await queries(actors.member).getTeamPageData(teamId);
      if (kind === "invite")
        await queries().getInvitePageData("screen-budget-recipient-token");
      const result = meter.stop();
      expect(result.stages).toBeLessThanOrEqual(2);
      expect(result.perStage.every((count) => count <= 6)).toBe(true);
      console.info("TEAM_SCREEN_BUDGET", kind, JSON.stringify(result));
    },
  );
});

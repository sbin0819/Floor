import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { and, eq } from "drizzle-orm";
import { createJoinRequestActions } from "@/features/teams/join-request-factory";
import type { Session } from "@/lib/auth/types";
import {
  branchStaff,
  roleSettings,
  teamInvites,
  teamJoinRequests,
  teamMembers,
} from "@/lib/db/schema";
import { createTestDatabase, type TestDatabase } from "./helper";
import { seedTeam, seedTeamActors, type TeamActors } from "./team-helper";

describe("team join request actions", () => {
  let database: TestDatabase;
  let actors: TeamActors;
  let teamId: string;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    actors = await seedTeamActors(database);
    teamId = (await seedTeam(database, actors.owner)).id;
    await database.db
      .insert(teamMembers)
      .values({ teamId, userId: actors.member.userId, role: "member" });
  });
  const actions = (session: Session | null) =>
    createJoinRequestActions({
      database: database.db,
      getSession: async () => session,
      logError: vi.fn(),
    });
  async function requestedBy(session = actors.outsider) {
    const result = await actions(session).requestTeamJoin({
      teamId,
      message: "함께 일하고 싶어요",
    });
    if (!result.ok)
      throw new Error(`Expected request success, got ${result.code}.`);
    return { requestId: result.data.id };
  }

  it("approves a request using the request's actual team and session actor", async () => {
    const input = await requestedBy();
    expect(await actions(actors.owner).approveTeamJoinRequest(input)).toEqual({
      ok: true,
      data: { teamId },
    });
    expect(
      (await database.db.select().from(teamJoinRequests))[0],
    ).toMatchObject({
      status: "approved",
      userId: actors.outsider.userId,
      decidedBy: actors.owner.userId,
      decidedAt: expect.any(Date),
    });
    expect(
      await database.db
        .select()
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.teamId, teamId),
            eq(teamMembers.userId, actors.outsider.userId),
          ),
        ),
    ).toMatchObject([{ role: "member" }]);
  });

  it("permits a new request after rejection and records the manager's decision", async () => {
    const input = await requestedBy();
    expect((await actions(actors.owner).rejectTeamJoinRequest(input)).ok).toBe(
      true,
    );
    expect(
      (await database.db.select().from(teamJoinRequests))[0],
    ).toMatchObject({
      status: "rejected",
      decidedBy: actors.owner.userId,
      decidedAt: expect.any(Date),
    });
    expect(
      (await actions(actors.outsider).requestTeamJoin({ teamId })).ok,
    ).toBe(true);
  });

  it("maps duplicates from the real pending-request unique index", async () => {
    await requestedBy();
    expect(await actions(actors.outsider).requestTeamJoin({ teamId })).toEqual({
      ok: false,
      code: "ALREADY_REQUESTED",
    });
    expect(await database.db.select().from(teamJoinRequests)).toHaveLength(1);
  });

  it("rejects members and nonexistent teams", async () => {
    expect(await actions(actors.member).requestTeamJoin({ teamId })).toEqual({
      ok: false,
      code: "ALREADY_MEMBER",
    });
    expect(
      await actions(actors.outsider).requestTeamJoin({
        teamId: crypto.randomUUID(),
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it.each(["member", "outsider", "otherOwner", "operator"] as const)(
    "forbids a %s from approving or rejecting a different team's request",
    async (actor) => {
      await seedTeam(database, actors.otherOwner, "다른 팀");
      await database.db
        .insert(branchStaff)
        .values({ branchId: actors.branchId, userId: actors.operator.userId });
      await database.db.insert(roleSettings).values({
        branchId: actors.branchId,
        role: "user",
        permissions: ["team.manage_members"],
      });
      const input = await requestedBy();
      expect(
        await actions(actors[actor]).approveTeamJoinRequest(input),
      ).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(await actions(actors[actor]).rejectTeamJoinRequest(input)).toEqual(
        { ok: false, code: "FORBIDDEN" },
      );
      expect(
        (await database.db.select().from(teamJoinRequests))[0]?.status,
      ).toBe("pending");
    },
  );

  it("rejects caller-supplied team or actor overrides", async () => {
    const input = await requestedBy();
    const otherTeam = await seedTeam(database, actors.otherOwner, "다른 팀");
    expect(
      await actions(actors.otherOwner).approveTeamJoinRequest({
        ...input,
        teamId: otherTeam.id,
      }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(
      await actions(actors.outsider).requestTeamJoin({
        teamId,
        userId: actors.member.userId,
      }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect((await database.db.select().from(teamJoinRequests))[0]?.status).toBe(
      "pending",
    );
  });

  it("only lets the requester cancel a pending request", async () => {
    const input = await requestedBy();
    expect(await actions(actors.member).cancelTeamJoinRequest(input)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await actions(actors.outsider).cancelTeamJoinRequest(input)).toEqual(
      { ok: true, data: { teamId } },
    );
    expect(await actions(actors.outsider).cancelTeamJoinRequest(input)).toEqual(
      { ok: false, code: "NOT_FOUND" },
    );
    expect((await database.db.select().from(teamJoinRequests))[0]?.status).toBe(
      "cancelled",
    );
  });

  it("approves only once even when two calls both begin with pending input", async () => {
    const input = await requestedBy();
    const results = await Promise.all([
      actions(actors.owner).approveTeamJoinRequest(input),
      actions(actors.owner).approveTeamJoinRequest(input),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, code: "NOT_FOUND" },
    ]);
    expect(
      await database.db
        .select()
        .from(teamMembers)
        .where(eq(teamMembers.userId, actors.outsider.userId)),
    ).toHaveLength(1);
  });

  it("does not demote a requester who became an administrator before approval", async () => {
    const input = await requestedBy();
    await database.db
      .insert(teamMembers)
      .values({ teamId, userId: actors.outsider.userId, role: "admin" });
    expect((await actions(actors.owner).approveTeamJoinRequest(input)).ok).toBe(
      true,
    );
    expect(
      (
        await database.db
          .select()
          .from(teamMembers)
          .where(eq(teamMembers.userId, actors.outsider.userId))
      )[0]?.role,
    ).toBe("admin");
  });

  it("accepts the matching pending invite in the approval transaction", async () => {
    const input = await requestedBy();
    await database.db.insert(teamInvites).values({
      teamId,
      createdBy: actors.owner.userId,
      email: actors.outsider.email,
      token: "request-approval-invite",
    });
    expect((await actions(actors.owner).approveTeamJoinRequest(input)).ok).toBe(
      true,
    );
    expect(
      (await database.db.select().from(teamInvites))[0]?.acceptedAt,
    ).toBeInstanceOf(Date);
  });

  it("caps pending requests at ten and gives duplicate conflicts their own code", async () => {
    for (let index = 0; index < 10; index++) {
      const team = await seedTeam(database, actors.owner, `팀 ${index}`);
      await database.db
        .insert(teamJoinRequests)
        .values({ teamId: team.id, userId: actors.outsider.userId });
    }
    expect(await actions(actors.outsider).requestTeamJoin({ teamId })).toEqual({
      ok: false,
      code: "LIMIT_EXCEEDED",
    });
    expect(await database.db.select().from(teamJoinRequests)).toHaveLength(10);
    const existing = (await database.db.select().from(teamJoinRequests))[0]!;
    expect(
      await actions(actors.outsider).requestTeamJoin({
        teamId: existing.teamId,
      }),
    ).toEqual({ ok: false, code: "ALREADY_REQUESTED" });
  });

  it("requires authentication on all four request actions", async () => {
    for (const action of Object.values(actions(null)))
      expect(await action(null)).toEqual({
        ok: false,
        code: "UNAUTHENTICATED",
      });
  });
});

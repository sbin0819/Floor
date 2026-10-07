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
import { createInviteResponseActions } from "@/features/teams/invite-response-factory";
import type { Session } from "@/lib/auth/types";
import {
  teamInvites,
  teamJoinRequests,
  teamMembers,
  users,
} from "@/lib/db/schema";
import { createTestDatabase, type TestDatabase } from "./helper";
import { seedTeam, seedTeamActors, type TeamActors } from "./team-helper";

describe("received team invitation actions", () => {
  let database: TestDatabase;
  let actors: TeamActors;
  let teamId: string;
  let token: string;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    actors = await seedTeamActors(database);
    teamId = (await seedTeam(database, actors.owner)).id;
    token = crypto.randomUUID();
    await database.db
      .insert(teamInvites)
      .values({
        token,
        teamId,
        createdBy: actors.owner.userId,
        email: actors.outsider.email,
      });
  });
  const actions = (session: Session | null = actors.outsider) =>
    createInviteResponseActions({
      database: database.db,
      getSession: async () => session,
      logError: vi.fn(),
    });

  it("accepts a matching invite and creates a member", async () => {
    expect(await actions().acceptTeamInvite({ token })).toEqual({
      ok: true,
      data: { teamId },
    });
    expect(
      (await database.db.select().from(teamInvites))[0]?.acceptedAt,
    ).toBeInstanceOf(Date);
    expect(
      await database.db
        .select()
        .from(teamMembers)
        .where(eq(teamMembers.userId, actors.outsider.userId)),
    ).toMatchObject([{ teamId, role: "member" }]);
  });

  it("declines an invite without creating membership", async () => {
    expect(await actions().declineTeamInvite({ token })).toEqual({
      ok: true,
      data: { teamId },
    });
    expect(
      (await database.db.select().from(teamInvites))[0]?.declinedAt,
    ).toBeInstanceOf(Date);
    expect(
      await database.db
        .select()
        .from(teamMembers)
        .where(eq(teamMembers.userId, actors.outsider.userId)),
    ).toHaveLength(0);
    expect(await actions().acceptTeamInvite({ token })).toEqual({
      ok: false,
      code: "INVITE_INVALID",
    });
  });

  it.each(["expired", "revoked", "declined", "accepted"])(
    "returns only INVITE_INVALID for an %s invite",
    async (state) => {
      const update =
        state === "expired"
          ? { expiresAt: new Date(0) }
          : state === "revoked"
            ? { revokedAt: new Date() }
            : state === "declined"
              ? { declinedAt: new Date() }
              : { acceptedAt: new Date() };
      await database.db.update(teamInvites).set(update);
      for (const action of Object.values(actions()))
        expect(await action({ token })).toEqual({
          ok: false,
          code: "INVITE_INVALID",
        });
    },
  );

  it.each(["", "not-a-token", "x".repeat(512)])(
    "hides invalid token strings including %s",
    async (invalidToken) => {
      expect(await actions().acceptTeamInvite({ token: invalidToken })).toEqual(
        { ok: false, code: "INVITE_INVALID" },
      );
    },
  );

  it("rejects a different email and does not trust a forged session email", async () => {
    expect(await actions(actors.member).acceptTeamInvite({ token })).toEqual({
      ok: false,
      code: "INVITE_INVALID",
    });
    expect(
      await actions({
        ...actors.member,
        email: actors.outsider.email,
      }).acceptTeamInvite({ token }),
    ).toEqual({ ok: false, code: "INVITE_INVALID" });
    expect(
      (await database.db.select().from(teamInvites))[0]?.acceptedAt,
    ).toBeNull();
  });

  it("requires current database email verification for both accept and decline", async () => {
    await database.db
      .update(users)
      .set({ emailVerified: false })
      .where(eq(users.id, actors.outsider.userId));
    for (const action of Object.values(actions()))
      expect(await action({ token })).toEqual({
        ok: false,
        code: "INVITE_INVALID",
      });
  });

  it("does not authorize legacy shared-link invitations with a null email", async () => {
    await database.db.update(teamInvites).set({ email: null });
    expect(await actions().acceptTeamInvite({ token })).toEqual({
      ok: false,
      code: "INVITE_INVALID",
    });
  });

  it("accepts a token only once across competing requests", async () => {
    const results = await Promise.all([
      actions().acceptTeamInvite({ token }),
      actions().acceptTeamInvite({ token }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, code: "INVITE_INVALID" },
    ]);
    expect(
      await database.db
        .select()
        .from(teamMembers)
        .where(eq(teamMembers.userId, actors.outsider.userId)),
    ).toHaveLength(1);
  });

  it("preserves an existing administrator's role during acceptance", async () => {
    await database.db
      .insert(teamMembers)
      .values({ teamId, userId: actors.outsider.userId, role: "admin" });
    expect((await actions().acceptTeamInvite({ token })).ok).toBe(true);
    expect(
      (
        await database.db
          .select()
          .from(teamMembers)
          .where(eq(teamMembers.userId, actors.outsider.userId))
      )[0]?.role,
    ).toBe("admin");
  });

  it("approves the matching pending request with the inviter as decider", async () => {
    await database.db
      .insert(teamJoinRequests)
      .values({ teamId, userId: actors.outsider.userId });
    expect((await actions().acceptTeamInvite({ token })).ok).toBe(true);
    expect(
      (await database.db.select().from(teamJoinRequests))[0],
    ).toMatchObject({
      status: "approved",
      decidedBy: actors.owner.userId,
      decidedAt: expect.any(Date),
    });
  });

  it("requires login before token validation and rejects actor overrides", async () => {
    for (const action of Object.values(actions(null)))
      expect(await action(null)).toEqual({
        ok: false,
        code: "UNAUTHENTICATED",
      });
    expect(
      await actions().acceptTeamInvite({ token, userId: actors.owner.userId }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });
});

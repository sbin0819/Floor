import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getActionErrorCode } from "@/lib/actions/errors";
import * as dal from "@/lib/dal";
import { avatarColorFor } from "@/lib/avatar";
import type { TransactionDatabase } from "@/lib/dal/database";
import * as schema from "@/lib/db/schema";
import {
  branches,
  teamInvites,
  teamMembers,
  teams,
  users,
} from "@/lib/db/schema";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("team data access and state transitions", () => {
  let database: TestDatabase;
  let adminId: string;
  let userId: string;
  let otherId: string;
  let teamId: string;
  let branchId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database?.client.close();
  });
  beforeEach(async () => {
    await database.db.execute(sql`TRUNCATE TABLE users, branches CASCADE`);
    adminId = crypto.randomUUID();
    userId = crypto.randomUUID();
    otherId = crypto.randomUUID();
    teamId = crypto.randomUUID();
    branchId = crypto.randomUUID();
    await database.db.insert(users).values([
      {
        id: adminId,
        name: "관리자",
        username: null,
        email: "admin@example.test",
        emailVerified: true,
      },
      {
        id: userId,
        name: "가입자",
        email: "member@example.test",
        emailVerified: true,
      },
      {
        id: otherId,
        name: "다른 사람",
        email: "other@example.test",
        emailVerified: true,
      },
    ]);
    await database.db
      .insert(branches)
      .values({ id: branchId, name: "가상 지점" });
    await database.db.insert(teams).values({
      id: teamId,
      name: "가상 팀",
      createdBy: adminId,
      homeBranchId: branchId,
      headcount: 10,
      contactPhone: "+821012345678",
    });
    await database.db
      .insert(teamMembers)
      .values({ teamId, userId: adminId, role: "admin", title: "팀장" });
  });

  function teamInput(name = "새 팀") {
    return {
      userId,
      name,
      homeBranchId: branchId,
      headcount: 4,
      contactPhone: "01012345678",
      title: "개발자",
    };
  }
  function requestInput() {
    return { teamId, userId, message: "함께하고 싶어요" };
  }
  function inviteInput() {
    return {
      teamId,
      actorUserId: adminId,
      email: "member@example.test",
      message: "함께해요",
    };
  }
  function rejectAfterWrites(): TransactionDatabase {
    return {
      transaction: (callback) =>
        database.db.transaction(async (transaction) => {
          await callback(transaction);
          throw new Error("Injected failure before commit");
        }),
    };
  }

  it("creates the team and admin membership together with normalized name and title", async () => {
    const result = await dal.createTeam(
      teamInput("  New   Team  "),
      database.db,
    );
    expect(await dal.getTeamById(result.id, database.db)).toMatchObject({
      name: "New Team",
      homeBranchId: branchId,
      headcount: 4,
    });
    expect(await dal.getTeamMember(result.id, userId, database.db)).toEqual({
      role: "admin",
      title: "개발자",
    });
    expect(await dal.getTeamContact(result.id, database.db)).toEqual({
      contactPhone: "01012345678",
    });
  });

  it("rolls back both new team and membership on a late failure", async () => {
    await expect(
      dal.createTeam(teamInput(), rejectAfterWrites()),
    ).rejects.toThrow("Injected failure");
    expect(await database.db.select().from(teams)).toHaveLength(1);
    expect(await dal.listMyTeams(userId, database.db)).toEqual([]);
  });

  it("uses the unique index for case/normalized-space duplicates, including queued concurrent calls", async () => {
    const results = await Promise.allSettled([
      dal.createTeam(teamInput(" Acme  Inc "), database.db),
      dal.createTeam(
        { ...teamInput("acme inc"), userId: otherId },
        database.db,
      ),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    const failure = results.find((result) => result.status === "rejected");
    expect(
      failure?.status === "rejected" && getActionErrorCode(failure.reason),
    ).toBe("TEAM_NAME_TAKEN");
  });

  it("limits administered teams to five and rolls back the sixth team", async () => {
    for (let index = 0; index < 5; index++)
      await dal.createTeam(teamInput(`새 팀 ${index}`), database.db);
    await expect(
      dal.createTeam(teamInput("여섯째 팀"), database.db),
    ).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    expect(await dal.listMyTeams(userId, database.db)).toHaveLength(5);
    expect(
      await database.db.select().from(teams).where(eq(teams.name, "여섯째 팀")),
    ).toEqual([]);
    expect(
      await dal
        .createTeam(teamInput("새 팀 0"), database.db)
        .catch(getActionErrorCode),
    ).toBe("TEAM_NAME_TAKEN");
  });

  it("requires an existing branch when one is available and permits null only when none exist", async () => {
    await expect(
      dal.createTeam({ ...teamInput(), homeBranchId: null }, database.db),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      dal.createTeam(
        { ...teamInput(), homeBranchId: crypto.randomUUID() },
        database.db,
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await database.db.update(teams).set({ homeBranchId: null });
    await database.db.delete(branches);
    await expect(
      dal.createTeam({ ...teamInput(), homeBranchId: null }, database.db),
    ).resolves.toHaveProperty("id");
  });

  it("returns explicit safe list projections and treats search wildcard characters literally", async () => {
    for (const name of [
      "Alpha 50%",
      "Alpha 500",
      "Alpha_X",
      "AlphaAX",
      "Alpha\\X",
    ]) {
      await database.db.insert(teams).values({
        name,
        createdBy: adminId,
        homeBranchId: branchId,
        contactPhone: "secret-phone",
        headcount: 123,
      });
    }
    for (const [query, expected] of [
      ["50%", "Alpha 50%"],
      ["a_x", "Alpha_X"],
      ["a\\x", "Alpha\\X"],
    ]) {
      const result = await dal.searchTeams(query!, database.db);
      expect(result.map(({ name }) => name)).toEqual([expected]);
      expect(Object.keys(result[0]!).sort()).toEqual([
        "homeBranchName",
        "id",
        "name",
      ]);
    }
    expect(await dal.listBranches(database.db)).toEqual([
      { id: branchId, name: "가상 지점" },
    ]);
    expect(await dal.listTeamMembers(teamId, database.db)).toEqual([
      {
        userId: adminId,
        name: "관리자",
        avatar: { color: avatarColorFor(adminId, null), photoUrl: null },
        email: "admin@example.test",
        role: "admin",
        title: "팀장",
      },
    ]);
    expect(await dal.getTeamById(teamId, database.db)).not.toHaveProperty(
      "contactPhone",
    );
    expect(await dal.getTeamIdentity(teamId, database.db)).toEqual({
      id: teamId,
    });
  });

  it("limits normalized case-insensitive search results to ten", async () => {
    await database.db.insert(teams).values(
      Array.from({ length: 12 }, (_, index) => ({
        name: `Acme Group ${index}`,
        createdBy: adminId,
      })),
    );
    expect(await dal.searchTeams("  ACME   GROUP  ", database.db)).toHaveLength(
      10,
    );
  });

  it("creates and approves a request exactly once", async () => {
    const request = await dal.createJoinRequest(requestInput(), database.db);
    expect(await dal.listMyJoinRequests(userId, database.db)).toHaveLength(1);
    expect(await dal.listTeamJoinRequests(teamId, database.db)).toMatchObject([
      { id: request.id, userId, email: "member@example.test" },
    ]);
    await dal.approveJoinRequest(
      { requestId: request.id, actorUserId: adminId },
      database.db,
    );
    await expect(
      dal.approveJoinRequest(
        { requestId: request.id, actorUserId: adminId },
        database.db,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await dal.getTeamMember(teamId, userId, database.db)).toEqual({
      role: "member",
      title: null,
    });
    expect(await dal.getJoinRequestById(request.id, database.db)).toMatchObject(
      { status: "approved", decidedBy: adminId, decidedAt: expect.any(Date) },
    );
    expect(await dal.listTeamJoinRequests(teamId, database.db)).toEqual([]);
  });

  it("uses request unique conflicts, supports reject/reapply, and protects cancellation ownership", async () => {
    const first = await dal.createJoinRequest(requestInput(), database.db);
    expect(
      await dal
        .createJoinRequest(requestInput(), database.db)
        .catch(getActionErrorCode),
    ).toBe("ALREADY_REQUESTED");
    await expect(
      dal.cancelJoinRequest(
        { requestId: first.id, userId: otherId },
        database.db,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await dal.rejectJoinRequest(
      { requestId: first.id, actorUserId: adminId },
      database.db,
    );
    const second = await dal.createJoinRequest(requestInput(), database.db);
    await dal.cancelJoinRequest({ requestId: second.id, userId }, database.db);
    expect(await dal.getJoinRequestById(second.id, database.db)).toMatchObject({
      status: "cancelled",
      decidedBy: null,
      decidedAt: null,
    });
    await expect(
      dal.cancelJoinRequest({ requestId: second.id, userId }, database.db),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await dal.getTeamMember(teamId, userId, database.db)).toBeNull();
  });

  it("rejects member requests, missing teams, and pending request eleven without retaining it", async () => {
    await expect(
      dal.createJoinRequest(
        { ...requestInput(), userId: adminId },
        database.db,
      ),
    ).rejects.toMatchObject({ code: "ALREADY_MEMBER" });
    await expect(
      dal.createJoinRequest(
        { ...requestInput(), teamId: crypto.randomUUID() },
        database.db,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const destinations = await database.db
      .insert(teams)
      .values(
        Array.from({ length: 11 }, (_, index) => ({
          name: `요청 팀 ${index}`,
          createdBy: adminId,
        })),
      )
      .returning({ id: teams.id });
    for (const destination of destinations.slice(0, 10))
      await dal.createJoinRequest(
        { ...requestInput(), teamId: destination.id },
        database.db,
      );
    await expect(
      dal.createJoinRequest(
        { ...requestInput(), teamId: destinations[10]!.id },
        database.db,
      ),
    ).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    expect(await dal.listMyJoinRequests(userId, database.db)).toHaveLength(10);
    expect(
      await dal
        .createJoinRequest(
          { ...requestInput(), teamId: destinations[0]!.id },
          database.db,
        )
        .catch(getActionErrorCode),
    ).toBe("ALREADY_REQUESTED");
  });

  it("creates a 32-byte invite, replaces prior pending invites, and excludes revoked tokens", async () => {
    const first = await dal.createTeamInvite(
      { ...inviteInput(), email: "MEMBER@EXAMPLE.TEST" },
      database.db,
    );
    expect(Buffer.from(first.token, "base64url")).toHaveLength(32);
    expect(first).toMatchObject({
      email: "member@example.test",
      teamName: "가상 팀",
      senderName: "관리자",
    });
    expect(first.expiresAt.getTime() - Date.now()).toBeGreaterThan(
      6.99 * 86400_000,
    );
    const second = await dal.createTeamInvite(inviteInput(), database.db);
    expect(second.token).not.toBe(first.token);
    expect(await dal.getTeamInviteById(first.id, database.db)).toMatchObject({
      revokedAt: expect.any(Date),
    });
    expect(
      await dal.getInviteForRecipient(
        first.token,
        "member@example.test",
        database.db,
      ),
    ).toBeNull();
    expect(
      await dal.listReceivedInvites("MEMBER@EXAMPLE.TEST", database.db),
    ).toMatchObject([{ id: second.id, token: second.token }]);
    const sent = await dal.listSentInvites(teamId, database.db);
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toHaveProperty("token");
  });

  it("accepts a valid invite only once and preserves existing admin membership", async () => {
    const invite = await dal.createTeamInvite(inviteInput(), database.db);
    await database.db
      .insert(teamMembers)
      .values({ teamId, userId, role: "admin", title: "기존 직함" });
    await dal.acceptTeamInvite({ token: invite.token, userId }, database.db);
    await expect(
      dal.acceptTeamInvite({ token: invite.token, userId }, database.db),
    ).rejects.toMatchObject({ code: "INVITE_INVALID" });
    expect(await dal.getTeamMember(teamId, userId, database.db)).toEqual({
      role: "admin",
      title: "기존 직함",
    });
  });

  it.each([
    "wrong-email",
    "unverified",
    "expired",
    "revoked",
    "declined",
    "missing",
  ])(
    "rejects %s invite acceptance without changing membership",
    async (reason) => {
      const invite = await dal.createTeamInvite(inviteInput(), database.db);
      if (reason === "unverified")
        await database.db
          .update(users)
          .set({ emailVerified: false })
          .where(eq(users.id, userId));
      if (reason === "expired")
        await database.db
          .update(teamInvites)
          .set({ expiresAt: new Date(0) })
          .where(eq(teamInvites.id, invite.id));
      if (reason === "revoked")
        await dal.revokeTeamInvite(
          { inviteId: invite.id, actorUserId: adminId },
          database.db,
        );
      if (reason === "declined")
        await dal.declineTeamInvite(
          { token: invite.token, userId },
          database.db,
        );
      await expect(
        dal.acceptTeamInvite(
          {
            token: reason === "missing" ? "missing-token" : invite.token,
            userId: reason === "wrong-email" ? otherId : userId,
          },
          database.db,
        ),
      ).rejects.toMatchObject({ code: "INVITE_INVALID" });
      expect(await dal.getTeamMember(teamId, userId, database.db)).toBeNull();
    },
  );

  it("does not let recipients decline expired invitations but permits administrators to revoke them", async () => {
    const invite = await dal.createTeamInvite(inviteInput(), database.db);
    await database.db
      .update(teamInvites)
      .set({ expiresAt: new Date(0) })
      .where(eq(teamInvites.id, invite.id));
    expect(
      await dal.listReceivedInvites("member@example.test", database.db),
    ).toEqual([]);
    expect(await dal.listSentInvites(teamId, database.db)).toHaveLength(1);
    await expect(
      dal.declineTeamInvite({ token: invite.token, userId }, database.db),
    ).rejects.toMatchObject({ code: "INVITE_INVALID" });
    await dal.revokeTeamInvite(
      { inviteId: invite.id, actorUserId: adminId },
      database.db,
    );
    await expect(
      dal.revokeTeamInvite(
        { inviteId: invite.id, actorUserId: adminId },
        database.db,
      ),
    ).rejects.toMatchObject({ code: "INVITE_INVALID" });
  });

  it("counts expired unprocessed invites toward fifty and allows replacing one at the limit", async () => {
    await database.db.insert(teamInvites).values(
      Array.from({ length: 50 }, (_, index) => ({
        teamId,
        email: `member-${index}@example.test`,
        token: `fixture-${index}`,
        createdBy: adminId,
        expiresAt: new Date(0),
      })),
    );
    await expect(
      dal.createTeamInvite(inviteInput(), database.db),
    ).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    const replacement = await dal.createTeamInvite(
      { ...inviteInput(), email: "member-0@example.test" },
      database.db,
    );
    expect(await dal.listSentInvites(teamId, database.db)).toHaveLength(50);
    expect(
      await dal.getInviteForRecipient(
        replacement.token,
        "member-0@example.test",
        database.db,
      ),
    ).not.toBeNull();
    await expect(
      dal.createTeamInvite(
        { ...inviteInput(), email: "admin@example.test" },
        database.db,
      ),
    ).rejects.toMatchObject({ code: "ALREADY_MEMBER" });
  });

  it.each(["request", "invite"] as const)(
    "reconciles both pending records when %s is processed first",
    async (first) => {
      await database.db
        .insert(teamMembers)
        .values({ teamId, userId: otherId, role: "admin" });
      const request = await dal.createJoinRequest(requestInput(), database.db);
      const invite = await dal.createTeamInvite(
        { ...inviteInput(), actorUserId: otherId },
        database.db,
      );
      if (first === "request") {
        await database.db.update(teamInvites).set({ expiresAt: new Date(0) });
        await dal.approveJoinRequest(
          { requestId: request.id, actorUserId: adminId },
          database.db,
        );
        await expect(
          dal.acceptTeamInvite({ token: invite.token, userId }, database.db),
        ).rejects.toMatchObject({ code: "INVITE_INVALID" });
      } else {
        await dal.acceptTeamInvite(
          { token: invite.token, userId },
          database.db,
        );
        await expect(
          dal.approveJoinRequest(
            { requestId: request.id, actorUserId: adminId },
            database.db,
          ),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      }
      expect(
        await dal.getJoinRequestById(request.id, database.db),
      ).toMatchObject({
        status: "approved",
        decidedBy: first === "request" ? adminId : otherId,
      });
      expect(await dal.getTeamInviteById(invite.id, database.db)).toMatchObject(
        { acceptedAt: expect.any(Date) },
      );
      expect(
        await database.db
          .select()
          .from(teamMembers)
          .where(
            and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)),
          ),
      ).toHaveLength(1);
    },
  );

  it.each(["request", "invite"] as const)(
    "rolls back all %s acceptance writes on late failure",
    async (kind) => {
      const request = await dal.createJoinRequest(requestInput(), database.db);
      const invite = await dal.createTeamInvite(inviteInput(), database.db);
      const operation =
        kind === "request"
          ? dal.approveJoinRequest(
              { requestId: request.id, actorUserId: adminId },
              rejectAfterWrites(),
            )
          : dal.acceptTeamInvite(
              { token: invite.token, userId },
              rejectAfterWrites(),
            );
      await expect(operation).rejects.toThrow("Injected failure");
      expect(
        await dal.getJoinRequestById(request.id, database.db),
      ).toMatchObject({ status: "pending", decidedAt: null });
      expect(await dal.getTeamInviteById(invite.id, database.db)).toMatchObject(
        { acceptedAt: null },
      );
      expect(await dal.getTeamMember(teamId, userId, database.db)).toBeNull();
    },
  );

  it("retries an actual pending-invite unique failure in a fresh transaction only once", async () => {
    const original = await dal.createTeamInvite(inviteInput(), database.db);
    let attempts = 0;
    const transactionStarts: number[] = [];
    const retryDatabase: TransactionDatabase = {
      transaction: (callback) =>
        database.db.transaction(async (transaction) => {
          transactionStarts.push(++attempts);
          const result = await callback(transaction);
          if (attempts === 1)
            await transaction.insert(teamInvites).values({
              teamId,
              email: "member@example.test",
              token: "unique-conflict",
              createdBy: adminId,
            });
          return result;
        }),
    };
    const result = await dal.createTeamInvite(inviteInput(), retryDatabase);
    expect(transactionStarts).toEqual([1, 2]);
    expect(await dal.getTeamInviteById(original.id, database.db)).toMatchObject(
      { revokedAt: expect.any(Date) },
    );
    expect(
      await dal.listReceivedInvites("member@example.test", database.db),
    ).toMatchObject([{ token: result.token }]);
    expect(await database.db.select().from(teamInvites)).toHaveLength(2);
  });

  it("does not retry unrelated unique failures and stops after a second pending-invite collision", async () => {
    for (const constraint of [
      "users_email_unique",
      "team_invites_one_pending",
    ]) {
      let attempts = 0;
      const failingDatabase: TransactionDatabase = {
        transaction: async () => {
          attempts++;
          throw new Error("Database failure", {
            cause: { code: "23505", constraint },
          });
        },
      };
      await expect(
        dal.createTeamInvite(inviteInput(), failingDatabase),
      ).rejects.toThrow("Database failure");
      expect(attempts).toBe(constraint === "team_invites_one_pending" ? 2 : 1);
    }
  });

  it("restores the old pending invitation when a replacement fails before commit", async () => {
    const original = await dal.createTeamInvite(inviteInput(), database.db);
    await expect(
      dal.createTeamInvite(inviteInput(), rejectAfterWrites()),
    ).rejects.toThrow("Injected failure");
    expect(await dal.getTeamInviteById(original.id, database.db)).toMatchObject(
      { revokedAt: null },
    );
    expect(
      await dal.listReceivedInvites("member@example.test", database.db),
    ).toMatchObject([{ token: original.token }]);
    expect(await database.db.select().from(teamInvites)).toHaveLength(1);
  });

  it("keeps queued simultaneous approval and acceptance to one winner and one membership", async () => {
    const request = await dal.createJoinRequest(requestInput(), database.db);
    const invite = await dal.createTeamInvite(inviteInput(), database.db);
    // PGlite는 단일 연결이므로 실제 다중 세션의 데드록 검증은 아니다.
    const outcomes = await Promise.allSettled([
      dal.approveJoinRequest(
        { requestId: request.id, actorUserId: adminId },
        database.db,
      ),
      dal.acceptTeamInvite({ token: invite.token, userId }, database.db),
    ]);
    expect(
      outcomes.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(
      rejected?.status === "rejected" && getActionErrorCode(rejected.reason),
    ).toMatch(/^(NOT_FOUND|INVITE_INVALID)$/);
    expect(
      await database.db
        .select()
        .from(teamMembers)
        .where(
          and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)),
        ),
    ).toHaveLength(1);
    expect(await dal.getJoinRequestById(request.id, database.db)).toMatchObject(
      { status: "approved" },
    );
    expect(await dal.getTeamInviteById(invite.id, database.db)).toMatchObject({
      acceptedAt: expect.any(Date),
    });
  });

  it("locks the correct parent before every limit count", async () => {
    const queries: string[] = [];
    const loggedDatabase = drizzle({
      client: database.client,
      schema,
      logger: {
        logQuery(query) {
          queries.push(query);
        },
      },
    });
    for (const [operation, lockTable, countedTable] of [
      [
        () => dal.createTeam(teamInput(), loggedDatabase),
        "users",
        "team_members",
      ],
      [
        () => dal.createJoinRequest(requestInput(), loggedDatabase),
        "users",
        "team_join_requests",
      ],
      [
        () => dal.createTeamInvite(inviteInput(), loggedDatabase),
        "teams",
        "team_invites",
      ],
    ] as const) {
      queries.length = 0;
      await operation();
      const locked = queries.findIndex(
        (query) =>
          query.includes(`from "${lockTable}"`) && query.endsWith("for update"),
      );
      const counted = queries.findIndex((query) =>
        query.includes(`count(*) from "${countedTable}"`),
      );
      expect(locked).toBeGreaterThanOrEqual(0);
      expect(counted).toBeGreaterThan(locked);
    }
  });

  it("emits user-order then team locks before conditional transitions and membership upserts", async () => {
    const request = await dal.createJoinRequest(requestInput(), database.db);
    const invite = await dal.createTeamInvite(inviteInput(), database.db);
    const queries: string[] = [];
    const loggedDatabase = drizzle({
      client: database.client,
      schema,
      logger: {
        logQuery(query) {
          queries.push(query);
        },
      },
    });
    await dal.acceptTeamInvite({ token: invite.token, userId }, loggedDatabase);
    const userLock = queries.findIndex(
      (query) =>
        query.includes('from "users"') &&
        query.endsWith('order by "users"."id" asc for update'),
    );
    const teamLock = queries.findIndex(
      (query) => query.includes('from "teams"') && query.endsWith("for update"),
    );
    const transition = queries.findIndex((query) =>
      query.startsWith('update "team_invites"'),
    );
    expect(userLock).toBeGreaterThanOrEqual(0);
    expect(teamLock).toBeGreaterThan(userLock);
    expect(transition).toBeGreaterThan(teamLock);
    expect(queries[transition]).toMatch(
      /accepted_at.*is null.*declined_at.*is null.*revoked_at.*is null/,
    );
    expect(queries[transition]).toContain(
      '"expires_at" > statement_timestamp()',
    );
    expect(queries[transition]).toContain("returning");
    expect(
      queries.some((query) =>
        query.includes('on conflict ("team_id","user_id") do nothing'),
      ),
    ).toBe(true);
    expect(await dal.getJoinRequestById(request.id, database.db)).toMatchObject(
      { status: "approved" },
    );
  });
});

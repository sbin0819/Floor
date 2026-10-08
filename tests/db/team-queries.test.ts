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
import { eq } from "drizzle-orm";
import { createTeamQueries } from "@/features/teams/query-factory";
import { avatarColorFor } from "@/lib/avatar";
import { ActionError } from "@/lib/actions/result";
import type { Session } from "@/lib/auth/types";
import * as dal from "@/lib/dal";
import {
  branchStaff,
  teamInvites,
  teamJoinRequests,
  teamMembers,
  teams,
  users,
} from "@/lib/db/schema";
import { createTestDatabase, type TestDatabase } from "./helper";
import { seedTeam, seedTeamActors, type TeamActors } from "./team-helper";

describe("authenticated team queries and safe DTOs", () => {
  let database: TestDatabase;
  let actors: TeamActors;
  let teamId: string;
  const token = "private-recipient-invitation-token";
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    actors = await seedTeamActors(database);
    const team = await seedTeam(database, actors.owner, "가상 회사");
    teamId = team.id;
    await database.db
      .update(teams)
      .set({ homeBranchId: actors.branchId })
      .where(eq(teams.id, teamId));
    await database.db.insert(teamMembers).values({
      teamId,
      userId: actors.member.userId,
      role: "member",
      title: "개발자",
    });
    await database.db.insert(teamInvites).values([
      {
        teamId,
        token,
        createdBy: actors.owner.userId,
        email: actors.outsider.email,
        message: "함께해요",
      },
      {
        teamId,
        token: "unverified-invite",
        createdBy: actors.owner.userId,
        email: actors.unverified.email,
      },
      {
        teamId,
        token: "expired-invite",
        createdBy: actors.owner.userId,
        email: actors.outsider.email,
        expiresAt: new Date(0),
        revokedAt: new Date(),
      },
    ]);
    await database.db.insert(teamJoinRequests).values({
      teamId,
      userId: actors.outsider.userId,
      message: "가입하고 싶어요",
    });
    await database.db
      .insert(branchStaff)
      .values({ branchId: actors.branchId, userId: actors.operator.userId });
  });
  const queries = (session: Session = actors.outsider) =>
    createTeamQueries({
      database: database.db,
      requireSession: async () => session,
      canSendEmail: () => false,
    });

  it("uses the same safe avatar for member and administrator-only request rows", async () => {
    await database.db
      .update(users)
      .set({
        avatarColor: "teal",
        avatarPhoto: true,
        avatarUrl: "https://avatars.githubusercontent.com/u/321",
      })
      .where(eq(users.id, actors.member.userId));
    await database.db
      .update(users)
      .set({
        avatarColor: "pink",
        avatarPhoto: true,
        avatarUrl: "https://unsafe.example.test/avatar",
      })
      .where(eq(users.id, actors.outsider.userId));
    const data = await queries(actors.owner).getTeamPageData(teamId);
    expect(
      data?.members.find(({ id }) => id === actors.member.userId)?.avatar,
    ).toEqual({
      color: "teal",
      photoUrl: "https://avatars.githubusercontent.com/u/321",
    });
    expect(data?.role).toBe("admin");
    if (data?.role !== "admin")
      throw new Error("Expected administrator fixture");
    expect(data.joinRequests[0]?.avatar).toEqual({
      color: "pink",
      photoUrl: null,
    });
    expect(JSON.stringify(data)).not.toContain("unsafe.example.test");
    for (const person of [...data.members, ...data.joinRequests]) {
      expect(person).not.toHaveProperty("avatarUrl");
      expect(person).not.toHaveProperty("avatarPhoto");
    }
  });
  it("requires a session separately for every public query before database access", async () => {
    const readSession = vi.fn(async () => {
      throw new ActionError("UNAUTHENTICATED");
    });
    const safe = createTeamQueries({
      database: database.db,
      requireSession: readSession,
    });
    const userRead = vi.spyOn(dal, "getUserById");
    const teamRead = vi.spyOn(dal, "getTeamMember");
    const search = vi.spyOn(dal, "searchTeams");
    await expect(safe.getHomeData()).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    await expect(safe.getTeamStartData("회사")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    await expect(safe.getTeamPageData(teamId)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    await expect(safe.getInvitePageData(token)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(readSession).toHaveBeenCalledTimes(4);
    expect(userRead).not.toHaveBeenCalled();
    expect(teamRead).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });

  it("returns identical null results for absent and inaccessible teams without reading their contents", async () => {
    const content = vi.spyOn(dal, "getTeamById");
    const members = vi.spyOn(dal, "listTeamMembers");
    const contact = vi.spyOn(dal, "getTeamContact");
    const invites = vi.spyOn(dal, "listSentInvites");
    const requests = vi.spyOn(dal, "listTeamJoinRequests");
    for (const id of [teamId, crypto.randomUUID(), "not-a-uuid"])
      expect(await queries().getTeamPageData(id)).toBeNull();
    expect(await queries(actors.operator).getTeamPageData(teamId)).toBeNull();
    for (const spy of [content, members, contact, invites, requests])
      expect(spy).not.toHaveBeenCalled();
  });

  it("does not even read administrator-only data for an ordinary team member", async () => {
    const contact = vi.spyOn(dal, "getTeamContact");
    const invites = vi.spyOn(dal, "listSentInvites");
    const requests = vi.spyOn(dal, "listTeamJoinRequests");
    const data = await queries(actors.member).getTeamPageData(teamId);
    expect(data).toMatchObject({
      id: teamId,
      name: "가상 회사",
      role: "member",
      memberCount: 2,
    });
    expect(data?.members).toEqual(
      expect.arrayContaining([
        {
          id: actors.member.userId,
          name: actors.member.name,
          avatar: {
            color: avatarColorFor(actors.member.userId, null),
            photoUrl: null,
          },
          email: actors.member.email,
          role: "member",
          title: "개발자",
        },
      ]),
    );
    for (const key of [
      "contactPhone",
      "contact_phone",
      "headcount",
      "sentInvites",
      "joinRequests",
      "canSendEmail",
    ])
      expect(data).not.toHaveProperty(key);
    expect(JSON.stringify(data)).not.toContain("01012345678");
    expect(JSON.stringify(data)).not.toContain(token);
    expect(JSON.stringify(data)).not.toContain(actors.outsider.email);
    for (const spy of [contact, invites, requests])
      expect(spy).not.toHaveBeenCalled();
  });

  it("reads privileged projections only for the team's administrator and never includes sent tokens", async () => {
    const data = await queries(actors.owner).getTeamPageData(teamId);
    expect(data).toMatchObject({
      role: "admin",
      contactPhone: "01012345678",
      canSendEmail: false,
    });
    if (!data || data.role !== "admin")
      throw new Error("Expected manager DTO.");
    expect(data.sentInvites).toHaveLength(2);
    expect(data.joinRequests).toMatchObject([
      {
        name: actors.outsider.name,
        email: actors.outsider.email,
        message: "가입하고 싶어요",
      },
    ]);
    expect(data.sentInvites[0]?.expiresAt).toEqual(expect.any(String));
    expect(JSON.stringify(data)).not.toContain(token);
    expect(data).not.toHaveProperty("headcount");
  });

  it.each(["owner", "member"] as const)(
    "preserves %s access for an uppercase UUID",
    async (role) => {
      const subject = queries(actors[role]);
      expect(await subject.getTeamPageData(teamId.toUpperCase())).toEqual(
        await subject.getTeamPageData(teamId),
      );
    },
  );

  it("returns only viewer-specific flags alongside safe team search projections", async () => {
    const data = await queries().getTeamStartData("  가상   회사  ");
    expect(data.search).toEqual({
      query: "가상 회사",
      results: [
        {
          id: teamId,
          name: "가상 회사",
          homeBranchName: "가상 지점",
          isMember: false,
          hasInvite: true,
          hasRequest: true,
        },
      ],
    });
    expect(data).not.toHaveProperty("requests");
    expect(data.invites).toEqual([{ teamName: "가상 회사" }]);
    expect(JSON.stringify(data)).not.toContain(token);
    expect(JSON.stringify(data.search)).not.toContain("01012345678");
    expect(JSON.stringify(data.search)).not.toContain("headcount");
    expect(JSON.stringify(data.search)).not.toContain("memberCount");
    expect(JSON.stringify(data.search)).not.toContain(actors.owner.email);
    const member = await queries(actors.member).getTeamStartData("회사");
    expect(member.search.results[0]).toMatchObject({
      isMember: true,
      hasInvite: false,
    });
  });

  it.each([undefined, "", "  \t  "])(
    "does not query or show validation errors for blank search %s",
    async (query) => {
      const search = vi.spyOn(dal, "searchTeams");
      const data = await queries().getTeamStartData(query);
      expect(data.search).toEqual({ query: "", results: [] });
      expect(search).not.toHaveBeenCalled();
    },
  );

  it.each(["a", "x".repeat(41), ["회사", "다른 회사"]])(
    "rejects invalid search %s without a database search",
    async (query) => {
      const search = vi.spyOn(dal, "searchTeams");
      const data = await queries().getTeamStartData(query);
      expect(data.search.results).toHaveLength(0);
      expect(data.search.error).toBe(
        "검색어는 2자 이상 40자 이하로 입력해 주세요",
      );
      expect(search).not.toHaveBeenCalled();
    },
  );

  it("lists and opens invitations only for the verified database email owner", async () => {
    expect(await queries().getInvitePageData(token)).toMatchObject({
      token,
      teamId,
      teamName: "가상 회사",
      inviterName: actors.owner.name,
      message: "함께해요",
      expiresAt: expect.any(String),
    });
    expect(await queries(actors.member).getInvitePageData(token)).toBeNull();
    expect(
      await queries({
        ...actors.member,
        email: actors.outsider.email,
      }).getInvitePageData(token),
    ).toBeNull();
    expect(
      await queries(actors.unverified).getInvitePageData("unverified-invite"),
    ).toBeNull();
    expect(
      (await queries(actors.unverified).getTeamStartData()).invites,
    ).toEqual([]);
    expect(
      (await queries(actors.unverified).getHomeData()).pendingInviteCount,
    ).toBe(0);
    for (const invalidToken of ["", "does-not-exist", "expired-invite"])
      expect(await queries().getInvitePageData(invalidToken)).toBeNull();
  });

  it("does not expose invitation metadata after verification is removed", async () => {
    await database.db
      .update(users)
      .set({ emailVerified: false })
      .where(eq(users.id, actors.outsider.userId));
    const inviteRead = vi.spyOn(dal, "getInviteForRecipient");
    const inviteList = vi.spyOn(dal, "listReceivedInvites");
    expect(await queries().getInvitePageData(token)).toBeNull();
    expect((await queries().getTeamStartData()).invites).toEqual([]);
    expect(inviteRead).not.toHaveBeenCalled();
    expect(inviteList).not.toHaveBeenCalled();
  });

  it.each([
    { label: "NUL", suffix: "\u0000" },
    { label: "embedded NUL", suffix: "\u0000suffix" },
    { label: "line break", suffix: "\n" },
    { label: "unpaired surrogate", suffix: "\ud800" },
    { label: "non-ASCII character", suffix: "한" },
  ])(
    "returns null rather than a database error for a token with $label",
    async ({ suffix }) => {
      await expect(
        queries().getInvitePageData(`${token}${suffix}`),
      ).resolves.toBeNull();
    },
  );

  it("returns only home-facing team summaries, pending invite count and operator flag", async () => {
    expect(await queries().getHomeData()).toEqual({
      name: actors.outsider.name,
      teams: [],
      pendingInviteCount: 1,
      isOperator: false,
    });
    expect(await queries(actors.owner).getHomeData()).toEqual({
      name: actors.owner.name,
      teams: [{ id: teamId, name: "가상 회사", role: "admin" }],
      pendingInviteCount: 0,
      isOperator: false,
    });
    expect((await queries(actors.operator).getHomeData()).isOperator).toBe(
      true,
    );
  });
});

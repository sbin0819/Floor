import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTeamQueries } from "@/features/teams/query-factory";

const reads = vi.hoisted(() => ({
  getUserById: vi.fn(),
  listReceivedInvites: vi.fn(),
  listBranches: vi.fn(),
  listMyTeams: vi.fn(),
  listMyJoinRequests: vi.fn(),
  searchTeams: vi.fn(),
}));
vi.mock("@/lib/dal", () => reads);
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/email", () => ({ canSendEmail: () => false }));
vi.mock("@/features/teams/action-factory", () => ({ canManageTeam: vi.fn() }));

const session = {
  userId: "member",
  email: "member@example.test",
  name: "가상 회원",
};
const now = new Date("2026-10-07T03:00:00Z");
const requireSession = vi.fn(async () => session);
const queries = createTeamQueries({ requireSession, now: () => now });

beforeEach(() => {
  vi.resetAllMocks();
  requireSession.mockResolvedValue(session);
  reads.getUserById.mockResolvedValue({
    email: session.email,
    emailVerified: true,
  });
  for (const [key, read] of Object.entries(reads)) {
    if (key !== "getUserById") read.mockResolvedValue([]);
  }
});

function expectOnlyReads(...expected: (keyof typeof reads)[]) {
  for (const [name, read] of Object.entries(reads)) {
    if (expected.includes(name as keyof typeof reads))
      expect(read).toHaveBeenCalledOnce();
    else expect(read).not.toHaveBeenCalled();
  }
  for (const name of expected) {
    expect(requireSession.mock.invocationCallOrder[0]).toBeLessThan(
      reads[name].mock.invocationCallOrder[0]!,
    );
  }
}

describe("team start reads only the selected mode's data", () => {
  it("reads only verified received invites for choosing, even with a valid query", async () => {
    reads.listReceivedInvites.mockResolvedValue([
      { teamId: "invited", teamName: "초대 팀" },
    ]);
    const data = await queries.getTeamStartData("가상 팀", "choose");
    expect(data.invites).toEqual([{ teamName: "초대 팀" }]);
    expectOnlyReads("getUserById", "listReceivedInvites");
    expect(reads.listReceivedInvites).toHaveBeenCalledWith(
      session.email,
      undefined,
      now,
    );
  });

  it("does not read received invites for an unverified email", async () => {
    reads.getUserById.mockResolvedValue({
      email: session.email,
      emailVerified: false,
    });
    expect(
      (await queries.getTeamStartData(undefined, "choose")).invites,
    ).toEqual([]);
    expectOnlyReads("getUserById");
  });

  it("reads only branch options for creating", async () => {
    reads.listBranches.mockResolvedValue([{ id: "branch", name: "가상점" }]);
    expect(
      (await queries.getTeamStartData("가상 팀", "create")).branches,
    ).toEqual([{ id: "branch", name: "가상점" }]);
    expectOnlyReads("listBranches");
  });

  it.each([undefined, "", " ", "가", "가".repeat(41), ["가상 팀"]])(
    "does not read any DAL data for an empty or invalid join query %j",
    async (query) => {
      const data = await queries.getTeamStartData(query, "join");
      expect(data.search.results).toEqual([]);
      if (
        query === "가" ||
        Array.isArray(query) ||
        (typeof query === "string" && query.length > 40)
      ) {
        expect(data.search.error).toBe(
          "검색어는 2자 이상 40자 이하로 입력해 주세요",
        );
      }
      expect(requireSession).toHaveBeenCalledOnce();
      expectOnlyReads();
    },
  );

  it("reads search flags only for a valid join search, preserving normalization and restricted DTOs", async () => {
    reads.searchTeams.mockResolvedValue([
      { id: "member", name: "소속 팀", homeBranchName: null },
      { id: "invited", name: "초대 팀", homeBranchName: "가상점" },
      { id: "requested", name: "요청 팀", homeBranchName: null },
    ]);
    reads.listMyTeams.mockResolvedValue([{ id: "member" }]);
    reads.listReceivedInvites.mockResolvedValue([
      { teamId: "invited", teamName: "초대 팀" },
    ]);
    reads.listMyJoinRequests.mockResolvedValue([{ teamId: "requested" }]);
    const data = await queries.getTeamStartData("  가상   팀  ", "join");
    expect(reads.searchTeams).toHaveBeenCalledWith("가상 팀", undefined);
    expect(
      data.search.results.map(({ id, isMember, hasInvite, hasRequest }) => ({
        id,
        isMember,
        hasInvite,
        hasRequest,
      })),
    ).toEqual([
      { id: "member", isMember: true, hasInvite: false, hasRequest: false },
      { id: "invited", isMember: false, hasInvite: true, hasRequest: false },
      { id: "requested", isMember: false, hasInvite: false, hasRequest: true },
    ]);
    expectOnlyReads(
      "getUserById",
      "listReceivedInvites",
      "listMyTeams",
      "listMyJoinRequests",
      "searchTeams",
    );
  });

  it("preserves the existing all-data contract when no mode is supplied", async () => {
    await queries.getTeamStartData("가상 팀");
    expectOnlyReads(
      "getUserById",
      "listReceivedInvites",
      "listBranches",
      "listMyTeams",
      "listMyJoinRequests",
      "searchTeams",
    );
  });

  it.each(["choose", "create", "join"] as const)(
    "does not read data after the %s session guard rejects",
    async (mode) => {
      requireSession.mockRejectedValue(new Error("LOGIN"));
      await expect(queries.getTeamStartData("가상 팀", mode)).rejects.toThrow(
        "LOGIN",
      );
      expectOnlyReads();
    },
  );
});

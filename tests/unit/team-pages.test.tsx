import { beforeEach, describe, expect, it, vi } from "vitest";
import TeamPage from "@/app/(app)/teams/[teamId]/page";
import TeamStartPage from "@/app/(app)/teams/start/page";
import InvitePage from "@/app/(app)/invite/[token]/page";
import { requirePageSession } from "@/lib/auth/session";
import {
  getInvitePageData,
  getTeamPageData,
  getTeamStartData,
} from "@/features/teams/queries";

vi.mock("@/lib/auth/session", () => ({ requirePageSession: vi.fn() }));
vi.mock("@/features/teams/queries", () => ({
  getInvitePageData: vi.fn(),
  getTeamPageData: vi.fn(),
  getTeamStartData: vi.fn(),
}));
vi.mock("@/features/teams/components/team-detail", () => ({
  TeamDetail: () => null,
}));
vi.mock("@/features/teams/components/team-start", () => ({
  TeamStart: () => null,
}));
vi.mock("@/features/teams/components/invite-detail", () => ({
  InviteDetail: () => null,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requirePageSession).mockResolvedValue({
    userId: crypto.randomUUID(),
    email: "member@example.com",
    name: "가상 회원",
  });
});

describe("team page session guards", () => {
  it("guards the transition page before its query and preserves the search destination", async () => {
    vi.mocked(getTeamStartData).mockResolvedValue({
      branches: [],
      invites: [],
      requests: [],
      search: { query: "가상 팀", results: [] },
    });
    await TeamStartPage({ searchParams: Promise.resolve({ q: "가상 팀" }) });
    expect(requirePageSession).toHaveBeenCalledWith(
      `/teams/start?q=${encodeURIComponent("가상 팀")}`,
    );
    expect(getTeamStartData).toHaveBeenCalledWith("가상 팀");
    expect(
      vi.mocked(requirePageSession).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(getTeamStartData).mock.invocationCallOrder[0]!);
  });
  it("guards the team destination and uses the same notFound response for an unavailable team", async () => {
    const teamId = crypto.randomUUID();
    vi.mocked(getTeamPageData).mockResolvedValue(null);
    await expect(
      TeamPage({ params: Promise.resolve({ teamId }) }),
    ).rejects.toThrow("NOT_FOUND");
    expect(requirePageSession).toHaveBeenCalledWith(`/teams/${teamId}`);
    expect(getTeamPageData).toHaveBeenCalledWith(teamId);
  });
  it("guards an invitation using its return path without exposing an invalid reason", async () => {
    vi.mocked(getInvitePageData).mockResolvedValue(null);
    const element = await InvitePage({
      params: Promise.resolve({ token: "recipient-token" }),
    });
    expect(requirePageSession).toHaveBeenCalledWith("/invite/recipient-token");
    expect(element.props.data).toBeNull();
    expect(getInvitePageData).toHaveBeenCalledWith("recipient-token");
  });
  it("does not read private page data when the session guard rejects", async () => {
    vi.mocked(requirePageSession).mockRejectedValue(
      new Error("LOGIN_REDIRECT"),
    );
    await expect(
      TeamPage({ params: Promise.resolve({ teamId: crypto.randomUUID() }) }),
    ).rejects.toThrow("LOGIN_REDIRECT");
    expect(getTeamPageData).not.toHaveBeenCalled();
  });
});

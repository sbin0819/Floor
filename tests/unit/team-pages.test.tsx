import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Children,
  isValidElement,
  type ReactNode,
  type ReactElement,
} from "react";
import { render, screen } from "@testing-library/react";
import { ActionError } from "@/lib/actions/result";
import {
  teamAdmin,
  teamMember,
  managedTeamId,
  memberId,
} from "../helpers/team-management";
import TeamPage from "@/app/(app)/teams/[teamId]/page";
import TeamStartPage from "@/app/(app)/teams/start/page";
import InvitePage from "@/app/(app)/invite/[token]/page";
import { requirePageSession } from "@/lib/auth/session";
import {
  getInvitePageData,
  getTeamPageData,
  getTeamStartData,
  getTeamRemovalPreview,
  getTeamDeletePreview,
} from "@/features/teams/queries";
import { resolvePageContent } from "./page-test-utils";

vi.mock("@/lib/auth/session", () => ({ requirePageSession: vi.fn() }));
vi.mock("@/features/teams/queries", () => ({
  getInvitePageData: vi.fn(),
  getTeamPageData: vi.fn(),
  getTeamStartData: vi.fn(),
  getTeamBookings: vi.fn(),
  getTeamRemovalPreview: vi.fn(),
  getTeamDeletePreview: vi.fn(),
}));
vi.mock("@/features/teams/components/team-detail", () => ({
  TeamDetail: () => null,
}));
vi.mock("@/features/teams/components/team-removal", () => ({
  TeamRemoval: () => null,
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

function childElements(element: ReactElement<Record<string, unknown>>) {
  return Children.toArray(element.props.children as ReactNode).filter(
    (child): child is ReactElement<Record<string, unknown>> =>
      isValidElement<Record<string, unknown>>(child),
  );
}

describe("team page session guards", () => {
  it("preserves settings and dialog in the login return URL before reading data", async () => {
    vi.mocked(getTeamPageData).mockResolvedValue(null);
    await expect(
      resolvePageContent(
        TeamPage({
          params: Promise.resolve({ teamId: managedTeamId }),
          searchParams: Promise.resolve({ tab: "settings", dialog: "delete" }),
        }),
      ),
    ).rejects.toThrow("NOT_FOUND");
    expect(requirePageSession).toHaveBeenCalledWith(
      `/teams/${managedTeamId}?tab=settings&dialog=delete`,
    );
  });
  it("renders private or unknown tabs as members without reading a management preview", async () => {
    vi.mocked(getTeamPageData).mockResolvedValue(teamMember);
    const page = await resolvePageContent(
      TeamPage({
        params: Promise.resolve({ teamId: managedTeamId }),
        searchParams: Promise.resolve({ tab: "settings", dialog: "delete" }),
      }),
    );
    const boundary = childElements(page)[0]!;
    const child = boundary.props.children;
    expect(isValidElement<{ tab: string }>(child) && child.props.tab).toBe(
      "members",
    );
    expect(getTeamDeletePreview).not.toHaveBeenCalled();
  });
  it.each(["remove"])(
    "keeps a revoked %s preview within its dialog without exposing errors",
    async (dialog) => {
      vi.mocked(getTeamPageData).mockResolvedValue(teamAdmin);
      vi.mocked(getTeamRemovalPreview).mockRejectedValue(
        new ActionError("NOT_FOUND"),
      );
      vi.mocked(getTeamDeletePreview).mockRejectedValue(
        new ActionError("FORBIDDEN"),
      );
      const page = await resolvePageContent(
        TeamPage({
          params: Promise.resolve({ teamId: managedTeamId }),
          searchParams: Promise.resolve({
            tab: dialog === "delete" ? "settings" : "members",
            dialog,
            member: memberId,
          }),
        }),
      );
      const shell = childElements(page)[1]!;
      const content = await resolvePageContent(shell.props.children);
      render(content);
      expect(screen.getByRole("status")).toHaveTextContent(
        "이미 처리됐거나 이 작업을 할 수 없어요",
      );
      expect(screen.queryByText(/NOT_FOUND|FORBIDDEN/)).not.toBeInTheDocument();
    },
  );
  it("guards the transition page before its query and preserves the search destination", async () => {
    vi.mocked(getTeamStartData).mockResolvedValue({
      branches: [],
      invites: [],
      search: { query: "가상 팀", results: [] },
    });
    const modeBoundary = await resolvePageContent(
      TeamStartPage({ searchParams: Promise.resolve({ q: "가상 팀" }) }),
    );
    await resolvePageContent(modeBoundary);
    expect(requirePageSession).toHaveBeenCalledWith(
      `/teams/start?${new URLSearchParams({ q: "가상 팀" })}`,
    );
    expect(getTeamStartData).toHaveBeenCalledWith("가상 팀", "choose");
    expect(
      vi.mocked(requirePageSession).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(getTeamStartData).mock.invocationCallOrder[0]!);
  });
  it("guards the team destination and uses the same notFound response for an unavailable team", async () => {
    const teamId = crypto.randomUUID();
    vi.mocked(getTeamPageData).mockResolvedValue(null);
    await expect(
      resolvePageContent(TeamPage({ params: Promise.resolve({ teamId }) })),
    ).rejects.toThrow("NOT_FOUND");
    expect(requirePageSession).toHaveBeenCalledWith(`/teams/${teamId}`);
    expect(getTeamPageData).toHaveBeenCalledWith(teamId);
  });
  it("guards an invitation using its return path without exposing an invalid reason", async () => {
    vi.mocked(getInvitePageData).mockResolvedValue(null);
    const element = await resolvePageContent(
      InvitePage({ params: Promise.resolve({ token: "recipient-token" }) }),
    );
    expect(requirePageSession).toHaveBeenCalledWith("/invite/recipient-token");
    expect(element.props.data).toBeNull();
    expect(getInvitePageData).toHaveBeenCalledWith("recipient-token");
  });
  it("does not read private page data when the session guard rejects", async () => {
    vi.mocked(requirePageSession).mockRejectedValue(
      new Error("LOGIN_REDIRECT"),
    );
    await expect(
      resolvePageContent(
        TeamPage({ params: Promise.resolve({ teamId: crypto.randomUUID() }) }),
      ),
    ).rejects.toThrow("LOGIN_REDIRECT");
    expect(getTeamPageData).not.toHaveBeenCalled();
  });
});

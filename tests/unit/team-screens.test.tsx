import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch as matches } from "next/experimental/testing/server";
import { config, proxy } from "@/proxy";
import { TeamsHub } from "@/features/teams/components/teams-hub";
import { TeamStart } from "@/features/teams/components/team-start";
import { TeamDetail } from "@/features/teams/components/team-detail";
import { TeamHeader } from "@/features/teams/components/team-header";
import { InviteDetail } from "@/features/teams/components/invite-detail";
import { normalizeTeamStartMode } from "@/features/teams/start-mode";
import type { TeamsData, TeamStartData } from "@/features/teams/types";
import TeamsPage from "@/app/(app)/teams/page";
import TeamStartPage from "@/app/(app)/teams/start/page";
import { requirePageSession } from "@/lib/auth/session";
import { getTeamsData, getTeamStartData } from "@/features/teams/queries";
import { resolvePageContent } from "./page-test-utils";

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
  request: vi.fn(),
  send: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("sonner", () => ({ toast: { success: mocks.toast, error: vi.fn() } }));
vi.mock("@/lib/auth/session", () => ({ requirePageSession: vi.fn() }));
vi.mock("@/features/teams/queries", () => ({
  getTeamsData: vi.fn(),
  getTeamStartData: vi.fn(),
}));
vi.mock("@/features/teams/create-team-action", () => ({ createTeam: vi.fn() }));
vi.mock("@/features/teams/manage-actions", () => ({
  setMemberRole: vi.fn(),
  setMemberTitle: vi.fn(),
}));
vi.mock("@/features/chat/actions", () => ({ openDirectMessage: vi.fn() }));
vi.mock("@/features/people/components/person-card", () => ({
  PersonCard: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/features/teams/invite-management-actions", () => ({
  sendTeamInvite: mocks.send,
  revokeTeamInvite: vi.fn(),
}));
vi.mock("@/features/teams/join-request-actions", () => ({
  requestTeamJoin: mocks.request,
  cancelTeamJoinRequest: vi.fn(),
  approveTeamJoinRequest: vi.fn(),
  rejectTeamJoinRequest: vi.fn(),
}));
vi.mock("@/features/teams/invite-response-actions", () => ({
  acceptTeamInvite: vi.fn(),
  declineTeamInvite: vi.fn(),
}));

const teamId = "abcdefab-1234-4abc-9def-123456789abc";
const start: TeamStartData = {
  branches: [{ id: crypto.randomUUID(), name: "가상 지점" }],
  invites: [],
  search: { query: "", results: [] },
};
const empty: TeamsData = { teams: [], invites: [], requests: [] };
const invite = {
  token: "recipient-token",
  teamId,
  teamName: "가상 팀",
  inviterName: "초대한 사람",
  message: "함께해요",
  expiresAt: "2030-02-01T00:00:00.000Z",
};
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  );
}
function renderUi(children: ReactNode) {
  return render(children, { wrapper });
}
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePageSession).mockResolvedValue({
    userId: "user",
    email: "test@example.test",
    name: "테스트",
  });
});

describe("team hub and route protection", () => {
  it("omits absent invite/request sections but offers a next action for an empty membership", () => {
    renderUi(<TeamsHub data={empty} />);
    expect(
      screen.queryByRole("region", { name: "받은 초대" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "보낸 가입 요청" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "내 팀" })).toHaveTextContent(
      "아직 속한 팀이 없어요",
    );
    expect(
      within(screen.getByRole("region", { name: "내 팀" })).getByRole("link"),
    ).toHaveAttribute("href", "/teams/start");
  });
  it("renders invitation, membership and request sections in order with whole-row team links", () => {
    const { container } = renderUi(
      <TeamsHub
        data={{
          teams: [
            {
              id: teamId,
              name: "내 가상 팀",
              role: "member",
              memberCount: 3,
              homeBranchName: "가상 지점",
            },
          ],
          invites: [invite],
          requests: [
            {
              id: "request",
              teamId,
              teamName: "다른 팀",
              message: null,
              createdAt: "2030-01-01T00:00:00Z",
              status: "rejected",
              decidedAt: "2030-01-02T00:00:00Z",
            },
          ],
        }}
      />,
    );
    expect(
      Array.from(container.querySelectorAll("section[aria-label]")).map(
        (node) => node.getAttribute("aria-label"),
      ),
    ).toEqual(["받은 초대", "내 팀", "보낸 가입 요청"]);
    const link = screen.getByRole("link", { name: /내 가상 팀/ });
    expect(link).toHaveAttribute("href", `/teams/${teamId}`);
    expect(link.querySelector("button")).toBeNull();
    expect(link).toHaveTextContent("팀원 3명 · 주 이용 지점 가상 지점");
    expect(screen.getByRole("link", { name: "다시 요청" })).toHaveAttribute(
      "href",
      `/teams/start?${new URLSearchParams({ mode: "join", q: "다른 팀" })}`,
    );
    expect(
      screen.queryByRole("button", { name: "요청 취소" }),
    ).not.toBeInTheDocument();
  });
  it("protects /teams in the proxy and again before page data access", async () => {
    expect(matches({ config, nextConfig: {}, url: "/teams" })).toBe(true);
    expect(
      new URL(
        proxy(new NextRequest("https://floor.example.test/teams")).headers.get(
          "location",
        )!,
      ).pathname,
    ).toBe("/login");
    vi.mocked(getTeamsData).mockResolvedValue(empty);
    const page = await resolvePageContent(TeamsPage().props.children);
    expect(requirePageSession).toHaveBeenCalledWith("/teams");
    expect(page.props.data).toBe(empty);
    expect(
      vi.mocked(requirePageSession).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(getTeamsData).mock.invocationCallOrder[0]!);
    vi.mocked(requirePageSession).mockRejectedValue(new Error("LOGIN"));
    vi.mocked(getTeamsData).mockClear();
    await expect(
      resolvePageContent(TeamsPage().props.children),
    ).rejects.toThrow("LOGIN");
    expect(getTeamsData).not.toHaveBeenCalled();
  });
});

describe("three-mode team start", () => {
  it.each([undefined, "bad", ["create"], ""])(
    "normalizes unknown mode %j to choosing",
    (mode) => expect(normalizeTeamStartMode(mode)).toBe("choose"),
  );
  it.each(["create", "join"] as const)(
    "preserves %s in the login return path and renders only the selected step",
    async (mode) => {
      vi.mocked(getTeamStartData).mockResolvedValue(start);
      const boundary = await resolvePageContent(
        TeamStartPage({
          searchParams: Promise.resolve({ mode, q: "가상 팀" }),
        }),
      );
      const page = await resolvePageContent(boundary);
      expect(requirePageSession).toHaveBeenCalledWith(
        `/teams/start?${new URLSearchParams({ mode, q: "가상 팀" })}`,
      );
      expect(page.props.mode).toBe(mode);
      renderUi(<TeamStart data={start} mode={mode} />);
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        mode === "create" ? "새 팀 만들기" : "기존 팀에 가입",
      );
      expect(
        screen.queryByRole("region", { name: "받은 초대" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("region", { name: "보낸 가입 요청" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "‹ 다시 고르기" }),
      ).toHaveAttribute("href", "/teams/start");
    },
  );
  it.each([1, 2])(
    "summarizes %i received invitations without recipient controls",
    (count) => {
      renderUi(
        <TeamStart
          data={{
            ...start,
            invites: Array.from({ length: count }, () => ({
              teamName: "가상 팀",
            })),
          }}
        />,
      );
      expect(
        screen.getByText(
          count === 1
            ? "가상 팀에서 초대가 와 있어요. 수락하면 바로 팀원이 돼요"
            : "받은 초대가 2개 있어요",
        ),
      ).toBeVisible();
      expect(screen.getByRole("link", { name: "초대 보기" })).toHaveAttribute(
        "href",
        "/teams",
      );
      expect(
        screen.queryByRole("button", { name: "수락" }),
      ).not.toBeInTheDocument();
    },
  );
  it.each(["create", "join"] as const)(
    "shows the %s title and shell before navigation completes",
    async (mode) => {
      const response = deferred();
      const navigate = vi.fn(() => response.promise);
      const view = renderUi(
        <TeamStart data={start} navigateAction={navigate} />,
      );
      await act(async () => {
        fireEvent.click(
          screen.getByRole("link", {
            name: mode === "create" ? "새 팀 만들기" : "팀 찾기",
          }),
        );
      });
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        mode === "create" ? "새 팀 만들기" : "기존 팀에 가입",
      );
      expect(screen.getByRole("status")).toHaveTextContent("불러오고 있어요");
      if (mode === "create")
        expect(
          screen.getByRole("button", { name: "팀 만들기" }),
        ).toBeDisabled();
      view.rerender(
        <TeamStart data={start} mode={mode} navigateAction={navigate} />,
      );
      await act(async () => {
        response.resolve();
        await response.promise;
      });
      expect(document.querySelector('[aria-busy="true"]')).toBeNull();
      await act(async () => {
        fireEvent.click(screen.getByRole("link", { name: "‹ 다시 고르기" }));
      });
      expect(navigate).toHaveBeenLastCalledWith("/teams/start", {});
    },
  );
  it("does not intercept a modified choice link", async () => {
    const navigate = vi.fn();
    renderUi(<TeamStart data={start} navigateAction={navigate} />);
    const states: boolean[] = [];
    document.addEventListener(
      "click",
      (event) => {
        states.push(event.defaultPrevented);
        event.preventDefault();
      },
      { once: true },
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "팀 찾기" }), {
        metaKey: true,
      });
    });
    expect(states).toEqual([false]);
    expect(navigate).not.toHaveBeenCalled();
  });
  it("does not treat unqueried invites as an empty result when returning from create to choose", async () => {
    const response = deferred();
    const navigate = vi.fn(() => response.promise);
    const view = renderUi(
      <TeamStart data={start} mode="create" navigateAction={navigate} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "‹ 다시 고르기" }));
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "팀 회원으로 전환",
    );
    expect(screen.getByRole("status")).toHaveTextContent("불러오고 있어요");
    expect(screen.getByRole("link", { name: "새 팀 만들기" })).toBeVisible();
    expect(
      screen.queryByText(
        "가상 팀에서 초대가 와 있어요. 수락하면 바로 팀원이 돼요",
      ),
    ).not.toBeInTheDocument();
    view.rerender(
      <TeamStart
        data={{ ...start, invites: [{ teamName: "가상 팀" }] }}
        mode="choose"
        navigateAction={navigate}
      />,
    );
    await act(async () => {
      response.resolve();
      await response.promise;
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "가상 팀에서 초대가 와 있어요. 수락하면 바로 팀원이 돼요",
      ),
    ).toBeVisible();
  });
  it("shows all four search states and expands only the eligible request row", async () => {
    const names = ["가입 가능", "이미 소속", "초대 있음", "요청 있음"];
    const results = names.map((name, index) => ({
      id: index === 0 ? teamId : crypto.randomUUID(),
      name,
      homeBranchName: null,
      isMember: index === 1,
      hasInvite: index === 2,
      hasRequest: index === 3,
    }));
    mocks.request.mockResolvedValue({
      ok: true,
      data: { id: "request", teamId },
    });
    const view = renderUi(
      <TeamStart
        data={{ ...start, search: { query: "가상", results } }}
        mode="join"
      />,
    );
    expect(screen.getByText("이미 팀원이에요")).toBeVisible();
    expect(screen.getByText("받은 초대가 있어요")).toBeVisible();
    expect(screen.getByText("요청을 보냈어요")).toBeVisible();
    expect(
      screen.queryByRole("form", { name: "가입 가능 가입 요청" }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "가입 요청" }));
    expect(screen.getByRole("button", { name: "가입 요청" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await userEvent.click(screen.getByRole("button", { name: "요청 보내기" }));
    expect(await screen.findAllByText("요청을 보냈어요")).toHaveLength(2);
    expect(
      screen.getAllByRole("link", { name: "보낸 요청 보기" }),
    ).toHaveLength(2);
    expect(mocks.toast).toHaveBeenCalledWith(
      "가입 요청을 보냈어요. 팀 관리자가 승인하면 팀원이 돼요",
    );
    expect(mocks.router.refresh).toHaveBeenCalledOnce();
    view.rerender(
      <TeamStart
        data={{
          ...start,
          search: {
            query: "가상",
            results: results.map((team) => ({ ...team })),
          },
        }}
        mode="join"
      />,
    );
    expect(screen.getByRole("button", { name: "가입 요청" })).toBeVisible();
    expect(screen.getAllByText("요청을 보냈어요")).toHaveLength(1);
  });
});

describe("team detail and invitation layout", () => {
  it("keeps the admin invitation in the header and moves the original request content into its tab", async () => {
    renderUi(
      <>
        <TeamHeader
          data={{
            id: teamId,
            name: "가상 팀",
            role: "admin",
            memberCount: 0,
            homeBranchName: null,
            space: null,
            canSendEmail: true,
          }}
        />
        <TeamDetail
          tab="requests"
          data={{
            id: teamId,
            name: "가상 팀",
            userId: "self",
            homeBranchName: null,
            space: null,
            upcomingBookingCount: 0,
            homeBranchId: null,
            headcount: null,
            branches: [],
            pendingJoinRequestCount: 1,
            memberCount: 0,
            members: [],
            role: "admin",
            canSendEmail: true,
            contactPhone: "01012345678",
            sentInvites: [],
            joinRequests: [
              {
                id: "request",
                name: "가상 요청자",
                avatar: { color: "blue" as const, photoUrl: null },
                email: "request@example.test",
                message: null,
                createdAt: "2030-01-01T00:00:00Z",
              },
            ],
          }}
        />
        ,
      </>,
    );
    expect(
      screen.queryByRole("form", { name: "초대 보내기" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "받은 가입 요청 1건" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("region", { name: "팀원 목록" }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "팀원 초대" }));
    expect(screen.getByRole("dialog", { name: "팀원 초대" })).toBeVisible();
    expect(screen.getByRole("form", { name: "초대 보내기" })).toBeVisible();
  });
  it("keeps valid and invalid invitations inside the same 480px card", () => {
    const view = renderUi(<InviteDetail data={invite} />);
    expect(
      screen.getByRole("heading", { name: "가상 팀" }).closest("section"),
    ).toHaveClass("max-w-[480px]");
    view.rerender(<InviteDetail data={null} />);
    expect(
      screen
        .getByRole("heading", { name: "이 초대는 더 이상 쓸 수 없어요" })
        .closest("section"),
    ).toHaveClass("max-w-[480px]");
    expect(screen.getByRole("link", { name: "팀으로 가기" })).toHaveAttribute(
      "href",
      "/teams",
    );
  });
});

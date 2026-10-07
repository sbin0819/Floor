import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateTeamForm } from "@/features/teams/components/create-team-form";
import { SendInviteForm } from "@/features/teams/components/send-invite-form";
import { InviteResponse } from "@/features/teams/components/invite-response";
import {
  JoinRequestForm,
  ReviewJoinRequest,
} from "@/features/teams/components/request-controls";
import { TeamDetail } from "@/features/teams/components/team-detail";
import { TeamStart } from "@/features/teams/components/team-start";
import { InviteDetail } from "@/features/teams/components/invite-detail";
import { TeamSearchForm } from "@/features/teams/components/team-search-form";
import type { TeamPageData, TeamStartData } from "@/features/teams/types";
import type { ActionResult } from "@/lib/actions/result";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  send: vi.fn(),
  revoke: vi.fn(),
  request: vi.fn(),
  cancel: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  accept: vi.fn(),
  decline: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("@/features/teams/create-team-action", () => ({
  createTeam: mocks.create,
}));
vi.mock("@/features/teams/invite-management-actions", () => ({
  sendTeamInvite: mocks.send,
  revokeTeamInvite: mocks.revoke,
}));
vi.mock("@/features/teams/join-request-actions", () => ({
  requestTeamJoin: mocks.request,
  cancelTeamJoinRequest: mocks.cancel,
  approveTeamJoinRequest: mocks.approve,
  rejectTeamJoinRequest: mocks.reject,
}));
vi.mock("@/features/teams/invite-response-actions", () => ({
  acceptTeamInvite: mocks.accept,
  declineTeamInvite: mocks.decline,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

const teamId = crypto.randomUUID();
const emptyStart: TeamStartData = {
  branches: [],
  invites: [],
  search: { query: "", results: [] },
  requests: [],
};
function renderUi(children: ReactNode) {
  const client = new QueryClient();
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    ),
  };
}
async function fillTeam() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("팀(회사) 이름"), " 가상  디자인팀 ");
  await user.type(screen.getByLabelText("인원 규모"), "4");
  await user.type(screen.getByLabelText("담당자 연락처"), "+82 10-1234-5678");
  return user;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("team creation", () => {
  it("shows required field validation connected to inputs", async () => {
    renderUi(<CreateTeamForm branches={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "팀 만들기" }));
    expect(mocks.create).not.toHaveBeenCalled();
    for (const label of ["팀(회사) 이름", "인원 규모", "담당자 연락처"]) {
      const field = screen.getByLabelText(label);
      expect(field).toHaveAttribute("aria-invalid", "true");
      const descriptions = field.getAttribute("aria-describedby")!.split(" ");
      expect(
        descriptions.some((id) => document.getElementById(id)?.textContent),
      ).toBe(true);
    }
    expect(
      screen.getByText("연락처는 이 팀의 팀 관리자에게만 보여요."),
    ).toBeVisible();
  });
  it("requires a branch when branches exist", async () => {
    renderUi(
      <CreateTeamForm
        branches={[{ id: crypto.randomUUID(), name: "가상 지점" }]}
      />,
    );
    await fillTeam();
    await userEvent.click(screen.getByRole("button", { name: "팀 만들기" }));
    expect(screen.getByRole("combobox")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByText("주 이용 지점을 선택해 주세요")).toBeVisible();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("shows TEAM_NAME_TAKEN without trusting server message", async () => {
    mocks.create.mockResolvedValue({
      ok: false,
      code: "TEAM_NAME_TAKEN",
      message: "private detail",
    });
    renderUi(<CreateTeamForm branches={[]} />);
    await fillTeam();
    await userEvent.click(screen.getByRole("button", { name: "팀 만들기" }));
    expect(
      await screen.findByText("같은 이름의 팀이 이미 있어요"),
    ).toBeVisible();
    expect(screen.queryByText("private detail")).not.toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("uses shared normalization and opens the created team", async () => {
    mocks.create.mockResolvedValue({ ok: true, data: { id: teamId } });
    renderUi(<CreateTeamForm branches={[]} />);
    await fillTeam();
    await userEvent.click(screen.getByRole("button", { name: "팀 만들기" }));
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(`/teams/${teamId}`),
    );
    expect(mocks.create).toHaveBeenCalledWith({
      name: "가상 디자인팀",
      headcount: 4,
      contactPhone: "+821012345678",
      homeBranchId: null,
      title: null,
    });
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.toastSuccess).toHaveBeenCalledWith("팀을 만들었어요");
  });
  it("locks repeated and other-form writes immediately with a shared scope and no retry", async () => {
    let resolve!: (value: ActionResult<{ id: string }>) => void;
    mocks.create.mockReturnValue(
      new Promise<ActionResult<{ id: string }>>((done) => {
        resolve = done;
      }),
    );
    const { client } = renderUi(
      <>
        <CreateTeamForm branches={[]} />
        <InviteResponse token="recipient-token" />
      </>,
    );
    await fillTeam();
    const form = screen.getByRole("form", { name: "새 팀 만들기" });
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
      fireEvent.click(screen.getByRole("button", { name: "수락" }));
    });
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    expect(mocks.accept).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "거절" })).toBeDisabled();
    const mutation = client.getMutationCache().getAll()[0]!;
    expect(mutation.options.scope).toEqual({ id: "team-actions" });
    expect(mutation.options.retry).toBe(false);
    await act(async () => resolve({ ok: true, data: { id: teamId } }));
  });
  it("uses a safe failure message for transport errors and does not retry", async () => {
    mocks.create.mockRejectedValue(new Error("secret raw server detail"));
    renderUi(<CreateTeamForm branches={[]} />);
    await fillTeam();
    await userEvent.click(screen.getByRole("button", { name: "팀 만들기" }));
    expect(
      await screen.findByText(
        "처리하지 못했어요. 새로고침한 뒤 다시 시도해 주세요",
      ),
    ).toBeVisible();
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(screen.queryByText(/secret raw/)).not.toBeInTheDocument();
  });
});

describe("invites and requests", () => {
  it("allows invite registration without mail and never promises delivery", async () => {
    mocks.send.mockResolvedValue({
      ok: true,
      data: { inviteId: crypto.randomUUID() },
    });
    renderUi(<SendInviteForm teamId={teamId} canSendEmail={false} />);
    expect(screen.getByText(/지금은 초대 메일을 보낼 수 없어요/)).toBeVisible();
    await userEvent.type(
      screen.getByLabelText("이메일 주소"),
      "Member@Example.com",
    );
    await userEvent.click(screen.getByRole("button", { name: "초대 보내기" }));
    await waitFor(() =>
      expect(mocks.send).toHaveBeenCalledWith({
        teamId,
        email: "member@example.com",
        message: null,
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("초대를 만들었어요");
  });
  it("uses tokens only for recipient actions and navigates on acceptance", async () => {
    mocks.accept.mockResolvedValue({ ok: true, data: { teamId } });
    renderUi(<InviteResponse token="private-recipient-token" />);
    expect(
      screen.queryByText("private-recipient-token"),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "수락" }));
    await waitFor(() =>
      expect(mocks.accept).toHaveBeenCalledWith({
        token: "private-recipient-token",
      }),
    );
    expect(mocks.push).toHaveBeenCalledWith(`/teams/${teamId}`);
  });
  it("refreshes after a join request and displays the specified success message", async () => {
    mocks.request.mockResolvedValue({
      ok: true,
      data: { id: crypto.randomUUID(), teamId },
    });
    renderUi(<JoinRequestForm teamId={teamId} teamName="가상 팀" />);
    await userEvent.type(
      screen.getByLabelText("메시지 (선택)"),
      "함께하고 싶어요",
    );
    await userEvent.click(screen.getByRole("button", { name: "가입 요청" }));
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "가입 요청을 보냈어요. 팀 관리자가 승인하면 팀원이 돼요",
      ),
    );
    expect(mocks.request).toHaveBeenCalledWith({
      teamId,
      message: "함께하고 싶어요",
    });
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it("shows one invalid-invitation view without a reason or controls", () => {
    renderUi(<InviteDetail data={null} />);
    expect(
      screen.getByRole("heading", { name: "이 초대는 더 이상 쓸 수 없어요" }),
    ).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("uses a single safe invalid-invite message and does not navigate on failure", async () => {
    mocks.accept.mockResolvedValue({
      ok: false,
      code: "INVITE_INVALID",
      message: "wrong account",
    });
    renderUi(<InviteResponse token="recipient-token" />);
    await userEvent.click(screen.getByRole("button", { name: "수락" }));
    expect(
      await screen.findByText("이 초대는 더 이상 쓸 수 없어요"),
    ).toBeVisible();
    expect(screen.queryByText("wrong account")).not.toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it("replaces a failed acceptance message with the latest decline result", async () => {
    mocks.accept.mockRejectedValue(new Error("transport failure"));
    mocks.decline.mockResolvedValue({ ok: false, code: "INVITE_INVALID" });
    renderUi(<InviteResponse token="recipient-token" />);
    await userEvent.click(screen.getByRole("button", { name: "수락" }));
    expect(
      await screen.findByText(
        "처리하지 못했어요. 새로고침한 뒤 다시 시도해 주세요",
      ),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "거절" }));
    expect(
      await screen.findByText("이 초대는 더 이상 쓸 수 없어요"),
    ).toBeVisible();
    expect(
      screen.queryByText("처리하지 못했어요. 새로고침한 뒤 다시 시도해 주세요"),
    ).not.toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("replaces a failed approval message with the latest rejection result", async () => {
    mocks.approve.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
    mocks.reject.mockResolvedValue({ ok: false, code: "NOT_FOUND" });
    renderUi(<ReviewJoinRequest requestId={crypto.randomUUID()} />);
    await userEvent.click(screen.getByRole("button", { name: "승인" }));
    expect(await screen.findByText("이 작업을 할 권한이 없어요")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "거절" }));
    expect(
      await screen.findByText("이미 처리됐거나 찾을 수 없는 항목이에요"),
    ).toBeVisible();
    expect(
      screen.queryByText("이 작업을 할 권한이 없어요"),
    ).not.toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("lets an administrator approve requests and cancel invites using row ids only", async () => {
    const requestId = crypto.randomUUID();
    const inviteId = crypto.randomUUID();
    mocks.approve.mockResolvedValue({ ok: true, data: { teamId } });
    mocks.revoke.mockResolvedValue({ ok: true, data: { teamId } });
    renderUi(
      <TeamDetail
        data={{
          id: teamId,
          name: "가상 팀",
          role: "admin",
          memberCount: 0,
          members: [],
          contactPhone: "+821012345678",
          canSendEmail: true,
          sentInvites: [
            {
              id: inviteId,
              email: "invitee@example.com",
              message: null,
              expiresAt: "2026-10-14T12:00:00.000Z",
              createdAt: "2026-10-07T12:00:00.000Z",
            },
          ],
          joinRequests: [
            {
              id: requestId,
              name: "가상 요청자",
              email: "requester@example.com",
              message: "함께하고 싶어요",
              createdAt: "2026-10-07T12:00:00.000Z",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("+821012345678")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "승인" }));
    await waitFor(() =>
      expect(mocks.approve).toHaveBeenCalledWith({ requestId }),
    );
    await userEvent.click(screen.getByRole("button", { name: "초대 취소" }));
    await waitFor(() =>
      expect(mocks.revoke).toHaveBeenCalledWith({ inviteId }),
    );
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("팀 나가기")).not.toBeInTheDocument();
    expect(screen.queryByText("링크 복사")).not.toBeInTheDocument();
  });
});

describe("read-only views and search", () => {
  it("keeps all empty transition sections visible", () => {
    renderUi(<TeamStart data={emptyStart} />);
    expect(screen.getByText("받은 초대가 없어요")).toBeVisible();
    expect(screen.getByText("대기 중인 가입 요청이 없어요")).toBeVisible();
    expect(screen.getByRole("heading", { name: "새 팀 만들기" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "기존 팀에 가입 요청" }),
    ).toBeVisible();
  });
  it("replaces join controls for an existing member or invitation", () => {
    renderUi(
      <TeamStart
        data={{
          ...emptyStart,
          search: {
            query: "가상",
            results: [
              {
                id: teamId,
                name: "가상 팀",
                homeBranchName: null,
                isMember: true,
                hasInvite: false,
              },
              {
                id: crypto.randomUUID(),
                name: "가상 둘",
                homeBranchName: "가상 지점",
                isMember: false,
                hasInvite: true,
              },
            ],
          },
        }}
      />,
    );
    expect(screen.getByText("이미 팀원이에요")).toBeVisible();
    expect(screen.getByText("받은 초대가 있어요")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "가입 요청" }),
    ).not.toBeInTheDocument();
  });
  it("uses a validated URL query for reads without a server action", async () => {
    renderUi(<TeamSearchForm query="" />);
    await userEvent.type(
      screen.getByLabelText("팀 이름으로 찾기"),
      " 가상   팀 ",
    );
    await userEvent.click(screen.getByRole("button", { name: "검색" }));
    expect(mocks.push).toHaveBeenCalledWith(
      `/teams/start?q=${encodeURIComponent("가상 팀")}`,
    );
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("renders a member table but no administrative information for a member", () => {
    const data: TeamPageData = {
      id: teamId,
      name: "가상 팀",
      role: "member",
      memberCount: 1,
      members: [
        {
          id: crypto.randomUUID(),
          name: "가상 회원",
          email: "member@example.com",
          role: "member",
          title: "디자이너",
        },
      ],
    };
    renderUi(<TeamDetail data={data} />);
    expect(
      within(screen.getByRole("table")).getByText("가상 회원"),
    ).toBeVisible();
    expect(screen.getByText("디자이너")).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "담당자 연락처" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "보낸 초대" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "받은 가입 요청" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});

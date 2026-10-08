import { Suspense, use, type ReactNode } from "react";
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeamHeader } from "@/features/teams/components/team-header";
import { TeamTabs } from "@/features/teams/components/team-tabs";
import { TeamMembers } from "@/features/teams/components/team-members";
import {
  TeamRouteDialog,
  useCloseTeamDialog,
} from "@/features/teams/components/team-route-dialog";
import { TeamRemoval } from "@/features/teams/components/team-removal";
import { selectedTeamTab } from "@/features/teams/navigation";
import type { ActionResult } from "@/lib/actions/result";
import {
  managedTeamId as teamId,
  adminId,
  memberId,
  teamAdmin,
  teamMember,
} from "../helpers/team-management";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  role: vi.fn(),
  title: vi.fn(),
  remove: vi.fn(),
  leave: vi.fn(),
  update: vi.fn(),
  destroy: vi.fn(),
  dm: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => mocks,
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("@/features/teams/manage-actions", () => ({
  setMemberRole: mocks.role,
  setMemberTitle: mocks.title,
  removeMember: mocks.remove,
  leaveTeam: mocks.leave,
  updateTeam: mocks.update,
  deleteTeam: mocks.destroy,
}));
vi.mock("@/features/chat/actions", () => ({ openDirectMessage: mocks.dm }));
vi.mock("@/features/bookings/actions", () => ({ cancelBooking: mocks.cancel }));
vi.mock("@/features/teams/invite-management-actions", () => ({
  sendTeamInvite: vi.fn(),
}));
vi.mock("@/features/people/components/person-card", () => ({
  PersonCard: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
function renderUi(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const preview = {
  teamId,
  userId: memberId,
  bookingCount: 0,
  firstBooking: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", `/teams/${teamId}`);
  for (const action of [
    mocks.role,
    mocks.title,
    mocks.remove,
    mocks.leave,
    mocks.update,
    mocks.destroy,
  ])
    action.mockResolvedValue({ ok: true, data: { teamId } });
  mocks.dm.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
});
afterEach(() => vi.unstubAllGlobals());

describe("persistent team header and member controls", () => {
  it("uses one narrow member list with a bottom menu and transfers focus to the title dialog", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    renderUi(<TeamMembers data={teamMember} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "이서연 메뉴" });
    await userEvent.click(trigger);
    expect(screen.getByRole("dialog")).toHaveAttribute("data-side", "bottom");
    expect(
      screen.getByRole("button", { name: "팀원 메뉴 닫기" }),
    ).toBeVisible();
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "직함 바꾸기",
      }),
    );
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(
      screen.getByRole("dialog", { name: "이서연 님의 직함 바꾸기" }),
    ).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  });
  it("shows role-gated link tabs and safely defaults unknown/private tabs", () => {
    const view = renderUi(
      <>
        <TeamHeader data={teamMember} />
        <TeamTabs
          teamId={teamId}
          role="member"
          memberCount={2}
          bookingCount={3}
          requestCount={1}
        >
          내용
        </TeamTabs>
      </>,
    );
    expect(screen.getByRole("heading", { name: "디자인팀" })).toBeVisible();
    expect(screen.getByRole("link", { name: "팀 스페이스" })).toHaveAttribute(
      "href",
      `/s/${teamAdmin.space!.id}`,
    );
    expect(screen.getByRole("link", { name: "팀원 2" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.queryByRole("link", { name: "설정" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "팀원 초대" }),
    ).not.toBeInTheDocument();
    expect(selectedTeamTab("requests", "member")).toBe("members");
    expect(selectedTeamTab("bad", "admin")).toBe("members");
    view.unmount();
    renderUi(
      <TeamTabs
        teamId={teamId}
        role="admin"
        memberCount={2}
        bookingCount={3}
        requestCount={2}
      >
        내용
      </TeamTabs>,
    );
    expect(screen.getByRole("link", { name: "요청·초대 2" })).toBeVisible();
    fireEvent.click(screen.getByRole("link", { name: "설정" }), {
      ctrlKey: true,
    });
    expect(mocks.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("link", { name: "설정" }));
    expect(mocks.push).toHaveBeenCalledWith(`/teams/${teamId}?tab=settings`, {
      scroll: false,
    });
  });
  it("filters in the browser by name, username and title without any query", async () => {
    renderUi(<TeamMembers data={teamAdmin} />);
    for (const value of ["서연", "seoyeon", "디자인 리드"]) {
      fireEvent.change(screen.getByRole("textbox", { name: "팀원 찾기" }), {
        target: { value },
      });
      expect(screen.getAllByRole("row")).toHaveLength(2);
    }
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "팀원 찾기" }), {
      target: { value: "없음" },
    });
    expect(screen.getByText("찾는 팀원이 없어요")).toBeVisible();
  });
  it("omits member emails and offers only own title/leave and other-person DM", async () => {
    renderUi(<TeamMembers data={teamMember} />);
    expect(
      screen.queryByRole("columnheader", { name: "이메일" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("admin@example.test")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "박지훈 메뉴" }));
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
    expect(
      screen.getByRole("menuitem", { name: "메시지 보내기" }),
    ).toBeVisible();
  });
  it("disables the last-admin demotion/leave and explains why", async () => {
    renderUi(<TeamMembers data={teamAdmin} />);
    await userEvent.click(screen.getByRole("button", { name: "박지훈 메뉴" }));
    expect(
      screen.getByRole("menuitem", { name: /팀원으로 바꾸기/ }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("menuitem", { name: /팀 나가기/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getAllByText("팀 관리자가 한 명뿐이에요")).toHaveLength(2);
  });
  it("routes the sole member to settings instead of allowing leave", async () => {
    renderUi(
      <TeamMembers
        data={{
          ...teamAdmin,
          memberCount: 1,
          members: [teamAdmin.members[0]!],
        }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "박지훈 메뉴" }));
    expect(screen.getByRole("menuitem", { name: "팀 지우기" })).toHaveAttribute(
      "href",
      `/teams/${teamId}?tab=settings`,
    );
    expect(
      screen.queryByRole("menuitem", { name: /팀 나가기/ }),
    ).not.toBeInTheDocument();
  });
  it("keeps promotion and DM errors visible after the menu closes", async () => {
    mocks.role.mockResolvedValue({
      ok: false,
      code: "LIMIT_EXCEEDED",
      message: "admin_teams",
    });
    renderUi(<TeamMembers data={teamAdmin} />);
    await userEvent.click(screen.getByRole("button", { name: "이서연 메뉴" }));
    await userEvent.click(
      screen.getByRole("menuitem", { name: "팀 관리자로 지정" }),
    );
    expect(
      await screen.findByText("이서연 님은 이미 팀 5개의 팀 관리자예요"),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "박지훈 메뉴" }));
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "이서연 메뉴" }));
    await userEvent.click(
      screen.getByRole("menuitem", { name: "메시지 보내기" }),
    );
    expect(await screen.findByText("이 작업을 할 권한이 없어요")).toBeVisible();
  });
  it("normalizes a title, locks repeated submits and restores the row menu focus", async () => {
    const result = deferred<ActionResult<{ teamId: string }>>();
    mocks.title.mockReturnValue(result.promise);
    renderUi(<TeamMembers data={teamMember} />);
    const trigger = screen.getByRole("button", { name: "이서연 메뉴" });
    await userEvent.click(trigger);
    await userEvent.click(
      screen.getByRole("menuitem", { name: "직함 바꾸기" }),
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("직함"), {
      target: { value: "  디자이너  " },
    });
    fireEvent.submit(dialog.querySelector("form")!);
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() => expect(mocks.title).toHaveBeenCalledTimes(1));
    expect(mocks.title).toHaveBeenCalledWith({
      teamId,
      userId: memberId,
      title: "디자이너",
    });
    await act(async () => result.resolve({ ok: true, data: { teamId } }));
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});

describe("stable team preview dialogs", () => {
  it("never lets closed removal A clear newly opened B on the same pathname", async () => {
    const result = deferred<ActionResult<{ teamId: string }>>();
    mocks.remove.mockReturnValue(result.promise);
    window.history.replaceState(
      null,
      "",
      `/teams/${teamId}?tab=members&dialog=remove&member=${memberId}`,
    );
    renderUi(
      <TeamRouteDialog
        teamId={teamId}
        title="A 내보내기"
        description="미리보기"
      >
        <TeamRemoval
          preview={preview}
          teamName="디자인팀"
          name="이서연"
          leaving={false}
        />
      </TeamRouteDialog>,
    );
    await userEvent.click(screen.getByRole("button", { name: "내보내기" }));
    await userEvent.keyboard("{Escape}");
    mocks.replace.mockClear();
    window.history.replaceState(
      null,
      "",
      `/teams/${teamId}?tab=members&dialog=remove&member=${adminId}`,
    );
    await act(async () => result.resolve({ ok: true, data: { teamId } }));
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(window.location.search).toContain(adminId);
  });
  function Loaded({ result }: { result: Promise<string> }) {
    const text = use(result);
    const close = useCloseTeamDialog();
    return (
      <>
        <p>{text}</p>
        <button onClick={close}>취소</button>
      </>
    );
  }
  it("keeps one dialog DOM while streaming and restores the visible persistent trigger", async () => {
    window.history.replaceState(
      null,
      "",
      `/teams/${teamId}?tab=members&dialog=remove&member=${memberId}`,
    );
    const result = deferred<string>();
    await act(async () => {
      renderUi(
        <>
          <button data-team-member-menu={memberId} hidden>
            숨겨진 메뉴
          </button>
          <button data-team-member-menu={memberId}>복귀 메뉴</button>
          <TeamRouteDialog
            teamId={teamId}
            title="내보낼까요?"
            description="미리보기"
            returnMemberId={memberId}
          >
            <Suspense fallback={<p role="status">불러오는 중</p>}>
              <Loaded result={result.promise} />
            </Suspense>
          </TeamRouteDialog>
        </>,
      );
    });
    const dialog = screen.getByRole("dialog");
    const trigger = screen.getByText("복귀 메뉴");
    vi.spyOn(trigger, "getClientRects").mockReturnValue([
      new DOMRect(),
    ] as unknown as DOMRectList);
    await act(async () => result.resolve("예약 1건"));
    expect(screen.getByRole("dialog")).toBe(dialog);
    await userEvent.click(await screen.findByRole("button", { name: "취소" }));
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(mocks.replace).toHaveBeenCalledWith(`/teams/${teamId}?tab=members`, {
      scroll: false,
    });
  });
  it("does not reopen when closed before the preview or change the URL after leaving", async () => {
    const result = deferred<string>();
    renderUi(
      <TeamRouteDialog
        teamId={teamId}
        title="내보낼까요?"
        description="미리보기"
      >
        <Suspense fallback={<p>불러오는 중</p>}>
          <Loaded result={result.promise} />
        </Suspense>
      </TeamRouteDialog>,
    );
    window.history.replaceState(null, "", "/friends");
    await userEvent.keyboard("{Escape}");
    await act(async () => result.resolve("예약 1건"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
  it("omits a zero booking preview, submits only ids, and ignores a late leave redirect", async () => {
    const result = deferred<ActionResult<{ teamId: string }>>();
    mocks.leave.mockReturnValue(result.promise);
    renderUi(
      <TeamRemoval
        preview={{ ...preview, userId: adminId }}
        teamName="디자인팀"
        name="박지훈"
        leaving
      />,
    );
    expect(screen.queryByText(/예약 0건/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "나가기" }));
    expect(mocks.leave).toHaveBeenCalledWith({ teamId });
    window.history.replaceState(null, "", "/friends");
    await act(async () => result.resolve({ ok: true, data: { teamId } }));
    expect(mocks.push).not.toHaveBeenCalled();
  });
});

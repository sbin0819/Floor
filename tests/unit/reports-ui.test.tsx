import { Activity, type ReactNode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { BranchReports } from "@/features/admin/components/branch-reports";
import { ReportCard } from "@/features/admin/components/report-card";
import {
  ReportsFrame,
  ReportsSkeleton,
} from "@/features/admin/components/reports-frame";
import { resolveReports } from "@/features/admin/report-actions";
import {
  reportTab,
  reportsHref,
  reportsPath,
} from "@/features/admin/report-navigation";
import {
  branchReportsFixture,
  reportBranchId,
  reportGroupFixture,
} from "@/tests/helpers/reports";
import type { ActionResult } from "@/lib/actions/result";

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));
vi.mock("@/features/admin/report-actions", () => ({ resolveReports: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", reportsPath(reportBranchId));
  vi.mocked(resolveReports).mockResolvedValue({
    ok: true,
    data: { messageId: reportGroupFixture().messageId },
  });
});
function provider(
  children: ReactNode,
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } }),
) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function view(data = branchReportsFixture()) {
  return render(provider(<BranchReports data={data} />));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function first() {
  return screen.getAllByRole("article")[0]!;
}

describe("신고 UI", () => {
  it("고정 제목·범위를 먼저 보여도 미확인 건수를 0건으로 표시하지 않는다", () => {
    render(
      <ReportsFrame>
        <ReportsSkeleton />
      </ReportsFrame>,
    );
    expect(screen.getByRole("heading", { name: "신고" })).toBeInTheDocument();
    expect(screen.getByText("처리할 것")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "신고를 불러오고 있어요",
    );
    expect(screen.queryByText("처리할 신고가 없어요")).not.toBeInTheDocument();
  });
  it("이유·건수·작성자·앞 메시지와 안전한 설명 접기를 표시한다", async () => {
    const user = userEvent.setup();
    view();
    expect(first()).toHaveTextContent("스팸 2");
    expect(first()).toHaveTextContent("신고 3건 · 3시간 전");
    expect(within(first()).getByRole("heading")).toHaveTextContent(
      "박지훈@jihoon",
    );
    await user.click(within(first()).getByText("설명 2개"));
    expect(first().querySelector("details")).toHaveAttribute("open");
    expect(
      within(first()).getByText("<img src=x onerror=alert(1)>"),
    ).toBeInTheDocument();
    expect(first().querySelector("img")).toBeNull();
    expect(first()).toHaveTextContent("김민서: 안내 내용을 확인했어요");
  });
  it("회의는 context가 잘못 주입되어도 앞 메시지·내보내기 동작을 그리지 않는다", () => {
    render(
      <ReportCard
        row={reportGroupFixture({
          roomKind: "meeting",
          context: [{ authorName: "금지", excerpt: "비공개" }],
          canBan: true,
        })}
        now={branchReportsFixture().now}
        timezone="Asia/Seoul"
        onResolve={vi.fn()}
      />,
    );
    expect(screen.queryByText(/비공개/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "라운지에서 내보내기" }),
    ).not.toBeInTheDocument();
  });
  it("지운 메시지는 본문·지우기 버튼을 감추며 관리자 작성자는 내보내지 않는다", () => {
    view(
      branchReportsFixture({
        rows: [
          reportGroupFixture({
            deleted: true,
            body: "원문 숨김",
            canBan: false,
          }),
        ],
      }),
    );
    expect(screen.getByText("지운 메시지")).toBeInTheDocument();
    expect(screen.queryByText("원문 숨김")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "메시지 지우기" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "라운지에서 내보내기" }),
    ).not.toBeInTheDocument();
  });
  it("처리함에는 결과·운영자·시각만 표시하고 다시 처리 버튼이 없다", () => {
    view(
      branchReportsFixture({
        tab: "resolved",
        rows: [
          reportGroupFixture({
            resolution: "dismissed",
            resolvedByName: "김도윤",
            resolvedAt: "2026-10-14T02:30:00Z",
          }),
        ],
      }),
    );
    expect(first()).toHaveTextContent("문제 없음 · 김도윤");
    expect(within(first()).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "처리함" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
  it.each(["open", "resolved"] as const)("%s 빈 목록을 구분한다", (tab) => {
    view(
      branchReportsFixture({
        tab,
        rows: [],
        reportSummary: { count: 0, oldestAt: null },
      }),
    );
    expect(
      screen.getByText(
        tab === "open"
          ? "처리할 신고가 없어요"
          : "최근 30일 동안 처리한 신고가 없어요",
      ),
    ).toBeInTheDocument();
  });
  it("문제 없음은 한 번만 전송하고 성공한 카드·건수를 갱신한다", async () => {
    const pending = deferred<ActionResult<{ messageId: string }>>();
    vi.mocked(resolveReports).mockReturnValue(pending.promise);
    view();
    const button = within(first()).getByRole("button", { name: "문제 없음" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() =>
      expect(resolveReports).toHaveBeenCalledExactlyOnceWith({
        messageId: reportGroupFixture().messageId,
        resolution: "dismissed",
      }),
    );
    expect(
      screen
        .getAllByRole("button", { name: "문제 없음" })
        .every((button) => button.hasAttribute("disabled")),
    ).toBe(true);
    await act(() =>
      pending.resolve({
        ok: true,
        data: { messageId: reportGroupFixture().messageId },
      }),
    );
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "처리할 것 1" })).toHaveFocus();
    expect(nav.refresh).toHaveBeenCalledOnce();
    expect(toast.success).toHaveBeenCalledWith("신고를 처리했어요");
  });
  it.each([
    ["메시지 지우기", "메시지를 지울까요?", "지우기", "message_deleted"],
    [
      "라운지에서 내보내기",
      "라운지에서 내보낼까요?",
      "내보내기",
      "member_banned",
    ],
  ])("%s는 확인 후에만 처리한다", async (label, title, submit, resolution) => {
    const user = userEvent.setup();
    view();
    await user.click(within(first()).getByRole("button", { name: label }));
    const dialog = screen.getByRole("dialog", { name: title });
    expect(resolveReports).not.toHaveBeenCalled();
    if (resolution === "member_banned")
      expect(dialog).toHaveTextContent("관리자가 풀어 줄 때까지");
    await user.click(within(dialog).getByRole("button", { name: submit }));
    expect(resolveReports).toHaveBeenCalledExactlyOnceWith({
      messageId: reportGroupFixture().messageId,
      resolution,
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
  it("Escape는 쓰기 없이 확인 창을 닫고 버튼으로 포커스를 돌린다", async () => {
    const user = userEvent.setup();
    view();
    const trigger = within(first()).getByRole("button", {
      name: "메시지 지우기",
    });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(resolveReports).not.toHaveBeenCalled();
  });
  it("다른 운영자가 처리한 NOT_FOUND는 안전 문구로 안내하고 목록을 다시 읽는다", async () => {
    vi.mocked(resolveReports).mockResolvedValue({
      ok: false,
      code: "NOT_FOUND",
    });
    view();
    fireEvent.click(within(first()).getByRole("button", { name: "문제 없음" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "다른 운영자가 이미 처리했어요",
    );
    expect(nav.refresh).toHaveBeenCalledOnce();
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });
  it("실패하면 카드를 유지하고 원문 예외를 보여주지 않는다", async () => {
    vi.mocked(resolveReports).mockRejectedValue(new Error("private DB data"));
    view();
    fireEvent.click(within(first()).getByRole("button", { name: "문제 없음" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "저장하지 못했어요",
    );
    expect(screen.queryByText(/private DB data/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });
  it("이동한 뒤의 늦은 성공은 새 화면을 새로고침하지 않는다", async () => {
    const pending = deferred<ActionResult<{ messageId: string }>>();
    vi.mocked(resolveReports).mockReturnValue(pending.promise);
    view();
    fireEvent.click(within(first()).getByRole("button", { name: "문제 없음" }));
    window.history.replaceState({}, "", "/");
    await act(() =>
      pending.resolve({
        ok: true,
        data: { messageId: reportGroupFixture().messageId },
      }),
    );
    expect(nav.refresh).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
  it("Activity 숨김 뒤의 이전 성공도 복원된 화면에 적용하지 않는다", async () => {
    const pending = deferred<ActionResult<{ messageId: string }>>();
    vi.mocked(resolveReports).mockReturnValue(pending.promise);
    const client = new QueryClient(),
      data = branchReportsFixture();
    const tree = (mode: "visible" | "hidden") =>
      provider(
        <Activity mode={mode}>
          <BranchReports data={data} />
        </Activity>,
        client,
      );
    const result = render(tree("visible"));
    fireEvent.click(within(first()).getByRole("button", { name: "문제 없음" }));
    result.rerender(tree("hidden"));
    result.rerender(tree("visible"));
    await act(() =>
      pending.resolve({
        ok: true,
        data: { messageId: reportGroupFixture().messageId },
      }),
    );
    expect(nav.refresh).not.toHaveBeenCalled();
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });
  it("탭은 링크를 유지하고 수정 키 클릭은 가로채지 않는다", () => {
    view();
    const link = screen.getByRole("link", { name: "처리함" });
    expect(link).toHaveAttribute(
      "href",
      reportsHref(reportBranchId, "resolved"),
    );
    fireEvent.click(link, { ctrlKey: true });
    expect(nav.push).not.toHaveBeenCalled();
    fireEvent.click(link);
    expect(nav.push).toHaveBeenCalledWith(
      reportsHref(reportBranchId, "resolved"),
      { scroll: false },
    );
  });
  it("새 신고 묶음은 같은 메시지가 전에 처리됐어도 숨기지 않는다", async () => {
    const data = branchReportsFixture(),
      client = new QueryClient();
    const result = render(provider(<BranchReports data={data} />, client));
    fireEvent.click(within(first()).getByRole("button", { name: "문제 없음" }));
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(1));
    result.rerender(
      provider(
        <BranchReports
          data={{
            ...data,
            rows: [
              reportGroupFixture({
                oldestAt: "2026-10-14T03:30:00Z",
                count: 1,
              }),
            ],
          }}
        />,
        client,
      ),
    );
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(first()).toHaveTextContent("박지훈");
  });
  it.each([undefined, "other", ["resolved"], "RESOLVED", null])(
    "잘못된 탭 %j는 처리할 것으로 고른다",
    (value) => {
      expect(reportTab(value)).toBe("open");
    },
  );
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BranchList,
  BranchOperatingStatus,
} from "@/features/bookings/components/branch-list";
import { getOperatingState } from "@/features/bookings/operating-state";
import { setDefaultBranch } from "@/features/bookings/actions";
import type { BranchListItem } from "@/features/bookings/types";
import { spaceDayFixture } from "./booking-ui-fixtures";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/features/bookings/actions", () => ({ setDefaultBranch: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());
const detail = spaceDayFixture();
const open = getOperatingState(
  new Date(detail.now),
  detail.branch.timezone,
  detail.branch.openHours,
);
function fixture(extra: Partial<BranchListItem> = {}): BranchListItem {
  return {
    ...detail.branch,
    isDefault: false,
    todayHours: detail.openHours,
    operatingState: open,
    accessibleFloorCount: 2,
    freeSpaceCount: 3,
    bookableSpaceCount: 4,
    ...extra,
  };
}
function display(branches = [fixture()]) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <BranchList branches={branches} />
    </QueryClientProvider>,
  );
}

describe("branch cards", () => {
  it.each([
    ["open", "영업 중 · 14:00까지"],
    ["before_open", "09:00에 열어요"],
    ["after_close", "오늘 영업이 끝났어요"],
    ["closed", "쉬는 날이에요"],
  ] as const)(
    "explains %s without depending on the colored dot",
    (status, text) => {
      render(<BranchOperatingStatus state={{ ...open, status }} />);
      expect(screen.getByText(text)).toBeVisible();
    },
  );
  it("extends the name-only link across the card, keeps the write button outside and describes access counts", () => {
    display();
    const link = screen.getByRole("link", { name: "가상 지점" });
    expect(link).toHaveAttribute("href", "/branches/branch");
    expect(link.querySelector("button")).toBeNull();
    expect(link).toHaveClass("after:absolute", "after:inset-0", "after:z-10");
    const card = screen.getByRole("article", { name: "가상 지점" });
    expect(
      within(card).getByText("이용할 수 있는 층").parentElement,
    ).toHaveTextContent("2개");
    expect(
      within(card).getByText("예약할 수 있는 공간").parentElement,
    ).toHaveTextContent("4곳");
    expect(
      within(card).getByText("지금 빈 공간").parentElement,
    ).toHaveTextContent("3곳");
    expect(
      screen.getByRole("button", { name: /기본 지점으로 설정/ }).closest("a"),
    ).toBeNull();
    expect(setDefaultBranch).not.toHaveBeenCalled();
  });
  it("shows seven weekday hours and identifies the branch-local today without a client clock", () => {
    display([
      fixture({
        openHours: { wed: { open: "08:30", close: "22:00" }, sun: null },
      }),
    ]);
    const week = screen.getByRole("list", { name: "요일별 운영 시간" });
    expect(within(week).getAllByRole("listitem")).toHaveLength(7);
    expect(within(week).getAllByRole("listitem")[0]).toHaveTextContent(
      "월요일 09:00부터 22:00까지",
    );
    expect(
      within(week).getByText("수요일 08:30부터 22:00까지, 오늘").closest("li"),
    ).toHaveAttribute("aria-current", "date");
    expect(
      within(week).getByText("수요일 08:30부터 22:00까지, 오늘").closest("li"),
    ).toHaveClass("bg-foreground", "text-background");
    expect(within(week).getByText("일요일 쉬는 날")).toHaveClass("sr-only");
    expect(within(week).getByText("쉼")).toBeVisible();
  });
  it.each(["before_open", "after_close", "closed"] as const)(
    "uses a dash instead of a free count when %s",
    (status) => {
      display([
        fixture({ freeSpaceCount: 99, operatingState: { ...open, status } }),
      ]);
      const count = screen.getByText("지금 빈 공간").parentElement!;
      expect(within(count).getByText("–")).toBeVisible();
      expect(count).not.toHaveTextContent("99");
      expect(
        screen.getByText("예약할 수 있는 공간").parentElement,
      ).toHaveTextContent("4곳");
    },
  );
  it("keeps the branch cover outside the name-only link and the decoration out of navigation", () => {
    display([
      fixture({
        cover: { path: "/seed/photos/lobby-oak.webp", alt: "가상 지점 입구" },
      }),
    ]);
    expect(
      screen.getByRole("img", { name: "가상 지점 입구" }).closest("a"),
    ).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByText("공간 보기")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    const button = screen.getByRole("button", { name: /기본 지점으로 설정/ });
    expect(button.parentElement).toHaveClass("relative", "z-20");
  });
  it("uses a 1040px page and switches to two columns only at the desktop breakpoint", () => {
    display();
    expect(screen.getByRole("main")).toHaveClass("max-w-[1040px]");
    const grid = screen.getByRole("article").parentElement!;
    expect(grid).toHaveClass("grid", "lg:grid-cols-2");
    expect(grid).not.toHaveClass("sm:grid-cols-2");
  });
  it("explains an empty branch list without an empty card or navigation link", () => {
    display([]);
    expect(screen.getByText("이용할 수 있는 지점이 아직 없어요")).toBeVisible();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
  it("replaces the default button with an explanation for the current default", () => {
    display([fixture({ isDefault: true })]);
    expect(screen.getByText("기본 지점")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /기본 지점으로 설정/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("홈과 공간 예약이 이 지점으로 먼저 열려요"),
    ).toBeVisible();
  });
  it("does not show free counts outside operating hours and handles inaccessible floors", () => {
    display([
      fixture({
        accessibleFloorCount: 0,
        freeSpaceCount: null,
        operatingState: { ...open, status: "closed" },
      }),
    ]);
    expect(screen.getByText("이용할 수 있는 층이 아직 없어요")).toBeVisible();
    expect(screen.queryByText(/지금 빈 공간/)).not.toBeInTheDocument();
  });
  it("prevents duplicate saves and refreshes without navigating", async () => {
    let finish: () => void = () => {};
    vi.mocked(setDefaultBranch).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ ok: true, data: { branchId: "branch" } });
        }),
    );
    display();
    const button = screen.getByRole("button", { name: /기본 지점으로 설정/ });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveTextContent("저장하고 있어요");
    expect(setDefaultBranch).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    await waitFor(() => expect(router.refresh).toHaveBeenCalledOnce());
    expect(router.push).not.toHaveBeenCalled();
  });
  it("keeps the existing error message without changing the default or navigating", async () => {
    vi.mocked(setDefaultBranch).mockResolvedValue({
      ok: false,
      code: "NOT_FOUND",
    });
    display();
    fireEvent.click(screen.getByRole("button", { name: /기본 지점으로 설정/ }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "찾을 수 없어요. 화면을 새로 고쳐 주세요",
      ),
    );
    expect(router.refresh).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /기본 지점으로 설정/ }),
    ).toBeEnabled();
  });
});

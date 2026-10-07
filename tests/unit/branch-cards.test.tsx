import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
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
  it("links the whole card, keeps the write button outside and describes access counts", () => {
    display();
    const card = screen.getByRole("link", { name: /가상 지점/ });
    expect(card).toHaveAttribute("href", "/branches/branch");
    expect(card.querySelector("button")).toBeNull();
    expect(card).toHaveTextContent("층 2개");
    expect(card).toHaveTextContent("지금 빈 공간 3곳");
    expect(
      screen.getByRole("button", { name: /기본 지점으로 설정/ }).closest("a"),
    ).toBeNull();
    expect(setDefaultBranch).not.toHaveBeenCalled();
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
});

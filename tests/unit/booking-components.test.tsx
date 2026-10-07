import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BookingForm } from "@/features/bookings/components/booking-form";
import { BranchList } from "@/features/bookings/components/branch-list";
import { FloorDay } from "@/features/bookings/components/floor-day";
import { MemberNav } from "@/components/member-nav";
import {
  createBooking,
  cancelBooking,
  setDefaultBranch,
} from "@/features/bookings/actions";
import type { ActionResult } from "@/lib/actions/result";
import { floorDayFixture, spaceDayFixture } from "./booking-ui-fixtures";

const navigation = vi.hoisted(() => ({
  refresh: vi.fn(),
  push: vi.fn(),
  pathname: "/branches/branch/floors/floor",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => navigation.pathname,
}));
vi.mock("@/features/bookings/actions", () => ({
  createBooking: vi.fn(),
  cancelBooking: vi.fn(),
  setDefaultBranch: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createBooking).mockResolvedValue({
    ok: true,
    data: { bookingId: "new-booking" },
  });
  vi.mocked(cancelBooking).mockResolvedValue({
    ok: true,
    data: { bookingId: "booking" },
  });
  vi.mocked(setDefaultBranch).mockResolvedValue({
    ok: true,
    data: { branchId: "branch" },
  });
});
function display(children: ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      {children}
    </QueryClientProvider>,
  );
}

describe("booking form", () => {
  it("requires a time selection, hides an actor selector for users without teams and connects labels", () => {
    display(<BookingForm data={spaceDayFixture()} />);
    expect(screen.getByRole("button", { name: "예약하기" })).toBeDisabled();
    expect(
      screen.queryByRole("combobox", { name: "예약 방식" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("시작")).toHaveAttribute("role", "combobox");
    expect(screen.getByLabelText("끝")).toBeDisabled();
    expect(screen.getByLabelText("제목 (선택)")).toHaveAttribute(
      "maxLength",
      "60",
    );
    expect(
      screen.getByRole("button", { name: "11:00, 예약 중" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "13:00, 점검 중" }),
    ).toBeDisabled();
  });

  it("omits unavailable times from the actual start select", async () => {
    display(<BookingForm data={spaceDayFixture()} />);
    await userEvent.click(screen.getByRole("combobox", { name: "시작" }));
    expect(screen.getByRole("option", { name: "10:00" })).toBeVisible();
    expect(
      screen.queryByRole("option", { name: "09:30" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "11:00" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "13:00" }),
    ).not.toBeInTheDocument();
  });

  it("offers only allowed teams in restricted spaces", async () => {
    const data = spaceDayFixture();
    data.hasTeams = true;
    data.actors = [{ ...data.actors[0]!, teamId: "team", name: "가상 팀으로" }];
    display(<BookingForm data={data} />);
    await userEvent.click(screen.getByRole("combobox", { name: "예약 방식" }));
    expect(screen.getByRole("option", { name: "가상 팀으로" })).toBeVisible();
    expect(
      screen.queryByRole("option", { name: "개인으로" }),
    ).not.toBeInTheDocument();
  });

  it("submits the selected contiguous hour once, disables pending writes and clears selection after success", async () => {
    let finish!: (result: ActionResult<{ bookingId: string }>) => void;
    vi.mocked(createBooking).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = display(<BookingForm data={spaceDayFixture()} />);
    await userEvent.click(
      screen.getByRole("button", { name: "10:00, 비어 있음" }),
    );
    expect(screen.getByRole("combobox", { name: "시작" })).toHaveTextContent(
      "10:00",
    );
    expect(screen.getByRole("combobox", { name: "끝" })).toHaveTextContent(
      "11:00",
    );
    await userEvent.type(screen.getByLabelText("제목 (선택)"), "테스트 회의");
    const form = view.container.querySelector("form")!;
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await waitFor(() => expect(createBooking).toHaveBeenCalledTimes(1));
    expect(createBooking).toHaveBeenCalledWith({
      spaceId: "space",
      start: "2026-10-07T01:00:00.000Z",
      end: "2026-10-07T02:00:00.000Z",
      teamId: null,
      title: "테스트 회의",
    });
    expect(
      screen.getByRole("button", { name: "예약하고 있어요" }),
    ).toBeDisabled();
    await act(async () =>
      finish({ ok: true, data: { bookingId: "new-booking" } }),
    );
    await waitFor(() => expect(navigation.refresh).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "예약하기" })).toBeDisabled();
    expect(screen.getByLabelText("제목 (선택)")).toHaveValue("");
  });

  it.each([
    [
      { ok: false, code: "BOOKING_CONFLICT" },
      "방금 다른 예약이 들어왔어요. 시간을 다시 골라 주세요",
      true,
    ],
    [{ ok: false, code: "SPACE_BLOCKED" }, "점검 중인 시간이에요", true],
    [{ ok: false, code: "OUTSIDE_HOURS" }, "운영 시간이 아니에요", false],
    [
      { ok: false, code: "LIMIT_EXCEEDED", message: "per_booking" },
      "한 번에 2시간까지 예약할 수 있어요",
      false,
    ],
    [
      { ok: false, code: "LIMIT_EXCEEDED", message: "per_day" },
      "오늘 예약할 수 있는 시간을 다 썼어요",
      false,
    ],
    [
      { ok: false, code: "LIMIT_EXCEEDED", message: "days_ahead" },
      "7일 뒤까지만 예약할 수 있어요",
      false,
    ],
  ] as const)("shows server failure %j", async (result, message, refresh) => {
    vi.mocked(createBooking).mockResolvedValue(result);
    display(<BookingForm data={spaceDayFixture()} />);
    await userEvent.click(
      screen.getByRole("button", { name: "10:00, 비어 있음" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "예약하기" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(message),
    );
    expect(navigation.refresh).toHaveBeenCalledTimes(refresh ? 1 : 0);
  });

  it("reinitializes selection for a different space/date key", async () => {
    const first = spaceDayFixture();
    const client = new QueryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <BookingForm key={`${first.space.id}:${first.date}`} data={first} />
      </QueryClientProvider>,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "10:00, 비어 있음" }),
    );
    const next = { ...first, space: { ...first.space, id: "next-space" } };
    view.rerender(
      <QueryClientProvider client={client}>
        <BookingForm key={`${next.space.id}:${next.date}`} data={next} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("button", { name: "예약하기" })).toBeDisabled();
  });
});

describe("navigation, lists and cancellation", () => {
  it("marks the current member destination", () => {
    render(<MemberNav />);
    expect(screen.getByRole("link", { name: "공간 예약" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "홈" })).not.toHaveAttribute(
      "aria-current",
    );
  });
  it("stores the selected branch before navigating", async () => {
    const data = spaceDayFixture();
    display(
      <BranchList
        branches={[
          { ...data.branch, isDefault: true, todayHours: data.openHours },
        ]}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "가상 지점 선택" }),
    );
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith("/branches/branch"),
    );
    expect(setDefaultBranch).toHaveBeenCalledWith({ branchId: "branch" });
    expect(screen.getByText("기본 지점")).toBeVisible();
  });
  it("shows a restricted badge without rendering a space link and handles empty floors", () => {
    const data = floorDayFixture();
    const view = render(<FloorDay data={data} today={data.date} />);
    expect(screen.getByText("전용 공간")).toBeVisible();
    expect(view.container.querySelector('a[href*="restricted"]')).toBeNull();
    expect(screen.getByRole("link", { name: /회의실 C/ })).toHaveAttribute(
      "href",
      "/branches/branch/floors/floor?date=2026-10-07&space=space",
    );
    view.rerender(
      <FloorDay data={{ ...data, spaces: [] }} today={data.date} />,
    );
    expect(screen.getByText("이 층에는 공간이 아직 없어요")).toBeVisible();
  });
});

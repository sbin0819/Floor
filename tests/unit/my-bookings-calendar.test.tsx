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
import { renderToString } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import BookingsPage from "@/app/(app)/bookings/page";
import { cancelBooking } from "@/features/bookings/actions";
import { normalizeMyBookingsMonth } from "@/features/bookings/calendar";
import { MyBookingsCalendar } from "@/features/bookings/components/my-bookings-calendar";
import { getMyBookings, getMyBookingsMonth } from "@/features/bookings/queries";
import type {
  MyCalendarBooking,
  MyBookingsMonthData,
} from "@/features/bookings/types";
import { requirePageSession } from "@/lib/auth/session";
import { resolvePageContent } from "./page-test-utils";

const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useRouter: () => navigation,
    useSearchParams: () => {
      const search = useSyncExternalStore(
        (listener) => {
          window.addEventListener("popstate", listener);
          return () => window.removeEventListener("popstate", listener);
        },
        () => window.location.search,
        () => window.location.search,
      );
      return new URLSearchParams(search);
    },
  };
});
vi.mock("@/features/bookings/actions", () => ({ cancelBooking: vi.fn() }));
vi.mock("@/features/bookings/queries", () => ({
  getMyBookings: vi.fn(),
  getMyBookingsMonth: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requirePageSession: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const now = "2026-10-08T01:00:00Z";
const booking: MyCalendarBooking = {
  id: "booking",
  start: "2026-10-08T02:00:00Z",
  end: "2026-10-08T03:00:00Z",
  date: "2026-10-08",
  timezone: "Asia/Seoul",
  title: "가상 회의",
  teamName: null,
  status: "confirmed",
  cancelledAt: null,
  branchId: "branch",
  branchName: "가상 지점",
  floorId: "floor",
  floorName: "7F",
  spaceId: "space",
  spaceName: "회의실 A",
  spaceType: "meeting_room",
  photo: null,
  canCancel: true,
};
function data(
  bookings: MyCalendarBooking[] = [],
  month = "2026-10",
  day?: string,
): MyBookingsMonthData {
  return {
    ...normalizeMyBookingsMonth({ month, day }, "2026-10-08"),
    now,
    timezone: "Asia/Seoul",
    bookings,
  };
}
function element(value = data(), navigateAction?: () => Promise<void>) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <MyBookingsCalendar data={value} navigateAction={navigateAction} />
    </QueryClientProvider>
  );
}
function changeUrl(url: string) {
  act(() => {
    window.history.replaceState(null, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(
    null,
    "",
    "/bookings?view=calendar&month=2026-10",
  );
  vi.mocked(requirePageSession).mockResolvedValue({
    userId: "user",
    email: "test@example.test",
    name: "김가상",
  });
  vi.mocked(getMyBookingsMonth).mockResolvedValue(data());
  vi.mocked(cancelBooking).mockResolvedValue({
    ok: true,
    data: { bookingId: booking.id },
  });
});

it("preserves calendar location in the page guard and waits for it before the query", async () => {
  const result = await resolvePageContent(
    BookingsPage({
      searchParams: Promise.resolve({
        view: "calendar",
        month: "2026-11",
        day: "2026-11-03",
      }),
    }),
  );
  expect(requirePageSession).toHaveBeenCalledWith(
    "/bookings?view=calendar&month=2026-11&day=2026-11-03",
  );
  expect(getMyBookingsMonth).not.toHaveBeenCalled();
  await resolvePageContent(result);
  expect(getMyBookingsMonth).toHaveBeenCalledWith({
    month: "2026-11",
    day: "2026-11-03",
  });
  expect(
    vi.mocked(requirePageSession).mock.invocationCallOrder[0],
  ).toBeLessThan(vi.mocked(getMyBookingsMonth).mock.invocationCallOrder[0]!);
  expect(getMyBookings).not.toHaveBeenCalled();
});
it("does not query the calendar after the page guard rejects", async () => {
  vi.mocked(requirePageSession).mockRejectedValue(new Error("LOGIN_REDIRECT"));
  await expect(
    resolvePageContent(
      BookingsPage({ searchParams: Promise.resolve({ view: "calendar" }) }),
    ),
  ).rejects.toThrow("LOGIN_REDIRECT");
  expect(getMyBookingsMonth).not.toHaveBeenCalled();
});
it("server-renders the selected day and keeps the list and calendar as links", () => {
  const html = renderToString(element(data([booking])));
  expect(html).toContain("10월 예약 1건");
  expect(html).toContain("10월 8일 목요일, 예약 1건");
  expect(html).toContain('aria-current="date"');
  expect(html).toContain("회의실 A");
  render(element());
  const views = within(
    screen.getByRole("navigation", { name: "예약 보기 선택" }),
  );
  expect(views.getByRole("link", { name: "목록" })).toHaveAttribute(
    "href",
    "/bookings",
  );
  expect(views.getByRole("link", { name: "달력" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});
it("shows two start-ordered chips and a count without making adjacent-month dates links", () => {
  render(
    element(
      data([
        {
          ...booking,
          id: "late",
          start: "2026-10-08T06:00:00Z",
          end: "2026-10-08T07:00:00Z",
          spaceName: "오후 회의실",
        },
        { ...booking, id: "middle", spaceName: "두 번째 회의실" },
        {
          ...booking,
          id: "early",
          start: "2026-10-08T00:00:00Z",
          end: "2026-10-08T00:30:00Z",
          spaceName: "첫 번째 회의실",
        },
      ]),
    ),
  );
  const day = screen.getByRole("link", { name: "10월 8일 목요일, 예약 3건" });
  expect(day).toHaveTextContent(
    "09:00 첫 번째 회의실11:00 두 번째 회의실+1건 더",
  );
  expect(within(day).queryByText(/오후 회의실/)).not.toBeInTheDocument();
  expect(day).toHaveClass("bg-accent", "ring-primary");
  expect(within(day).getByText("8")).toHaveClass("bg-foreground");
  const cells = screen.getAllByRole("gridcell");
  expect(within(cells[0]!).queryByRole("link")).not.toBeInTheDocument();
  expect(cells[0]).toHaveTextContent("27");
});
it("changes only the selected panel through native history and restores it on back navigation", () => {
  render(element(data([booking])));
  const grid = screen.getByRole("grid");
  fireEvent.click(
    screen.getByRole("link", { name: "10월 9일 금요일, 예약 0건" }),
  );
  expect(window.location.search).toContain("day=2026-10-09");
  expect(
    screen.getByRole("region", { name: "선택한 날짜 예약" }),
  ).toHaveTextContent("이 날은 예약이 없어요");
  expect(
    screen.getByRole("link", { name: "이 날짜에 예약하기" }),
  ).toHaveAttribute("href", "/booking?date=2026-10-09");
  expect(screen.getByRole("grid")).toBe(grid);
  expect(navigation.push).not.toHaveBeenCalled();
  expect(getMyBookingsMonth).not.toHaveBeenCalled();
  changeUrl("/bookings?view=calendar&month=2026-10&day=2026-10-09");
  changeUrl("/bookings?view=calendar&month=2026-10");
  expect(
    screen.getByRole("region", { name: "선택한 날짜 예약" }),
  ).toHaveTextContent("회의실 A");
  expect(
    screen.getByRole("link", { name: "10월 8일 목요일, 예약 1건" }),
  ).toHaveAttribute("aria-current", "date");
});
it("keeps modifier-clicks native", () => {
  render(element());
  const original = window.location.search;
  const day = screen.getByRole("link", { name: "10월 9일 금요일, 예약 0건" });
  expect(fireEvent.click(day, { ctrlKey: true })).toBe(true);
  expect(window.location.search).toBe(original);
  expect(navigation.push).not.toHaveBeenCalled();
});

it("selects today through native history and keeps the chosen panel on a refresh result", () => {
  changeUrl("/bookings?view=calendar&month=2026-10&day=2026-10-09");
  const view = render(element(data([booking])));
  fireEvent.click(screen.getByRole("link", { name: "오늘" }));
  expect(
    screen.getByRole("region", { name: "선택한 날짜 예약" }),
  ).toHaveTextContent("회의실 A");
  expect(window.location.search).toContain("day=2026-10-08");
  expect(navigation.push).not.toHaveBeenCalled();
  view.rerender(element(data([])));
  expect(
    screen.getByRole("region", { name: "선택한 날짜 예약" }),
  ).toHaveTextContent("이 날은 예약이 없어요");
  expect(
    screen.getByRole("link", { name: "10월 8일 목요일, 예약 0건" }),
  ).toHaveAttribute("aria-current", "date");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("restores a valid selected day from a direct URL and defaults invalid dates safely", () => {
  changeUrl("/bookings?view=calendar&month=2026-10&day=2026-10-21");
  render(element());
  expect(
    screen.getByRole("link", { name: "10월 21일 수요일, 예약 0건" }),
  ).toHaveAttribute("aria-current", "date");
  changeUrl("/bookings?view=calendar&month=2026-10&day=2026-11-01");
  expect(
    screen.getByRole("link", { name: "10월 8일 목요일, 예약 0건" }),
  ).toHaveAttribute("aria-current", "date");
});
it("uses one grid tab stop and arrow keys stop at the month boundary", () => {
  render(element());
  const grid = screen.getByRole("grid");
  expect(
    within(grid)
      .getAllByRole("link")
      .filter((link) => link.tabIndex === 0),
  ).toHaveLength(1);
  const today = screen.getByRole("link", { name: "10월 8일 목요일, 예약 0건" });
  fireEvent.keyDown(today, { key: "ArrowUp" });
  const first = screen.getByRole("link", { name: "10월 1일 목요일, 예약 0건" });
  expect(first).toHaveFocus();
  fireEvent.keyDown(first, { key: "ArrowLeft" });
  expect(first).toHaveFocus();
  expect(window.location.search).not.toContain("day=");
  expect(
    within(grid)
      .getAllByRole("link")
      .filter((link) => link.tabIndex === 0),
  ).toHaveLength(1);
});
it.each([
  ["2026-09", undefined, "날짜를 골라 주세요", false],
  ["2026-09", "2026-09-30", "이 날은 예약이 없어요", false],
  ["2026-12", "2026-12-07", "이 날은 예약이 없어요", true],
  ["2026-12", "2026-12-08", "이 날은 예약이 없어요", false],
] as const)(
  "renders %s/%s selection and the inclusive booking window",
  (month, day, message, canBook) => {
    changeUrl(
      `/bookings?view=calendar&month=${month}${day ? `&day=${day}` : ""}`,
    );
    render(element(data([], month, day)));
    expect(
      screen.getByRole("region", { name: "선택한 날짜 예약" }),
    ).toHaveTextContent(message);
    expect(
      Boolean(screen.queryByRole("link", { name: "이 날짜에 예약하기" })),
    ).toBe(canBook);
  },
);
it("omits cancellation for finished bookings and respects the server capability", () => {
  render(
    element(
      data([
        { ...booking, id: "past", start: "2026-10-08T00:00:00Z", end: now },
        { ...booking, id: "blocked", canCancel: false },
      ]),
    ),
  );
  expect(screen.getByText("이용 종료")).toBeVisible();
  expect(screen.getAllByRole("link", { name: "공간 보기" })).toHaveLength(1);
  expect(
    screen.queryByRole("button", { name: "예약 취소" }),
  ).not.toBeInTheDocument();
});
it("keeps the title, view and month controls during month navigation and only skeletonizes the body", async () => {
  let finish!: () => void;
  const response = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const navigate = vi.fn(() => response);
  render(element(data([booking]), navigate));
  const heading = screen.getByRole("heading", { name: "내 예약" });
  const views = screen.getByRole("navigation", { name: "예약 보기 선택" });
  fireEvent.click(screen.getByRole("link", { name: "다음 달" }));
  expect(navigate).toHaveBeenCalledWith(
    "/bookings?view=calendar&month=2026-11",
    {},
  );
  expect(screen.getByRole("heading", { name: "내 예약" })).toBe(heading);
  expect(screen.getByRole("navigation", { name: "예약 보기 선택" })).toBe(
    views,
  );
  expect(screen.getByRole("heading", { name: "2026년 11월" })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("불러오고 있어요");
  expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("region", { name: "선택한 날짜 예약" }),
  ).not.toBeInTheDocument();
  await act(async () => {
    finish();
    await response;
  });
});
it.each([
  ["2026-04", "이전 달"],
  ["2026-12", "다음 달"],
])("disables the %s boundary control", (month, label) => {
  render(element(data([], month)));
  expect(screen.getByRole("button", { name: label })).toBeDisabled();
});
it("reuses confirmation and refresh without hiding the calendar", async () => {
  render(element(data([booking])));
  const grid = screen.getByRole("grid");
  await userEvent.click(screen.getByRole("button", { name: "예약 취소" }));
  expect(cancelBooking).not.toHaveBeenCalled();
  const dialog = screen.getByRole("dialog", { name: "이 예약을 취소할까요?" });
  await userEvent.click(
    within(dialog).getByRole("button", { name: "예약 취소" }),
  );
  await waitFor(() => expect(navigation.refresh).toHaveBeenCalledTimes(1));
  expect(cancelBooking).toHaveBeenCalledWith({ bookingId: booking.id });
  expect(screen.getByRole("grid")).toBe(grid);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

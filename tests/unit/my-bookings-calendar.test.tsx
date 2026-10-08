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
import { Activity, startTransition } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import BookingsPage from "@/app/(app)/bookings/page";
import { cancelBooking } from "@/features/bookings/actions";
import { normalizeMyBookingsMonth } from "@/features/bookings/calendar";
import {
  MyBookingsCalendar,
  StreamingMyBookingsCalendar,
} from "@/features/bookings/components/my-bookings-calendar";
import { MyBookingCalendarDay } from "@/features/bookings/components/my-bookings-calendar";
import {
  MyBookingsCalendarBodySkeleton,
  MyBookingsCalendarSkeleton,
} from "@/features/bookings/components/my-bookings-calendar-skeleton";
import {
  getMyBookings,
  getMyBookingsMonth,
  getMyBookingsMonthStream,
} from "@/features/bookings/queries";
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
    usePathname: () => window.location.pathname,
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
  getMyBookingsMonthStream: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requirePageSession: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const now = "2026-10-08T01:00:00Z";
const booking: MyCalendarBooking = {
  relation: "owner",
  invitedByName: null,
  participantNames: [],
  id: "booking",
  start: "2026-10-08T02:00:00Z",
  end: "2026-10-08T03:00:00Z",
  date: "2026-10-08",
  timezone: "Asia/Seoul",
  title: "가상 회의",
  attendeeCount: null,
  desk: null,
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
  vi.mocked(getMyBookingsMonthStream).mockResolvedValue({
    meta: data(),
    bookings: Promise.resolve([]),
  });
  vi.mocked(cancelBooking).mockResolvedValue({
    ok: true,
    data: { bookingId: booking.id },
  });
});

it("shows an attendee badge in the selected calendar day", () => {
  render(
    element(data([{ ...booking, attendeeCount: 5 }], "2026-10", "2026-10-08")),
  );
  expect(
    within(screen.getByRole("region", { name: "선택한 날짜 예약" })).getByText(
      "5명",
    ),
  ).toBeVisible();
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
  expect(requirePageSession).not.toHaveBeenCalled();
  expect(getMyBookingsMonthStream).not.toHaveBeenCalled();
  await resolvePageContent(result);
  expect(requirePageSession).toHaveBeenCalledWith(
    "/bookings?view=calendar&month=2026-11&day=2026-11-03",
  );
  expect(getMyBookingsMonth).not.toHaveBeenCalled();
  expect(getMyBookingsMonthStream).toHaveBeenCalledWith({
    month: "2026-11",
    day: "2026-11-03",
  });
  expect(
    vi.mocked(requirePageSession).mock.invocationCallOrder[0],
  ).toBeLessThan(
    vi.mocked(getMyBookingsMonthStream).mock.invocationCallOrder[0]!,
  );
  expect(getMyBookings).not.toHaveBeenCalled();
});
it("does not query the calendar after the page guard rejects", async () => {
  vi.mocked(requirePageSession).mockRejectedValue(new Error("LOGIN_REDIRECT"));
  const content = await resolvePageContent(
    BookingsPage({ searchParams: Promise.resolve({ view: "calendar" }) }),
  );
  await expect(resolvePageContent(content)).rejects.toThrow("LOGIN_REDIRECT");
  expect(getMyBookingsMonth).not.toHaveBeenCalled();
  expect(getMyBookingsMonthStream).not.toHaveBeenCalled();
});
it("server-renders the selected day and keeps the list and calendar as links", () => {
  const html = renderToString(element(data([booking])));
  expect(html).toContain("10월 예약 1건");
  const serverDocument = render(
    <div dangerouslySetInnerHTML={{ __html: html }} />,
  );
  expect(
    within(serverDocument.container).getByRole("link", {
      name: "10월 8일 목요일, 예약 1건",
    }),
  ).toHaveAttribute("aria-current", "date");
  expect(html).toContain('aria-current="date"');
  expect(html).toContain("회의실 A");
  serverDocument.unmount();
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
it("keeps the title and controls and immediately renders the next month's real dates while its bookings load", async () => {
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
  expect(
    screen.getByRole("grid", { name: "2026년 11월 내 예약" }),
  ).toBeVisible();
  expect(
    screen.getByRole("link", {
      name: "11월 1일 일요일, 예약을 불러오고 있어요",
    }),
  ).toHaveAttribute(
    "href",
    "/bookings?view=calendar&month=2026-11&day=2026-11-01",
  );
  expect(screen.queryByText("10월 예약 1건")).not.toBeInTheDocument();
  expect(
    screen.getByRole("region", { name: "선택한 날짜 예약" }),
  ).toHaveTextContent("날짜를 골라 주세요");
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

it.each([0, 1, 2, 3, 4])(
  "SSR includes %i mobile reservation dots, capped at three, and a count",
  (count) => {
    const bookings = Array.from({ length: count }, (_, index) => ({
      ...booking,
      id: String(index),
    }));
    const content = (
      <MyBookingCalendarDay
        day={{ date: "2026-10-08", day: 8, weekday: "thu", inMonth: true }}
        bookings={bookings}
        now={now}
        today="2026-10-08"
      />
    );
    const html = renderToString(content);
    expect(html).toContain('data-slot="calendar-booking-dots"');
    expect(html).toContain('data-slot="calendar-booking-chips"');
    const { container } = render(content);
    const dots = container.querySelector('[data-slot="calendar-booking-dots"]');
    expect(dots).toHaveClass("md:hidden");
    expect(dots?.querySelectorAll('[aria-hidden="true"]')).toHaveLength(
      Math.min(count, 3),
    );
    expect(dots?.querySelector(".sr-only")).toHaveTextContent(
      `예약 ${count}건`,
    );
    expect(
      container.querySelector('[data-slot="calendar-booking-chips"]'),
    ).toHaveClass("hidden", "md:block");
  },
);

it("uses the same 44px mobile day links and roving focus with the selected panel below", () => {
  render(element(data([booking])));
  const grid = screen.getByRole("grid");
  const links = within(grid).getAllByRole("link");
  for (const link of links)
    expect(link).toHaveClass("h-11", "md:h-auto", "md:min-h-28");
  expect(links.filter((link) => link.tabIndex === 0)).toHaveLength(1);
  const panel = screen.getByRole("region", { name: "선택한 날짜 예약" });
  expect(panel.parentElement).toHaveClass("lg:grid-cols-[minmax(0,1fr)_340px]");
  expect(panel.previousElementSibling).toBe(grid);
  expect(within(grid).queryByRole("button")).not.toBeInTheDocument();
});

it.each([
  ["2026-10", 35],
  ["2026-08", 42],
])(
  "matches the %s month skeleton geometry and keeps one loading announcement",
  (month, count) => {
    const content = <MyBookingsCalendarBodySkeleton month={month as string} />;
    expect(renderToString(content)).toContain("md:h-28");
    const { container } = render(content);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    const days = container.querySelectorAll(
      '[data-slot="skeleton-calendar-day"]',
    );
    expect(days).toHaveLength(count as number);
    for (const day of days) expect(day).toHaveClass("h-11", "md:h-28");
    expect(
      container.querySelector('[data-slot="skeleton-calendar-weekdays"]')
        ?.children,
    ).toHaveLength(7);
    expect(container.firstElementChild).toHaveClass(
      "lg:grid-cols-[minmax(0,1fr)_340px]",
    );
    expect(
      container.querySelector('[data-slot="skeleton-calendar-panel"]'),
    ).toBe(container.firstElementChild?.lastElementChild);
  },
);

it("renders known headings, view links and weekdays before metadata without guessing dates", () => {
  const { container } = render(<MyBookingsCalendarSkeleton />);
  expect(container.firstElementChild).toHaveClass("max-w-[1184px]");
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("heading", { name: "내 예약" })).toBeVisible();
  expect(screen.getByRole("link", { name: "공간 예약하기" })).toHaveAttribute(
    "href",
    "/booking",
  );
  expect(screen.getByRole("link", { name: "달력" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByRole("button", { name: "오늘" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "이전 달" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "다음 달" })).toBeDisabled();
  expect(screen.getByLabelText("일요일")).toHaveTextContent("일");
  expect(screen.getByLabelText("토요일")).toHaveTextContent("토");
  expect(
    screen.queryByText(/예약 0건|이 날은 예약이 없어요|\d{4}년/),
  ).not.toBeInTheDocument();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
function streamed(
  value: MyBookingsMonthData,
  bookings: Promise<MyCalendarBooking[]>,
  navigateAction?: () => Promise<void>,
) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <StreamingMyBookingsCalendar
        meta={value}
        bookings={bookings}
        navigateAction={navigateAction}
      />
    </QueryClientProvider>
  );
}

it("shows metadata dates before bookings, keeps date links and focus, and resolves the latest selected day only", async () => {
  const response = deferred<MyCalendarBooking[]>();
  await act(async () => {
    render(streamed(data(), response.promise));
  });
  const grid = screen.getByRole("grid", { name: "2026년 10월 내 예약" });
  const ninth = screen.getByRole("link", {
    name: "10월 9일 금요일, 예약을 불러오고 있어요",
  });
  expect(
    screen.queryByText(/예약 0건|이 날은 예약이 없어요/),
  ).not.toBeInTheDocument();
  await act(async () => {
    fireEvent.click(ninth);
    ninth.focus();
  });
  expect(ninth).toHaveAttribute("aria-current", "date");
  expect(
    screen.getByRole("region", { name: "선택한 날짜 예약" }),
  ).toHaveTextContent("10월 9일 금요일");
  expect(screen.getByLabelText("날짜 예약을 불러오고 있어요")).toBeVisible();
  await act(async () => {
    response.resolve([booking]);
    await response.promise;
  });
  expect(screen.getByRole("grid")).toBe(grid);
  expect(screen.getByRole("link", { name: "10월 9일 금요일, 예약 0건" })).toBe(
    ninth,
  );
  expect(ninth).toHaveFocus();
  expect(ninth).toHaveAttribute("aria-current", "date");
  expect(
    screen.getByRole("region", { name: "선택한 날짜 예약" }),
  ).toHaveTextContent("이 날은 예약이 없어요");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByText("10월 예약 1건")).toBeVisible();
});

it("queues only the last day during month navigation without another router call and preserves its link through the response", async () => {
  const navigationResponse = deferred<void>();
  const bookingsResponse = deferred<MyCalendarBooking[]>();
  const navigate = vi.fn(() => navigationResponse.promise);
  const initial = Promise.resolve([booking]);
  const view = await act(async () =>
    render(streamed(data([booking]), initial, navigate)),
  );
  const push = vi.spyOn(window.history, "pushState");
  fireEvent.click(screen.getByRole("link", { name: "다음 달" }));
  fireEvent.click(
    screen.getByRole("link", {
      name: "11월 2일 월요일, 예약을 불러오고 있어요",
    }),
  );
  const latest = screen.getByRole("link", {
    name: "11월 3일 화요일, 예약을 불러오고 있어요",
  });
  fireEvent.click(latest);
  latest.focus();
  expect(latest).toHaveAttribute("aria-current", "date");
  expect(push).not.toHaveBeenCalled();
  expect(navigate).toHaveBeenCalledOnce();
  act(() => {
    window.history.replaceState(
      null,
      "",
      "/bookings?view=calendar&month=2026-11",
    );
    view.rerender(
      streamed(data([], "2026-11"), bookingsResponse.promise, navigate),
    );
  });
  await act(async () => {
    navigationResponse.resolve();
    await navigationResponse.promise;
  });
  expect(push).toHaveBeenCalledExactlyOnceWith(
    null,
    "",
    "/bookings?view=calendar&month=2026-11&day=2026-11-03",
  );
  expect(latest).toHaveFocus();
  const nextBooking = {
    ...booking,
    date: "2026-11-03",
    start: "2026-11-03T02:00:00Z",
    end: "2026-11-03T03:00:00Z",
  };
  await act(async () => {
    bookingsResponse.resolve([nextBooking]);
    await bookingsResponse.promise;
  });
  expect(screen.getByRole("link", { name: "11월 3일 화요일, 예약 1건" })).toBe(
    latest,
  );
  expect(latest).toHaveAttribute("aria-current", "date");
  expect(latest).toHaveFocus();
  expect(
    screen.getByRole("region", { name: "선택한 날짜 예약" }),
  ).toHaveTextContent("회의실 A");
  expect(navigate).toHaveBeenCalledOnce();
  push.mockRestore();
});

it("drops a queued day when another month supersedes the in-flight month", async () => {
  const first = deferred<void>();
  const second = deferred<void>();
  const navigate = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const initial = Promise.resolve([booking]);
  const view = await act(async () =>
    render(streamed(data([booking]), initial, navigate)),
  );
  const push = vi.spyOn(window.history, "pushState");
  fireEvent.click(screen.getByRole("link", { name: "다음 달" }));
  fireEvent.click(
    screen.getByRole("link", {
      name: "11월 2일 월요일, 예약을 불러오고 있어요",
    }),
  );
  fireEvent.click(screen.getByRole("link", { name: "다음 달" }));
  expect(
    screen.getByRole("grid", { name: "2026년 12월 내 예약" }),
  ).toBeVisible();
  const december = Promise.resolve<MyCalendarBooking[]>([]);
  act(() => {
    window.history.replaceState(
      null,
      "",
      "/bookings?view=calendar&month=2026-12",
    );
    view.rerender(streamed(data([], "2026-12"), december, navigate));
  });
  await act(async () => {
    second.resolve();
    first.resolve();
    await Promise.all([first.promise, second.promise, december]);
  });
  expect(push).not.toHaveBeenCalled();
  expect(window.location.search).toBe("?view=calendar&month=2026-12");
  expect(
    screen.getByRole("region", { name: "선택한 날짜 예약" }),
  ).toHaveTextContent("날짜를 골라 주세요");
  expect(navigate).toHaveBeenCalledTimes(2);
  push.mockRestore();
});

it("does not overwrite a history selection when an older month navigation completes", async () => {
  const response = deferred<void>();
  const navigate = vi.fn(() => response.promise);
  const initial = Promise.resolve([booking]);
  await act(async () => render(streamed(data([booking]), initial, navigate)));
  const push = vi.spyOn(window.history, "pushState");
  fireEvent.click(screen.getByRole("link", { name: "다음 달" }));
  fireEvent.click(
    screen.getByRole("link", {
      name: "11월 2일 월요일, 예약을 불러오고 있어요",
    }),
  );
  changeUrl("/bookings?view=calendar&month=2026-10&day=2026-10-10");
  await act(async () => {
    response.resolve();
    await response.promise;
  });
  expect(push).not.toHaveBeenCalled();
  expect(window.location.search).toBe(
    "?view=calendar&month=2026-10&day=2026-10-10",
  );
  expect(
    screen.getByRole("link", { name: "10월 10일 토요일, 예약 0건" }),
  ).toHaveAttribute("aria-current", "date");
  expect(navigate).toHaveBeenCalledOnce();
  push.mockRestore();
});

it.each([
  "/bookings?tab=past",
  "/teams?month=2026-11",
  "/bookings?view=calendar&month=2026-12&day=2026-12-04",
])(
  "discards an in-flight day through Activity hide and return without overwriting %s",
  async (destination) => {
    const response = deferred<void>();
    const navigate = vi.fn(() => response.promise);
    const initial = Promise.resolve([booking]);
    const frame = (
      mode: "visible" | "hidden",
      value = data([booking]),
      source = initial,
    ) => <Activity mode={mode}>{streamed(value, source, navigate)}</Activity>;
    const view = await act(async () => render(frame("visible")));
    fireEvent.click(screen.getByRole("link", { name: "다음 달" }));
    fireEvent.click(
      screen.getByRole("link", {
        name: "11월 2일 월요일, 예약을 불러오고 있어요",
      }),
    );
    const push = vi.spyOn(window.history, "pushState");
    await act(async () => view.rerender(frame("hidden")));
    const settled = Promise.resolve<MyCalendarBooking[]>([]);
    await act(async () => {
      window.history.replaceState(null, "", destination);
      view.rerender(frame("hidden", data([], "2026-11"), settled));
      response.resolve();
      await response.promise;
    });
    await act(async () =>
      view.rerender(frame("visible", data([], "2026-11"), settled)),
    );
    expect(push).not.toHaveBeenCalled();
    expect(`${window.location.pathname}${window.location.search}`).toBe(
      destination,
    );
    act(() => {
      window.history.replaceState(
        null,
        "",
        "/bookings?view=calendar&month=2026-11&day=2026-11-05",
      );
      view.rerender(frame("visible", data([], "2026-11"), settled));
    });
    expect(push).not.toHaveBeenCalled();
    expect(
      screen.getByRole("link", { name: "11월 5일 목요일, 예약 0건" }),
    ).toHaveAttribute("aria-current", "date");
    expect(
      screen.getByRole("link", { name: "11월 2일 월요일, 예약 0건" }),
    ).not.toHaveAttribute("aria-current");
    expect(navigate).toHaveBeenCalledOnce();
    push.mockRestore();
  },
);

it("does not apply a queued day when the actual URL month no longer matches the resolved metadata", async () => {
  const response = deferred<void>();
  const navigate = vi.fn(() => response.promise);
  const initial = Promise.resolve([booking]);
  const view = await act(async () =>
    render(streamed(data([booking]), initial, navigate)),
  );
  fireEvent.click(screen.getByRole("link", { name: "다음 달" }));
  fireEvent.click(
    screen.getByRole("link", {
      name: "11월 2일 월요일, 예약을 불러오고 있어요",
    }),
  );
  const push = vi.spyOn(window.history, "pushState");
  const settled = Promise.resolve<MyCalendarBooking[]>([]);
  await act(async () => {
    window.history.replaceState(
      null,
      "",
      "/bookings?view=calendar&month=2026-12&day=2026-12-04",
    );
    view.rerender(streamed(data([], "2026-11"), settled, navigate));
    response.resolve();
    await response.promise;
  });
  expect(push).not.toHaveBeenCalled();
  expect(window.location.search).toBe(
    "?view=calendar&month=2026-12&day=2026-12-04",
  );
  act(() => {
    window.history.replaceState(
      null,
      "",
      "/bookings?view=calendar&month=2026-11&day=2026-11-05",
    );
    view.rerender(streamed(data([], "2026-11"), settled, navigate));
  });
  expect(push).not.toHaveBeenCalled();
  expect(
    screen.getByRole("link", { name: "11월 5일 목요일, 예약 0건" }),
  ).toHaveAttribute("aria-current", "date");
  push.mockRestore();
});

it("keeps resolved reservations and focus during a same-month refresh until fresh bookings resolve", async () => {
  const initial = Promise.resolve([booking]);
  const view = await act(async () =>
    render(streamed(data([booking]), initial)),
  );
  const link = screen.getByRole("link", { name: "10월 8일 목요일, 예약 1건" });
  await act(async () => {
    link.focus();
  });
  const fresh = deferred<MyCalendarBooking[]>();
  await act(async () => {
    startTransition(() => view.rerender(streamed(data(), fresh.promise)));
  });
  expect(screen.getByRole("link", { name: "10월 8일 목요일, 예약 1건" })).toBe(
    link,
  );
  expect(
    screen.getByRole("region", { name: "선택한 날짜 예약" }),
  ).toHaveTextContent("회의실 A");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  await act(async () => {
    fresh.resolve([]);
    await fresh.promise;
  });
  expect(
    await screen.findByRole("link", { name: "10월 8일 목요일, 예약 0건" }),
  ).toBe(link);
  expect(link).toHaveFocus();
  expect(
    screen.getByRole("region", { name: "선택한 날짜 예약" }),
  ).toHaveTextContent("이 날은 예약이 없어요");
});

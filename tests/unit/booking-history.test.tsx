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
import { Suspense } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import BookingsPage from "@/app/(app)/bookings/page";
import { MyBookings } from "@/features/bookings/components/my-bookings";
import { cancelBooking } from "@/features/bookings/actions";
import { getMyBookings } from "@/features/bookings/queries";
import { requirePageSession } from "@/lib/auth/session";
import { resolvePageContent } from "./page-test-utils";

const navigation = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/features/bookings/actions", () => ({ cancelBooking: vi.fn() }));
vi.mock("@/features/bookings/queries", () => ({ getMyBookings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requirePageSession: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePageSession).mockResolvedValue({
    userId: "member",
    email: "member@example.test",
    name: "가상 회원",
  });
  vi.mocked(getMyBookings).mockResolvedValue({
    upcoming: [],
    past: [],
    now: "2026-10-07T01:10:00.000Z",
  });
  vi.mocked(cancelBooking).mockResolvedValue({
    ok: true,
    data: { bookingId: "booking" },
  });
});

it("streams the history page before checking its own session and querying", async () => {
  const shell = BookingsPage();
  expect(shell.type).toBe(Suspense);
  expect(requirePageSession).not.toHaveBeenCalled();
  expect(getMyBookings).not.toHaveBeenCalled();
  render(shell.props.fallback);
  expect(screen.getByRole("status")).toHaveTextContent("불러오고 있어요.");
  await resolvePageContent(shell);
  expect(requirePageSession).toHaveBeenCalledWith("/bookings");
  expect(
    vi.mocked(requirePageSession).mock.invocationCallOrder[0],
  ).toBeLessThan(vi.mocked(getMyBookings).mock.invocationCallOrder[0]!);
});

it("does not query booking history after its own session guard rejects", async () => {
  vi.mocked(requirePageSession).mockRejectedValue(new Error("LOGIN_REDIRECT"));
  await expect(resolvePageContent(BookingsPage())).rejects.toThrow(
    "LOGIN_REDIRECT",
  );
  expect(getMyBookings).not.toHaveBeenCalled();
});

it.each(["upcoming", "past"] as const)(
  "shows an empty state and next step for the selected %s tab",
  (tab) => {
    render(
      <MyBookings
        tab={tab}
        data={{ upcoming: [], past: [], now: "2026-10-07T01:10:00.000Z" }}
      />,
    );
    expect(screen.getAllByText("예약이 아직 없어요")).toHaveLength(1);
    for (const link of screen.getAllByRole("link", { name: "공간 예약하기" }))
      expect(link).toHaveAttribute("href", "/booking");
  },
);

it("shows upcoming links, plain past entries and a confirmation before cancellation", async () => {
  const booking = {
    id: "booking",
    start: "2026-10-07T02:00:00Z",
    end: "2026-10-07T03:00:00Z",
    date: "2026-10-07",
    timezone: "Asia/Seoul",
    title: "팀 회의",
    attendeeCount: null,
    desk: null,
    teamName: "가상 팀",
    status: "confirmed" as const,
    cancelledAt: null,
    branchId: "branch",
    branchName: "가상 지점",
    floorId: "floor",
    floorName: "7F",
    spaceId: "space",
    spaceName: "회의실 C",
    spaceType: "meeting_room" as const,
    photo: null,
  };
  const client = new QueryClient();
  const data = {
    now: "2026-10-07T01:10:00.000Z",
    upcoming: [booking],
    past: [{ ...booking, id: "past", status: "cancelled" as const }],
  };
  const view = render(
    <QueryClientProvider client={client}>
      <MyBookings data={data} />
    </QueryClientProvider>,
  );
  expect(screen.getAllByRole("link", { name: "회의실 C" })).toHaveLength(1);
  expect(screen.queryByText("취소됨")).not.toBeInTheDocument();
  expect(screen.getByText("50분 뒤")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "취소" }));
  expect(cancelBooking).not.toHaveBeenCalled();
  const dialog = screen.getByRole("dialog", { name: "이 예약을 취소할까요?" });
  await userEvent.click(
    within(dialog).getByRole("button", { name: "예약 취소" }),
  );
  await waitFor(() =>
    expect(cancelBooking).toHaveBeenCalledWith({ bookingId: "booking" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(navigation.refresh).toHaveBeenCalledTimes(1);
  view.rerender(
    <QueryClientProvider client={client}>
      <MyBookings data={data} tab="past" />
    </QueryClientProvider>,
  );
  expect(screen.getByText("취소됨")).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "회의실 C" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "취소" }),
  ).not.toBeInTheDocument();
});

it("marks a clicked tab and replaces only the list before the response", async () => {
  let finish: () => void = () => {};
  const response = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const navigateAction = vi.fn(() => response);
  render(
    <MyBookings
      data={{ upcoming: [], past: [], now: "2026-10-07T01:10:00.000Z" }}
      navigateAction={navigateAction}
    />,
  );
  fireEvent.click(screen.getByRole("link", { name: "지난 예약" }));
  expect(
    within(
      screen.getByRole("navigation", { name: "예약 목록 선택" }),
    ).getByRole("link", { current: "page" }),
  ).toHaveTextContent("지난 예약");
  expect(screen.getByRole("heading", { name: "내 예약" })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("불러오고 있어요");
  expect(navigateAction).toHaveBeenCalledWith("/bookings?tab=past", {});
  await act(async () => {
    finish();
    await response;
  });
  expect(
    within(
      screen.getByRole("navigation", { name: "예약 목록 선택" }),
    ).getByRole("link", { current: "page" }),
  ).toHaveTextContent("다가오는 예약");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("normalizes unknown tabs and preserves the past path in the page guard", async () => {
  const past = await resolvePageContent(
    BookingsPage({ searchParams: Promise.resolve({ tab: "past" }) }),
  );
  expect(past.props.tab).toBe("past");
  expect(requirePageSession).toHaveBeenCalledWith("/bookings?tab=past");
  const unknown = await resolvePageContent(
    BookingsPage({ searchParams: Promise.resolve({ tab: "invalid" }) }),
  );
  expect(unknown.props.tab).toBe("upcoming");
});

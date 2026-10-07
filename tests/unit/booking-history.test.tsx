import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import BookingsPage from "@/app/(app)/bookings/page";
import { MyBookings } from "@/features/bookings/components/my-bookings";
import { cancelBooking } from "@/features/bookings/actions";
import { getMyBookings } from "@/features/bookings/queries";
import { requirePageSession } from "@/lib/auth/session";
import { resolvePageContent } from "./page-test-utils";

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));
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
  vi.mocked(getMyBookings).mockResolvedValue({ upcoming: [], past: [] });
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

it("shows the empty state in each history section", () => {
  render(<MyBookings data={{ upcoming: [], past: [] }} />);
  expect(screen.getAllByText("예약이 아직 없어요")).toHaveLength(2);
});

it("shows upcoming links, plain past entries and a confirmation before cancellation", async () => {
  const booking = {
    id: "booking",
    start: "2026-10-07T02:00:00Z",
    end: "2026-10-07T03:00:00Z",
    date: "2026-10-07",
    timezone: "Asia/Seoul",
    title: "팀 회의",
    teamName: "가상 팀",
    status: "confirmed" as const,
    cancelledAt: null,
    branchId: "branch",
    branchName: "가상 지점",
    floorId: "floor",
    floorName: "7F",
    spaceId: "space",
    spaceName: "회의실 C",
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MyBookings
        data={{
          upcoming: [booking],
          past: [{ ...booking, id: "past", status: "cancelled" }],
        }}
      />
    </QueryClientProvider>,
  );
  expect(screen.getAllByRole("link", { name: "회의실 C" })).toHaveLength(1);
  expect(screen.getByText("취소됨")).toBeVisible();
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
});

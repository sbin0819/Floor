import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MyBookings } from "@/features/bookings/components/my-bookings";
import type { MyBooking } from "@/features/bookings/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/features/bookings/actions", () => ({
  cancelBooking: vi.fn(),
  leaveBooking: vi.fn(),
}));
const booking: MyBooking = {
  id: "booking",
  meetingRoomId: null,
  relation: "owner",
  invitedByName: null,
  participantNames: [],
  desk: null,
  start: "2026-10-07T02:00:00Z",
  end: "2026-10-07T03:00:00Z",
  date: "2026-10-07",
  timezone: "Asia/Seoul",
  title: "기획 회의",
  attendeeCount: 3,
  teamName: "가상 팀",
  status: "cancelled",
  cancelledAt: "2026-10-07T01:00:00Z",
  branchId: "branch",
  branchName: "강남점",
  floorId: "floor",
  floorName: "7F",
  spaceId: "space",
  spaceName: "회의실 C",
  spaceType: "meeting_room",
  photo: null,
};
it.each([
  [
    { cancelKind: "operator", cancelReason: "운영 사정 · 냉방기 점검" },
    "운영자가 취소함 · 운영 사정 · 냉방기 점검",
  ],
  [
    { cancelKind: "maintenance", cancelReason: "모니터 교체" },
    "점검으로 취소됨 · 모니터 교체",
  ],
  [{ cancelKind: null, cancelReason: null }, "취소됨"],
  [{}, "취소됨"],
] satisfies [Partial<MyBooking>, string][])(
  "renders cancellation snapshots in the actual past booking row: %j",
  (change, expected) => {
    render(
      <MyBookings
        tab="past"
        data={{
          now: "2026-10-08T03:00:00Z",
          upcoming: [],
          past: [{ ...booking, ...change }],
        }}
      />,
    );
    expect(screen.getByText(expected)).toBeVisible();
    expect(screen.getByText("회의실 C")).toBeVisible();
    expect(screen.getByRole("listitem")).toHaveTextContent("기획 회의");
    expect(
      screen.queryByRole("button", { name: "취소" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "회의실 C" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("이용 종료")).not.toBeInTheDocument();
  },
);
it("keeps completed confirmed bookings distinct from cancelled ones", () => {
  render(
    <MyBookings
      tab="past"
      data={{
        now: "2026-10-08T03:00:00Z",
        upcoming: [],
        past: [{ ...booking, status: "confirmed", cancelledAt: null }],
      }}
    />,
  );
  expect(screen.getByText("이용 종료")).toBeVisible();
  expect(screen.queryByText(/취소됨|취소함/)).not.toBeInTheDocument();
});

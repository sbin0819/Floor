import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { HomeNextBooking } from "@/features/bookings/components/home-next-booking";
import {
  HomeFrequentSpaces,
  HomeWeekBookings,
} from "@/features/bookings/components/home-secondary-cards";
import type {
  HomeWeekBookingsData,
  MyCalendarBooking,
} from "@/features/bookings/types";
import { addDays } from "@/lib/time/zoned";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/bookings/actions", () => ({ cancelBooking: vi.fn() }));
const booking: MyCalendarBooking = {
  relation: "owner",
  meetingRoomId: null,
  invitedByName: null,
  participantNames: [],
  id: "booking",
  start: "2026-10-07T06:00:00Z",
  end: "2026-10-07T07:00:00Z",
  date: "2026-10-07",
  timezone: "Asia/Seoul",
  branchId: "branch",
  branchName: "가상 지점",
  floorId: "floor",
  floorName: "7F",
  spaceId: "space",
  spaceName: "회의실 C",
  spaceType: "meeting_room",
  title: "가상 모임",
  attendeeCount: null,
  desk: null,
  teamName: null,
  status: "confirmed",
  cancelledAt: null,
  canCancel: true,
  photo: {
    path: "/seed/photos/meeting-small-sage.webp",
    alt: "가상 회의실 사진",
  },
};
function showNext(bookings: MyCalendarBooking[], now = "2026-10-07T06:25:00Z") {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <HomeNextBooking data={{ now, bookings }} />
    </QueryClientProvider>,
  );
}
it("shows the attendee badge only when the count is known", () => {
  const view = showNext([{ ...booking, attendeeCount: 5 }]);
  expect(screen.getByText("5명")).toBeVisible();
  view.unmount();
  showNext([booking]);
  expect(screen.queryByText("5명")).not.toBeInTheDocument();
});
it("shows ongoing status, an eager photo, exact space navigation and the existing cancellation confirmation", async () => {
  const user = userEvent.setup();
  const { container } = showNext([booking]);
  expect(screen.getByText("지금 이용 중")).toBeVisible();
  expect(screen.getByText("35분 남음")).toBeVisible();
  expect(screen.getByText("15:00–16:00")).toHaveClass(
    "font-bold",
    "text-[28px]",
  );
  expect(container.querySelector("img")).toHaveAttribute("loading", "eager");
  expect(screen.getByRole("link", { name: "일정 보기" })).toHaveAttribute(
    "href",
    "/branches/branch/floors/floor?date=2026-10-07&space=space",
  );
  await user.click(screen.getByRole("button", { name: "예약 취소" }));
  expect(
    screen.getByRole("dialog", { name: "이 예약을 취소할까요?" }),
  ).toBeVisible();
});
it.each([
  ["2026-10-07T03:00:00Z", "오늘 · 3시간 뒤"],
  ["2026-10-06T03:00:00Z", "내일 · 10월 7일 수"],
  ["2026-10-05T03:00:00Z", "10월 7일 수"],
])("shows injected next-booking date state at %s", (now, label) => {
  showNext([booking], now);
  expect(screen.getByText(label)).toBeVisible();
});
it("shows only the second row, never a third, and omits the next row for a single booking", () => {
  const view = showNext([
    booking,
    { ...booking, id: "second", spaceName: "두 번째 공간" },
    { ...booking, id: "third", spaceName: "세 번째 공간" },
  ]);
  expect(screen.getByText("다음", { exact: true })).toBeVisible();
  expect(screen.getByText(/두 번째 공간/)).toBeVisible();
  expect(screen.queryByText(/세 번째 공간/)).not.toBeInTheDocument();
  view.unmount();
  showNext([booking]);
  expect(screen.queryByText("다음", { exact: true })).not.toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: /내 예약 모두 보기/ }),
  ).toHaveAttribute("href", "/bookings");
});
it("uses the server's cancellation flag and preserves the empty booking action", () => {
  const view = showNext([{ ...booking, canCancel: false }]);
  expect(
    screen.queryByRole("button", { name: "예약 취소" }),
  ).not.toBeInTheDocument();
  view.unmount();
  showNext([]);
  expect(screen.getByText("예약이 아직 없어요")).toBeVisible();
  expect(screen.getByRole("link", { name: /공간 예약하기/ })).toHaveAttribute(
    "href",
    "/booking",
  );
});
const week: HomeWeekBookingsData = {
  now: "2026-10-07T06:25:00Z",
  today: "2026-10-07",
  timezone: "Asia/Seoul",
  openHours: { sun: null },
  days: Array.from({ length: 7 }, (_, i) => ({
    date: addDays("2026-10-07", i),
    bookings: i === 0 ? [booking] : [],
  })),
};
it("shows seven days, today, branch closed days, empty days and plain booking links", () => {
  render(<HomeWeekBookings data={week} />);
  const region = screen.getByRole("region", { name: "이번 주 내 예약" });
  expect(within(region).getAllByRole("listitem")).toHaveLength(7);
  expect(screen.getByText("오늘")).toBeVisible();
  expect(screen.getByText("쉬는 날")).toBeVisible();
  expect(screen.getAllByText("예약 없음")).toHaveLength(5);
  const link = screen.getByRole("link", { name: "15:00 회의실 C" });
  expect(link).toHaveAttribute(
    "href",
    "/bookings?view=calendar&month=2026-10&day=2026-10-07",
  );
  expect(link.querySelector("button")).toBeNull();
  expect(screen.getByRole("link", { name: "달력으로 보기" })).toHaveAttribute(
    "href",
    "/bookings?view=calendar",
  );
});
it("gives bookings priority over a closed-day label and does not invent hours without a branch", () => {
  const view = render(
    <HomeWeekBookings
      data={{ ...week, openHours: { wed: null }, days: [week.days[0]!] }}
    />,
  );
  expect(screen.queryByText("쉬는 날")).not.toBeInTheDocument();
  view.rerender(
    <HomeWeekBookings
      data={{
        ...week,
        openHours: null,
        days: [{ date: week.today, bookings: [] }],
      }}
    />,
  );
  expect(screen.getByText("예약 없음")).toBeVisible();
});
it("omits empty frequent cards and links photos to the space's own local today", () => {
  const view = render(<HomeFrequentSpaces data={{ spaces: [] }} />);
  expect(
    screen.queryByRole("region", { name: "자주 쓰는 공간" }),
  ).not.toBeInTheDocument();
  view.rerender(
    <HomeFrequentSpaces
      data={{
        spaces: [
          {
            id: "space",
            name: "회의실 C",
            type: "meeting_room",
            photo: booking.photo,
            branchId: "branch",
            branchName: "가상 지점",
            floorId: "floor",
            floorName: "7F",
            date: "2026-10-06",
            bookingCount: 5,
          },
        ],
      }}
    />,
  );
  const link = screen.getByRole("link", { name: /회의실 C.*5번 예약/ });
  expect(link).toHaveAttribute(
    "href",
    "/branches/branch/floors/floor?date=2026-10-06&space=space",
  );
  expect(link.querySelector("button")).toBeNull();
  expect(link.querySelector("img")).toHaveAttribute("loading", "lazy");
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { normalizeMyBookingsMonth } from "@/features/bookings/calendar";
import { canEditBooking } from "@/features/bookings/booking-presentation";
import { MyBookings } from "@/features/bookings/components/my-bookings";
import { SelectedDayPanel } from "@/features/bookings/components/my-bookings-calendar-panel";
import type { MyCalendarBooking } from "@/features/bookings/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/features/bookings/actions", () => ({
  cancelBooking: vi.fn(),
  leaveBooking: vi.fn(),
}));
const now = "2026-10-07T03:00:00.000Z";
const booking: MyCalendarBooking = {
  id: "a03230cc-e9e0-47db-b409-c6b2c482b318",
  relation: "owner",
  invitedByName: null,
  participantNames: [],
  start: "2026-10-07T04:00:00.000Z",
  end: "2026-10-07T05:00:00.000Z",
  date: "2026-10-07",
  timezone: "Asia/Seoul",
  title: "회의",
  attendeeCount: 2,
  teamName: null,
  status: "confirmed",
  cancelledAt: null,
  branchId: "branch",
  branchName: "강남점",
  floorId: "floor",
  floorName: "7F",
  spaceId: "space",
  spaceName: "회의실 A",
  spaceType: "meeting_room",
  photo: null,
  desk: null,
  canCancel: true,
};
function draw(surface: "list" | "calendar", row: MyCalendarBooking) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      {surface === "list" ? (
        <MyBookings data={{ now, upcoming: [row], past: [] }} />
      ) : (
        <SelectedDayPanel
          day={row.date}
          meta={{
            ...normalizeMyBookingsMonth(
              { month: "2026-10", day: row.date },
              "2026-10-07",
            ),
            now,
            timezone: "Asia/Seoul",
          }}
          source={[row]}
        />
      )}
    </QueryClientProvider>,
  );
}

describe.each(["list", "calendar"] as const)(
  "edit booking entry on %s",
  (surface) => {
    it("renders an accessible native link next to cancellation with the original booking ID", () => {
      draw(surface, booking);
      const link = screen.getByRole("link", { name: "회의실 A 예약 바꾸기" });
      expect(link).toHaveAttribute("href", `/bookings/${booking.id}/edit`);
      expect(link).toHaveTextContent("바꾸기");
      expect(
        link.compareDocumentPosition(
          screen.getByRole("button", {
            name: surface === "list" ? "취소" : "예약 취소",
          }),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      let preventedByLink = true;
      document.addEventListener(
        "click",
        (event) => {
          preventedByLink = event.defaultPrevented;
          event.preventDefault();
        },
        { once: true },
      );
      fireEvent.click(link, { ctrlKey: true });
      expect(preventedByLink).toBe(false);
    });
    it("keeps editing available for an ongoing time reservation", () => {
      draw(surface, { ...booking, start: now });
      expect(
        screen.getByRole("link", { name: "회의실 A 예약 바꾸기" }),
      ).toBeInTheDocument();
    });
    it.each(["desk", "raw_desk", "invited", "ended", "cancelled"] as const)(
      "does not expose an edit link for %s",
      (kind) => {
        const row: MyCalendarBooking = {
          ...booking,
          ...(kind === "desk"
            ? {
                desk: { id: "desk", name: "A-01", part: "am" },
                spaceType: "desk_area",
              }
            : {}),
          ...(kind === "raw_desk" ? { spaceType: "desk" } : {}),
          ...(kind === "invited"
            ? { relation: "invited", invitedByName: "홍길동" }
            : {}),
          ...(kind === "ended"
            ? { start: "2026-10-07T02:00:00.000Z", end: now }
            : {}),
          ...(kind === "cancelled"
            ? { status: "cancelled", cancelledAt: now }
            : {}),
        };
        draw(surface, row);
        expect(
          screen.queryByRole("link", { name: /예약 바꾸기/ }),
        ).not.toBeInTheDocument();
      },
    );
  },
);

it("never adds an edit action to past history even for malformed future input", () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MyBookings tab="past" data={{ now, upcoming: [], past: [booking] }} />
    </QueryClientProvider>,
  );
  expect(
    screen.queryByRole("link", { name: /예약 바꾸기/ }),
  ).not.toBeInTheDocument();
});

it("does not confuse cancellation capability with edit ownership", () => {
  expect(canEditBooking(booking, now)).toBe(true);
  draw("calendar", { ...booking, canCancel: false });
  expect(
    screen.getByRole("link", { name: "회의실 A 예약 바꾸기" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "예약 취소" }),
  ).not.toBeInTheDocument();
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MyBookings } from "@/features/bookings/components/my-bookings";
import { SelectedDayPanel } from "@/features/bookings/components/my-bookings-calendar-panel";
import { CalendarDayBookings } from "@/features/bookings/components/my-bookings-calendar-day";
import { HomeNextBooking } from "@/features/bookings/components/home-next-booking";
import { normalizeMyBookingsMonth } from "@/features/bookings/calendar";
import {
  bookingSpaceHref,
  bookingSpaceLabel,
} from "@/features/bookings/booking-presentation";
import type { MyCalendarBooking } from "@/features/bookings/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/features/bookings/actions", () => ({ cancelBooking: vi.fn() }));
const now = "2026-10-07T01:10:00.000Z";
function booking(): MyCalendarBooking {
  return {
    relation: "owner",
    invitedByName: null,
    participantNames: [],
    id: "reservation",
    start: "2026-10-08T00:00:00.000Z",
    end: "2026-10-08T13:00:00.000Z",
    date: "2026-10-08",
    timezone: "Asia/Seoul",
    title: null,
    attendeeCount: null,
    teamName: null,
    status: "confirmed",
    cancelledAt: null,
    branchId: "branch",
    branchName: "가상 지점",
    floorId: "floor",
    floorName: "7F",
    spaceId: "area",
    spaceName: "오픈 데스크",
    spaceType: "desk_area",
    photo: null,
    desk: { id: "seat", name: "A-15", part: "day" },
    canCancel: true,
  };
}

describe("own desk reservation displays", () => {
  it.each(["list", "calendar", "home"] as const)(
    "shows the area and seat, part, time, badge and detail link in %s",
    (surface) => {
      const row = booking();
      const node =
        surface === "list" ? (
          <MyBookings data={{ now, upcoming: [row], past: [] }} />
        ) : surface === "calendar" ? (
          <SelectedDayPanel
            day={row.date}
            meta={{
              ...normalizeMyBookingsMonth(
                { month: "2026-10", day: row.date },
                "2026-10-07",
              ),
              now,
              timezone: row.timezone,
            }}
            source={[row]}
          />
        ) : (
          <HomeNextBooking data={{ now, bookings: [row] }} />
        );
      render(
        <QueryClientProvider client={new QueryClient()}>
          {node}
        </QueryClientProvider>,
      );
      expect(screen.getByText("오픈 데스크 · A-15")).toBeInTheDocument();
      expect(screen.getByText("종일")).toBeInTheDocument();
      expect(screen.getByText("09:00–22:00")).toBeInTheDocument();
      expect(screen.getByText("좌석")).toBeInTheDocument();
      const linkName =
        surface === "list"
          ? "오픈 데스크 · A-15"
          : surface === "calendar"
            ? "공간 보기"
            : "일정 보기";
      expect(screen.getByRole("link", { name: linkName })).toHaveAttribute(
        "href",
        "/branches/branch/floors/floor?date=2026-10-08&space=area&detail=1",
      );
      expect(
        screen.getByRole("button", {
          name: surface === "list" ? "취소" : "예약 취소",
        }),
      ).toBeInTheDocument();
    },
  );
  it("does not invent a part for an older range after operating hours changed", () => {
    const row = booking();
    row.desk!.part = null;
    render(
      <HomeNextBooking
        data={{ now, bookings: [{ ...row, canCancel: false }] }}
      />,
    );
    expect(screen.getByText("09:00–22:00")).toBeInTheDocument();
    expect(screen.queryByText("종일")).not.toBeInTheDocument();
    expect(screen.getByText("좌석")).toBeInTheDocument();
  });
  it("keeps desk names and parts in calendar chips", () => {
    render(<CalendarDayBookings bookings={[booking()]} now={now} />);
    expect(screen.getByText("종일 오픈 데스크 · A-15")).toBeInTheDocument();
  });
  it("shows the following reservation's seat in the home footer", () => {
    const first = { ...booking(), desk: null, spaceName: "회의실" };
    const next = { ...booking(), id: "next" };
    render(
      <HomeNextBooking
        data={{ now, bookings: [{ ...first, canCancel: false }, next] }}
      />,
    );
    expect(
      screen.getByText("오픈 데스크 · A-15 · 가상 지점 7F"),
    ).toBeInTheDocument();
    expect(screen.getByText(/09:00–22:00 · 종일/)).toBeInTheDocument();
  });
  it("keeps ordinary meeting labels and links unchanged", () => {
    const row = { ...booking(), desk: null, spaceName: "회의실" };
    expect(bookingSpaceLabel(row)).toBe("회의실");
    expect(bookingSpaceHref(row)).toBe(
      "/branches/branch/floors/floor?date=2026-10-08&space=area",
    );
  });
});

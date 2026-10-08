import { render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MyBookings } from "@/features/bookings/components/my-bookings";
import { SelectedDayPanel } from "@/features/bookings/components/my-bookings-calendar-panel";
import { HomeNextBooking } from "@/features/bookings/components/home-next-booking";
import { normalizeMyBookingsMonth } from "@/features/bookings/calendar";
import type { MyCalendarBooking } from "@/features/bookings/types";
import { NotificationRow } from "@/features/notifications/components/notification-list";
import { useNotificationToasts } from "@/features/notifications/components/use-notification-toasts";
import { notificationHref } from "@/features/notifications/format";
import type {
  NotificationItem,
  NotificationSummary,
} from "@/features/notifications/types";

const mocks = vi.hoisted(() => ({ push: vi.fn(), toast: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: vi.fn() }),
  useSearchParams: () =>
    new URLSearchParams("view=calendar&month=2026-10&day=2026-10-08"),
}));
vi.mock("@/features/bookings/actions", () => ({
  cancelBooking: vi.fn(),
  leaveBooking: vi.fn(),
}));
vi.mock("@/features/chat/components/use-chat-metadata", () => ({
  useChatMetadata: () => ({ myStatus: "online" }),
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
const now = "2026-10-08T03:00:00.000Z";
const booking: MyCalendarBooking = {
  id: "a03230cc-e9e0-47db-b409-c6b2c482b318",
  meetingRoomId: "a03230cc-e9e0-47db-b409-c6b2c482b319",
  relation: "invited",
  invitedByName: "박지훈",
  participantNames: [],
  start: "2026-10-08T04:00:00.000Z",
  end: "2026-10-08T05:00:00.000Z",
  date: "2026-10-08",
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
  canCancel: false,
};
function show(surface: "list" | "calendar" | "home", row: MyCalendarBooking) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      {surface === "home" ? (
        <HomeNextBooking data={{ now, bookings: [row] }} />
      ) : surface === "list" ? (
        <MyBookings
          tab={row.status === "cancelled" ? "past" : "upcoming"}
          data={{ now, upcoming: [row], past: [row] }}
        />
      ) : (
        <SelectedDayPanel
          day={row.date}
          meta={{
            ...normalizeMyBookingsMonth(
              { month: "2026-10", day: row.date },
              row.date,
            ),
            now,
            timezone: row.timezone,
          }}
          source={[row]}
        />
      )}
    </QueryClientProvider>,
  );
}

describe.each(["list", "calendar"] as const)(
  "meeting entry from %s",
  (surface) => {
    it.each(["confirmed", "cancelled"] as const)(
      "links a member's %s reservation without exposing a space link",
      (status) => {
        show(surface, {
          ...booking,
          status,
          cancelledAt: status === "cancelled" ? now : null,
        });
        const link = screen.getByRole("link", { name: "채팅" });
        expect(link).toHaveAttribute("href", `/m/${booking.id}`);
        expect(link).toHaveAttribute("data-chat-link", booking.id);
        expect(
          screen.queryByRole("link", { name: /공간 보기|회의실 A/ }),
        ).not.toBeInTheDocument();
      },
    );
    it("does not invent a room for an old booking or a desk", () => {
      const first = show(surface, { ...booking, meetingRoomId: null });
      expect(
        screen.queryByRole("link", { name: "채팅" }),
      ).not.toBeInTheDocument();
      first.unmount();
      show(surface, {
        ...booking,
        desk: { id: "desk", name: "A1", part: "am" },
      });
      expect(
        screen.queryByRole("link", { name: "채팅" }),
      ).not.toBeInTheDocument();
    });
  },
);
it("opens a home time reservation's meeting without adding a room lookup, never a desk meeting", () => {
  const first = show("home", { ...booking, meetingRoomId: null });
  expect(screen.getByRole("link", { name: "채팅" })).toHaveAttribute(
    "href",
    `/m/${booking.id}`,
  );
  first.unmount();
  show("home", { ...booking, desk: { id: "desk", name: "A1", part: "am" } });
  expect(screen.queryByRole("link", { name: "채팅" })).not.toBeInTheDocument();
});
it("uses the same meeting destination in reminder rows and toast actions", () => {
  const reminder: NotificationItem = {
    id: "reminder",
    type: "booking_reminder",
    bookingId: booking.id,
    read: false,
    scheduledFor: "2026-10-08T02:59:00.000Z",
    href: null,
    data: {
      spaceName: booking.spaceName,
      floorName: booking.floorName,
      branchName: booking.branchName,
      timezone: booking.timezone,
      start: booking.start,
      end: booking.end,
      minutesBefore: 30,
    },
  };
  reminder.href = notificationHref(reminder);
  render(<NotificationRow item={reminder} now={now} onActivate={vi.fn()} />);
  expect(screen.getByRole("link")).toHaveAttribute("href", `/m/${booking.id}`);
  const activate = vi.fn().mockResolvedValue(true);
  const summary: NotificationSummary = {
    items: [],
    now: "2026-10-08T02:58:00.000Z",
    unreadCount: 0,
    nextAt: null,
  };
  const { rerender } = renderHook(
    ({ data }) => useNotificationToasts(data, activate),
    { initialProps: { data: summary } },
  );
  rerender({ data: { ...summary, now, items: [reminder], unreadCount: 1 } });
  expect(mocks.toast).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      action: expect.objectContaining({ label: "보기" }),
    }),
  );
  mocks.toast.mock.calls.at(-1)![1].action.onClick();
  expect(activate).toHaveBeenCalledWith(
    expect.objectContaining({ href: `/m/${booking.id}` }),
  );
});

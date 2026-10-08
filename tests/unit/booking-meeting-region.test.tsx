import { Suspense } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import BookingsPage from "@/app/(app)/bookings/page";
import { BookingMeetingRegion } from "@/features/bookings/components/booking-meeting-region";
import { BookingMeetingSheet } from "@/features/bookings/components/booking-meeting-sheet";
import { MeetingScreen } from "@/features/chat/components/channel-screen";
import { meetingView } from "../helpers/meeting";
import { resolvePageContent } from "./page-test-utils";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  meeting: vi.fn(),
  bookings: vi.fn(),
  month: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requirePageSession: mocks.guard }));
vi.mock("@/features/chat/queries", () => ({ getMeetingView: mocks.meeting }));
vi.mock("@/features/bookings/queries", () => ({
  getMyBookings: mocks.bookings,
  getMyBookingsMonthStream: mocks.month,
}));
vi.mock("@/features/bookings/actions", () => ({
  cancelBooking: vi.fn(),
  leaveBooking: vi.fn(),
}));
vi.mock("@/features/chat/components/channel-screen", () => ({
  MeetingScreen: () => null,
}));
vi.mock("@/features/bookings/components/booking-meeting-sheet", () => ({
  BookingMeetingSheet: () => null,
  BookingMeetingPending: () => null,
  BookingMeetingSheetActions: () => <button>회의 채팅 닫기</button>,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue(undefined);
  mocks.meeting.mockResolvedValue(meetingView());
  mocks.bookings.mockReturnValue(new Promise(() => {}));
});
const bookingId = meetingView().booking.id;

it("keeps list and meeting under independent sibling boundaries without a chat-dependent list key", () => {
  const page = BookingsPage({
    searchParams: Promise.resolve({ chat: bookingId }),
  });
  const [list, meeting] = page.props.children;
  expect(list.type).toBe(Suspense);
  expect(meeting.type).toBe(Suspense);
  expect(list.key).toBeNull();
  expect(meeting.props.children.type).toBe(BookingMeetingRegion);
  expect(mocks.guard).not.toHaveBeenCalled();
  expect(mocks.meeting).not.toHaveBeenCalled();
});

it("returns the persistent container before the detail query and guards the complete return address", async () => {
  const query = {
    view: "calendar",
    month: "2026-10",
    day: "2026-10-08",
    chat: bookingId,
  };
  const sheet = await BookingMeetingRegion({
    searchParams: Promise.resolve(query),
  });
  expect(sheet.type).toBe(BookingMeetingSheet);
  expect(sheet.props.bookingId).toBe(bookingId);
  expect(mocks.guard).toHaveBeenCalledExactlyOnceWith(
    `/bookings?view=calendar&month=2026-10&day=2026-10-08&chat=${bookingId}`,
  );
  expect(mocks.meeting).not.toHaveBeenCalled();
  const content = await resolvePageContent(sheet.props.children);
  expect(mocks.meeting).toHaveBeenCalledExactlyOnceWith(bookingId);
  expect(content.type).toBe(MeetingScreen);
  expect(content.props.variant).toBe("sheet");
  expect(content.props.actions).toBeTruthy();
  expect(mocks.bookings).not.toHaveBeenCalled();
  expect(mocks.month).not.toHaveBeenCalled();
});

it("does not query on an absent chat or rejected session", async () => {
  const empty = await BookingMeetingRegion({});
  expect(empty.props.bookingId).toBeNull();
  expect(empty.props.children).toBe(false);
  expect(mocks.guard).not.toHaveBeenCalled();
  mocks.guard.mockRejectedValue(new Error("login"));
  await expect(
    BookingMeetingRegion({
      searchParams: Promise.resolve({ chat: bookingId }),
    }),
  ).rejects.toThrow("login");
  expect(mocks.meeting).not.toHaveBeenCalled();
});

it.each(["invalid", bookingId, [bookingId, "duplicate"]])(
  "keeps close available and returns the same safe missing text for %s",
  async (chat) => {
    mocks.meeting.mockResolvedValue(null);
    const sheet = await BookingMeetingRegion({
      searchParams: Promise.resolve({ chat }),
    });
    const content = await resolvePageContent(sheet.props.children);
    render(content);
    expect(screen.getByText("이 회의를 볼 수 없어요")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "회의 채팅 닫기" }),
    ).toBeVisible();
    expect(mocks.meeting).toHaveBeenCalledWith(
      typeof chat === "string" ? chat : "",
    );
  },
);

import type { ReactNode } from "react";
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
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { leaveBooking } from "@/features/bookings/actions";
import { MyBookings } from "@/features/bookings/components/my-bookings";
import { SelectedDayPanel } from "@/features/bookings/components/my-bookings-calendar-panel";
import { CalendarDayBookings } from "@/features/bookings/components/my-bookings-calendar-day";
import { HomeNextBooking } from "@/features/bookings/components/home-next-booking";
import { HomeWeekBookings } from "@/features/bookings/components/home-secondary-cards";
import { BookingParticipantsSummary } from "@/features/bookings/components/booking-participants-summary";
import { LeaveBookingButton } from "@/features/bookings/components/leave-booking-button";
import { normalizeMyBookingsMonth } from "@/features/bookings/calendar";
import {
  bookingPhoto,
  bookingSpaceHref,
  canLeaveBooking,
} from "@/features/bookings/booking-presentation";
import type {
  MyCalendarBooking,
  HomeWeekBooking,
} from "@/features/bookings/types";
import type { ActionResult } from "@/lib/actions/result";

const runtime = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => runtime }));
vi.mock("@/features/bookings/actions", () => ({
  leaveBooking: vi.fn(),
  cancelBooking: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const now = "2026-10-07T01:10:00.000Z";
function fixture(patch: Partial<MyCalendarBooking> = {}): MyCalendarBooking {
  return {
    id: "invited",
    relation: "invited",
    invitedByName: "최민준",
    participantNames: ["김하은", "이서연"],
    start: "2026-10-08T00:00:00.000Z",
    end: "2026-10-08T01:00:00.000Z",
    date: "2026-10-08",
    timezone: "Asia/Seoul",
    title: "스프린트 계획",
    attendeeCount: 3,
    teamName: "가상 디자인팀",
    status: "confirmed",
    cancelledAt: null,
    branchId: "branch",
    branchName: "가상 지점",
    floorId: "floor",
    floorName: "7F",
    spaceId: "space",
    spaceName: "전용 회의실",
    spaceType: "meeting_room",
    photo: {
      path: "/seed/photos/meeting-small-sage.webp",
      alt: "내려오면 안 되는 사진",
    },
    desk: null,
    canCancel: false,
    ...patch,
  };
}
function wrap(node: ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>
  );
}
type Surface = "list" | "calendar" | "home";
function surface(kind: Surface, booking: MyCalendarBooking) {
  if (kind === "list")
    return <MyBookings data={{ now, upcoming: [booking], past: [] }} />;
  if (kind === "home")
    return <HomeNextBooking data={{ now, bookings: [booking] }} />;
  return (
    <SelectedDayPanel
      day={booking.date}
      meta={{
        ...normalizeMyBookingsMonth(
          { month: "2026-10", day: booking.date },
          "2026-10-07",
        ),
        now,
        timezone: "Asia/Seoul",
      }}
      source={[booking]}
    />
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(leaveBooking).mockResolvedValue({
    ok: true,
    data: { bookingId: "invited" },
  });
});

describe("invited reservation presentation", () => {
  it.each(["list", "calendar", "home"] as const)(
    "shows invitation and leave instead of cancel, photo, or a space link on %s",
    (kind) => {
      const row = fixture({ canCancel: true });
      const { container } = render(wrap(surface(kind, row)));
      expect(screen.getByText("초대받음")).toBeInTheDocument();
      expect(screen.getByText("최민준 님이 초대")).toBeInTheDocument();
      expect(screen.getByText("참석자 김하은 외 1명")).toBeInTheDocument();
      expect(screen.getByText("전용 회의실")).toBeInTheDocument();
      expect(screen.getByText("3명")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "참석 안 함" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /취소/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: "전용 회의실" }),
      ).not.toBeInTheDocument();
      expect(container.querySelector('a[href^="/branches/"]')).toBeNull();
      expect(container.querySelector("img")).toBeNull();
      expect(
        container.querySelector('[data-slot="photo-placeholder"]'),
      ).not.toBeNull();
      expect(container.innerHTML).not.toContain(row.photo!.path);
    },
  );
  it.each(["list", "calendar", "home"] as const)(
    "keeps ongoing invitations eligible to leave on %s",
    (kind) => {
      render(
        wrap(
          surface(
            kind,
            fixture({
              start: "2026-10-07T01:00:00.000Z",
              end: "2026-10-07T02:00:00.000Z",
            }),
          ),
        ),
      );
      expect(
        screen.getByRole("button", { name: "참석 안 함" }),
      ).toBeInTheDocument();
    },
  );
  it.each(["list", "calendar", "home"] as const)(
    "does not offer leave for ended or cancelled bookings on %s",
    (kind) => {
      const view = render(
        wrap(
          surface(
            kind,
            fixture({ start: "2026-10-07T00:00:00.000Z", end: now }),
          ),
        ),
      );
      expect(
        screen.queryByRole("button", { name: "참석 안 함" }),
      ).not.toBeInTheDocument();
      view.unmount();
      render(
        wrap(surface(kind, fixture({ status: "cancelled", cancelledAt: now }))),
      );
      expect(
        screen.queryByRole("button", { name: "참석 안 함" }),
      ).not.toBeInTheDocument();
    },
  );
  it("keeps a cancelled invitation visible in past history without any action or image", () => {
    const row = fixture({ status: "cancelled", cancelledAt: now });
    const { container } = render(
      wrap(<MyBookings tab="past" data={{ now, upcoming: [], past: [row] }} />),
    );
    expect(screen.getByText("취소됨")).toBeInTheDocument();
    expect(screen.getByText("초대받음")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });
  it.each(["list", "calendar", "home"] as const)(
    "retains owner photos, space link and cancellation on %s",
    (kind) => {
      const row = fixture({
        relation: "owner",
        invitedByName: null,
        canCancel: true,
      });
      const { container } = render(wrap(surface(kind, row)));
      expect(screen.queryByText("초대받음")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "참석 안 함" }),
      ).not.toBeInTheDocument();
      expect(screen.getByText("참석자 김하은 외 1명")).toBeInTheDocument();
      expect(
        screen.getByRole("button", {
          name: kind === "list" ? "취소" : "예약 취소",
        }),
      ).toBeInTheDocument();
      expect(container.querySelector("img")).not.toBeNull();
      expect(container.querySelector('a[href^="/branches/"]')).not.toBeNull();
    },
  );
  it("adds the invitation label to calendar chips and the following home booking", () => {
    const view = render(
      <CalendarDayBookings bookings={[fixture()]} now={now} />,
    );
    expect(
      screen.getByText("09:00 전용 회의실 · 초대받음"),
    ).toBeInTheDocument();
    view.unmount();
    render(
      wrap(
        <HomeNextBooking
          data={{
            now,
            bookings: [
              fixture({
                id: "own",
                relation: "owner",
                invitedByName: null,
                participantNames: [],
              }),
              fixture(),
            ],
          }}
        />,
      ),
    );
    expect(screen.getByText("초대받음")).toBeInTheDocument();
    expect(screen.getByText("최민준 님이 초대")).toBeInTheDocument();
  });
  it.each([
    [[], null],
    [["이서연"], "참석자 이서연"],
    [["이서연", "정민지", "최민준"], "참석자 이서연 외 2명"],
  ] as const)("summarizes owner participant names %j", (names, expected) => {
    const { container } = render(
      <BookingParticipantsSummary
        booking={{
          relation: "owner",
          invitedByName: null,
          participantNames: [...names],
        }}
      />,
    );
    if (expected) expect(screen.getByText(expected)).toBeInTheDocument();
    else expect(container).toBeEmptyDOMElement();
  });
  it("routes all week items to the booking calendar without requiring extra DTO fields", () => {
    const row = fixture();
    const weekly: HomeWeekBooking = {
      id: row.id,
      start: row.start,
      end: row.end,
      date: row.date,
      timezone: row.timezone,
      branchId: row.branchId,
      floorId: row.floorId,
      spaceId: row.spaceId,
      spaceName: row.spaceName,
    };
    expect(Object.keys(weekly)).toHaveLength(9);
    const { container } = render(
      <HomeWeekBookings
        data={{
          now,
          today: "2026-10-07",
          timezone: "Asia/Seoul",
          openHours: null,
          days: [{ date: row.date, bookings: [weekly] }],
        }}
      />,
    );
    expect(
      screen.getByRole("link", { name: "09:00 전용 회의실" }),
    ).toHaveAttribute(
      "href",
      "/bookings?view=calendar&month=2026-10&day=2026-10-08",
    );
    expect(container.querySelector('a[href^="/branches/"]')).toBeNull();
  });
  it("centralizes the invited photo and navigation safety checks", () => {
    const row = fixture();
    expect(bookingPhoto(row)).toBeNull();
    expect(bookingSpaceHref(row)).toBeNull();
    expect(canLeaveBooking(row, now)).toBe(true);
    expect(canLeaveBooking({ ...row, relation: "owner" }, now)).toBe(false);
  });
});

describe("leave booking confirmation", () => {
  it("requires confirmation, sends only bookingId, refreshes and reports success", async () => {
    render(wrap(<LeaveBookingButton bookingId="invited" />));
    await userEvent.click(screen.getByRole("button", { name: "참석 안 함" }));
    expect(leaveBooking).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", {
      name: "이 예약에 참석하지 않을까요?",
    });
    expect(within(dialog).getByText("예약한 사람에게 알려요")).toBeVisible();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "참석 안 함" }),
    );
    await waitFor(() =>
      expect(leaveBooking).toHaveBeenCalledWith({ bookingId: "invited" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(runtime.refresh).toHaveBeenCalledOnce();
    expect(toast.success).toHaveBeenCalledWith("참석자에서 빠졌어요");
  });
  it("keeps data until success, fades only the active row and prevents repeated submission", async () => {
    let resolve!: (value: ActionResult<{ bookingId: string }>) => void;
    vi.mocked(leaveBooking).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(
      wrap(
        <ul>
          <li data-testid="first">
            <LeaveBookingButton bookingId="first" />
          </li>
          <li data-testid="second">
            <LeaveBookingButton bookingId="second" />
          </li>
        </ul>,
      ),
    );
    const first = screen.getByTestId("first");
    const second = screen.getByTestId("second");
    await userEvent.click(
      within(first).getByRole("button", { name: "참석 안 함" }),
    );
    const confirm = within(screen.getByRole("dialog")).getByRole("button", {
      name: "참석 안 함",
    });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(leaveBooking).toHaveBeenCalledTimes(1));
    expect(first.querySelector('[data-cancelling="true"]')).not.toBeNull();
    expect(second.querySelector('[data-cancelling="true"]')).toBeNull();
    expect(runtime.refresh).not.toHaveBeenCalled();
    expect(screen.getByTestId("first")).toBeInTheDocument();
    await act(async () => resolve({ ok: true, data: { bookingId: "first" } }));
    expect(runtime.refresh).toHaveBeenCalledOnce();
  });
  it("returns without a write and restores focus", async () => {
    render(wrap(<LeaveBookingButton bookingId="invited" />));
    const trigger = screen.getByRole("button", { name: "참석 안 함" });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("button", { name: "돌아가기" }));
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(leaveBooking).not.toHaveBeenCalled();
  });
  it("keeps the dialog with a safe error and does not refresh when the action fails", async () => {
    vi.mocked(leaveBooking).mockResolvedValue({ ok: false, code: "NOT_FOUND" });
    render(wrap(<LeaveBookingButton bookingId="invited" />));
    await userEvent.click(screen.getByRole("button", { name: "참석 안 함" }));
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "참석 안 함",
      }),
    );
    expect(
      await screen.findByText("찾을 수 없어요. 화면을 새로 고쳐 주세요"),
    ).toBeVisible();
    expect(runtime.refresh).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});

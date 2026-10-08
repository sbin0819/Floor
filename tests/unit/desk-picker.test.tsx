import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DeskPicker } from "@/features/bookings/components/desk-picker";
import { createDeskBooking } from "@/features/bookings/actions";
import {
  createBookingDraftStore,
  bookingDraftScope,
  type BookingDraftStore,
} from "@/features/bookings/booking-draft-store";
import type { ActionResult } from "@/lib/actions/result";
import type { DeskDayData } from "@/features/bookings/types";
import { spaceDayFixture } from "./booking-ui-fixtures";

const runtime = vi.hoisted(() => ({
  refresh: vi.fn(),
  store: null as BookingDraftStore | null,
}));
vi.mock("next/navigation", () => ({ useRouter: () => runtime }));
vi.mock("@/features/bookings/components/branch-workspace", () => ({
  useFloorSelection: () =>
    runtime.store ? { draftStore: runtime.store } : null,
}));
vi.mock("@/features/bookings/actions", () => ({
  createDeskBooking: vi.fn(),
  cancelBooking: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
beforeEach(() => {
  vi.clearAllMocks();
  runtime.store = null;
  vi.mocked(createDeskBooking).mockResolvedValue({
    ok: true,
    data: { bookingId: "created" },
  });
});
function fixture() {
  const data = spaceDayFixture();
  data.space = {
    ...data.space,
    type: "desk_area",
    name: "오픈 데스크 A",
    bookable: false,
    deskCount: 4,
    capacity: null,
  };
  const desk: DeskDayData = {
    parts: [
      {
        part: "am",
        start: "2026-10-07T00:00:00.000Z",
        end: "2026-10-07T04:00:00.000Z",
        selectable: true,
        freeCount: 2,
        myDeskName: null,
      },
      {
        part: "pm",
        start: "2026-10-07T04:00:00.000Z",
        end: "2026-10-07T05:00:00.000Z",
        selectable: true,
        freeCount: 3,
        myDeskName: null,
      },
      {
        part: "day",
        start: "2026-10-07T00:00:00.000Z",
        end: "2026-10-07T05:00:00.000Z",
        selectable: true,
        freeCount: 2,
        myDeskName: null,
      },
    ],
    seats: [
      {
        id: "seat-a",
        name: "A-01",
        row: 0,
        column: 0,
        states: { am: "free", pm: "free", day: "free" },
      },
      {
        id: "seat-b",
        name: "A-02",
        row: 0,
        column: 1,
        states: { am: "booked", pm: "free", day: "booked" },
      },
      {
        id: "seat-c",
        name: "A-03",
        row: 1,
        column: 0,
        states: { am: "blocked", pm: "blocked", day: "blocked" },
      },
      {
        id: "seat-d",
        name: "A-04",
        row: 1,
        column: 1,
        states: { am: "free", pm: "free", day: "free" },
      },
    ],
    myBookings: [],
  };
  data.desk = desk;
  return { data, desk };
}
function display(input = fixture()) {
  const client = new QueryClient();
  const frame = (value: ReturnType<typeof fixture>) => (
    <QueryClientProvider client={client}>
      <DeskPicker data={value.data} desk={value.desk} />
    </QueryClientProvider>
  );
  const view = render(frame(input));
  return {
    ...view,
    update: (value: ReturnType<typeof fixture>) => view.rerender(frame(value)),
  };
}
describe("DeskPicker", () => {
  it("defaults to full day, submits only seat/date/part/actor, keeps the picker and part after success", async () => {
    display();
    expect(screen.getByRole("radio", { name: /종일/ })).toBeChecked();
    expect(screen.getByText("10월 7일 수요일")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /종일/ })).toHaveAccessibleName(
      /빈 자리 2석/,
    );
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "A-01, 비어 있음" }),
    );
    const form = screen.getByRole("form", { name: "좌석 예약 양식" });
    await userEvent.click(screen.getByRole("button", { name: "예약하기" }));
    await waitFor(() =>
      expect(createDeskBooking).toHaveBeenCalledWith({
        deskId: "seat-a",
        date: "2026-10-07",
        part: "day",
        teamId: null,
      }),
    );
    await waitFor(() =>
      expect(screen.getByText("자리를 골라 주세요")).toBeInTheDocument(),
    );
    expect(screen.getByRole("form", { name: "좌석 예약 양식" })).toBe(form);
    expect(screen.getByRole("radio", { name: /종일/ })).toBeChecked();
    expect(runtime.refresh).toHaveBeenCalledTimes(1);
  });
  it("uses a saved row part and preserves only a free selection when switching parts", async () => {
    const input = fixture();
    const scope = bookingDraftScope(
      input.data.branch.id,
      input.data.floor.id,
      input.data.date,
      input.data.space.id,
    );
    runtime.store = createBookingDraftStore();
    runtime.store.getState().activate(scope);
    runtime.store.getState().changeDeskPart(scope, "pm");
    display(input);
    expect(screen.getByRole("radio", { name: /오후/ })).toBeChecked();
    await userEvent.click(
      screen.getByRole("button", { name: "A-02, 비어 있음" }),
    );
    await userEvent.click(screen.getByRole("radio", { name: /오전/ }));
    expect(runtime.store.getState().deskId).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "A-01, 비어 있음" }),
    );
    await userEvent.click(screen.getByRole("radio", { name: /오후/ }));
    expect(runtime.store.getState().deskId).toBe("seat-a");
  });
  it("defaults to afternoon after morning/full-day close and makes expired parts focusable but not selectable", async () => {
    const input = fixture();
    input.desk.parts[0]!.selectable = false;
    input.desk.parts[2]!.selectable = false;
    display(input);
    expect(screen.getByRole("radio", { name: /오후/ })).toBeChecked();
    const am = screen.getByRole("radio", { name: /오전/ });
    expect(am).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(am);
    expect(screen.getByRole("radio", { name: /오후/ })).toBeChecked();
  });
  it("does not let an unavailable day claim free seats", () => {
    const input = fixture();
    input.desk.parts.forEach((part) => {
      part.selectable = false;
    });
    display(input);
    expect(
      screen.getByText("오늘은 예약할 수 있는 시간이 지났어요"),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /비어 있음/ })).toHaveLength(
      0,
    );
    expect(screen.getByRole("button", { name: "예약하기" })).toBeDisabled();
  });
  it("blocks a second local overlapping seat and shows own booking cancellation without a submit", async () => {
    const input = fixture();
    input.desk.seats[0]!.states = { am: "mine", pm: "mine", day: "mine" };
    input.desk.myBookings.push({
      id: "own",
      deskId: "seat-a",
      deskName: "A-01",
      start: input.desk.parts[2]!.start,
      end: input.desk.parts[2]!.end,
      part: "day",
      canCancel: true,
    });
    display(input);
    await userEvent.click(
      screen.getByRole("button", { name: "A-04, 비어 있음" }),
    );
    expect(
      screen.getByText(/이 시간에 이미 A-01 자리를 예약했어요/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "예약하기" })).toBeDisabled();
    await userEvent.click(
      screen.getByRole("button", { name: "A-01, 내 자리" }),
    );
    expect(
      screen.queryByRole("button", { name: "예약하기" }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "예약 취소" }));
    expect(
      screen.getByRole("dialog", { name: "이 예약을 취소할까요?" }),
    ).toBeInTheDocument();
  });
  it("clears a conflicting seat and refreshes without closing or resetting the chosen part", async () => {
    vi.mocked(createDeskBooking).mockResolvedValue({
      ok: false,
      code: "BOOKING_CONFLICT",
    });
    display();
    await userEvent.click(screen.getByRole("radio", { name: /오후/ }));
    await userEvent.click(
      screen.getByRole("button", { name: "A-02, 비어 있음" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "예약하기" }));
    await waitFor(() =>
      expect(
        screen.getByText(
          "방금 다른 사람이 이 자리를 예약했어요. 다른 자리를 골라 주세요",
        ),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("radio", { name: /오후/ })).toBeChecked();
    expect(screen.getByText("자리를 골라 주세요")).toBeInTheDocument();
    expect(runtime.refresh).toHaveBeenCalledOnce();
  });
  it.each(["SPACE_BLOCKED", "LIMIT_EXCEEDED"] as const)(
    "preserves choice on %s and only refreshes stale availability",
    async (code) => {
      vi.mocked(createDeskBooking).mockResolvedValue({
        ok: false,
        code,
        ...(code === "LIMIT_EXCEEDED"
          ? { message: "desk_per_person" as const }
          : {}),
      });
      display();
      await userEvent.click(
        screen.getByRole("button", { name: "A-01, 비어 있음" }),
      );
      await userEvent.click(screen.getByRole("button", { name: "예약하기" }));
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent(
          code === "SPACE_BLOCKED"
            ? "점검 중인 시간이에요"
            : "이 시간에 이미 예약한 자리가 있어요",
        ),
      );
      expect(
        screen.getByRole("button", { name: "A-01, 비어 있음" }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(runtime.refresh).toHaveBeenCalledTimes(
        code === "SPACE_BLOCKED" ? 1 : 0,
      );
    },
  );
  it("ignores late success cleanup after another area becomes active", async () => {
    let finish!: (value: ActionResult<{ bookingId: string }>) => void;
    vi.mocked(createDeskBooking).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const input = fixture();
    const scope = bookingDraftScope(
      "branch",
      "floor",
      input.data.date,
      "space",
    );
    runtime.store = createBookingDraftStore();
    runtime.store.getState().activate(scope);
    const view = display(input);
    await userEvent.click(
      screen.getByRole("button", { name: "A-01, 비어 있음" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "예약하기" }));
    const other = fixture();
    other.data.space.id = "other";
    const next = bookingDraftScope("branch", "floor", input.data.date, "other");
    act(() => {
      runtime.store!.getState().activate(next);
      runtime.store!.getState().changeDeskPart(next, "pm");
      runtime.store!.getState().changeDesk(next, "seat-d");
    });
    view.update(other);
    await act(async () => {
      finish({ ok: true, data: { bookingId: "created" } });
    });
    expect(runtime.store.getState()).toMatchObject({
      scope: next,
      deskPart: "pm",
      deskId: "seat-d",
    });
  });

  it("preserves the same seat selected in another part while an earlier part request finishes", async () => {
    let finish!: (value: ActionResult<{ bookingId: string }>) => void;
    vi.mocked(createDeskBooking).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const input = fixture();
    const scope = bookingDraftScope(
      "branch",
      "floor",
      input.data.date,
      "space",
    );
    runtime.store = createBookingDraftStore();
    runtime.store.getState().activate(scope);
    display(input);
    await userEvent.click(
      screen.getByRole("button", { name: "A-01, 비어 있음" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "예약하기" }));
    act(() => {
      runtime.store!.getState().changeDeskPart(scope, "pm");
    });
    await act(async () => {
      finish({ ok: true, data: { bookingId: "created" } });
    });
    expect(runtime.store.getState()).toMatchObject({
      scope,
      deskPart: "pm",
      deskId: "seat-a",
    });
  });

  it("preserves the scope-owned part, actor and seat when display variants remount their content", async () => {
    const input = fixture();
    const scope = bookingDraftScope(
      "branch",
      "floor",
      input.data.date,
      "space",
    );
    runtime.store = createBookingDraftStore();
    runtime.store.getState().activate(scope);
    const first = display(input);
    await userEvent.click(screen.getByRole("radio", { name: /오후/ }));
    await userEvent.click(
      screen.getByRole("button", { name: "A-02, 비어 있음" }),
    );
    first.unmount();
    display(input);
    expect(screen.getByRole("radio", { name: /오후/ })).toBeChecked();
    expect(
      screen.getByRole("button", { name: "A-02, 비어 있음" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "예약하기" })).toBeEnabled();
  });
});

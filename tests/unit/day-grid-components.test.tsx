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
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BookingForm } from "@/features/bookings/components/booking-form";
import { createBooking, cancelBooking } from "@/features/bookings/actions";
import { spaceDayFixture } from "./booking-ui-fixtures";
import type { ActionResult } from "@/lib/actions/result";
import type { SpaceDayData } from "@/features/bookings/types";

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/features/bookings/actions", () => ({
  createBooking: vi.fn(),
  cancelBooking: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createBooking).mockResolvedValue({
    ok: true,
    data: { bookingId: "new" },
  });
  vi.mocked(cancelBooking).mockResolvedValue({
    ok: true,
    data: { bookingId: "booking" },
  });
});
function display(data = spaceDayFixture()) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <BookingForm data={data} />
    </QueryClientProvider>,
  );
}

describe("day grid and synchronized form", () => {
  it("has one Tab stop for free times, moves with arrows and selects with Enter/Space", async () => {
    display();
    const group = screen.getByRole("group", { name: "2026-10-07 빈 시간" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1);
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "10:00, 비어 있음",
      "10:30, 비어 있음",
      "12:00, 비어 있음",
      "12:30, 비어 있음",
      "13:30, 비어 있음",
    ]);
    await userEvent.tab();
    expect(
      screen.getByRole("button", { name: /지난 시간 보기/ }),
    ).toHaveFocus();
    await userEvent.tab();
    expect(buttons[0]).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(buttons[2]).toHaveFocus();
    expect(buttons.filter((button) => button.tabIndex === 0)).toEqual([
      buttons[2],
    ]);
    await userEvent.keyboard("{Enter}");
    expect(buttons[2]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("시작")).toHaveTextContent("12:00");
    await userEvent.keyboard("{ArrowUp} ");
    expect(buttons[1]).toHaveAttribute("aria-pressed", "true");
    expect(buttons[2]).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("시작")).toHaveTextContent("10:30");
    await userEvent.tab();
    expect(screen.getByLabelText("시작")).toHaveFocus();
  });

  it("renders each reservation and overlapping maintenance exactly once, with cancel outside the group", async () => {
    const data = spaceDayFixture();
    data.bookings[0] = {
      ...data.bookings[0]!,
      canCancel: true,
      title: "보이는 제목",
    };
    data.blocks[0] = {
      ...data.blocks[0]!,
      start: data.bookings[0].start,
      end: data.bookings[0].end,
    };
    const view = display(data);
    const booking = screen.getByRole("article", { name: "가상 팀 예약" });
    const maintenance = screen.getByRole("article", { name: "점검 중" });
    expect(
      view.container.querySelectorAll('[data-grid-block="booking"]'),
    ).toHaveLength(1);
    expect(
      view.container.querySelectorAll('[data-grid-block="maintenance"]'),
    ).toHaveLength(1);
    expect(booking.style.left).not.toBe(maintenance.style.left);
    expect(booking).toHaveTextContent("11:00–12:00");
    expect(booking).toHaveTextContent("보이는 제목");
    const cancel = within(booking).getByRole("button", { name: "취소" });
    expect(cancel.closest('[role="group"]')).toBeNull();
    await userEvent.click(cancel);
    expect(cancelBooking).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "이 예약을 취소할까요?" }),
    ).toBeVisible();
  });

  it("folds past slots, counts bookings once and exposes no past/reserved/maintenance buttons", async () => {
    const data = spaceDayFixture();
    data.bookings.push({
      ...data.bookings[0]!,
      id: "past",
      bookerName: "지난 회원",
      start: "2026-10-07T00:00:00Z",
      end: "2026-10-07T01:00:00Z",
    });
    display(data);
    const toggle = screen.getByRole("button", {
      name: "지난 시간 보기 · 09:00–10:00 (예약 1건)",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle.closest('[role="group"]')).toBeNull();
    expect(
      screen.queryByRole("article", { name: "지난 회원 예약" }),
    ).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("article", { name: "지난 회원 예약" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /^09:|^11:|^13:00/ }),
    ).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(
      screen.queryByRole("article", { name: "지난 회원 예약" }),
    ).not.toBeInTheDocument();
  });

  it("synchronizes both selects and grid, announces a summary and expands an optional title", async () => {
    const view = display();
    expect(screen.getByText("시간을 골라 주세요")).toHaveAttribute(
      "aria-live",
      "polite",
    );
    expect(
      screen.queryByRole("textbox", { name: "제목 (선택)" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "10:00, 비어 있음" }),
    );
    expect(
      screen
        .getByText("10월 7일 수 · 10:00–11:00")
        .closest('[aria-live="polite"]'),
    ).toHaveTextContent("1시간");
    expect(screen.getByText("새 예약")).toHaveTextContent("10:00–11:00");
    await userEvent.click(screen.getByLabelText("끝"));
    await userEvent.click(screen.getByRole("option", { name: "10:30" }));
    expect(
      screen.getByRole("button", { name: "10:30, 비어 있음" }),
    ).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(screen.getByLabelText("시작"));
    await userEvent.click(screen.getByRole("option", { name: "12:30" }));
    expect(screen.getByLabelText("끝")).toHaveTextContent("13:00");
    expect(
      screen.getByRole("button", { name: "12:30, 비어 있음" }),
    ).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "제목 추가" }));
    expect(screen.getByRole("textbox", { name: "제목 (선택)" })).toBeVisible();
    const form = screen.getByRole("form", { name: "예약 양식" });
    expect(form).toHaveClass("shrink-0");
    expect(
      form.contains(view.container.querySelector("[data-booking-scroll]")),
    ).toBe(false);
    expect(view.container.querySelector("[data-booking-scroll]")).toHaveClass(
      "overflow-y-auto",
    );
  });

  it("extends beyond booking/day limits, shows guidance and leaves final validation to the action", async () => {
    const data = spaceDayFixture();
    data.bookings = [];
    data.blocks = [];
    display(data);
    await userEvent.click(
      screen.getByRole("button", { name: "10:00, 비어 있음" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "13:30, 비어 있음" }),
    );
    expect(screen.getByLabelText("끝")).toHaveTextContent("14:00");
    expect(screen.getByText(/선택한 시간이 예약 한도를 넘어요/)).toBeVisible();
    expect(screen.getByRole("button", { name: "예약하기" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "예약하기" }));
    await waitFor(() =>
      expect(createBooking).toHaveBeenCalledWith(
        expect.objectContaining({
          start: "2026-10-07T01:00:00.000Z",
          end: "2026-10-07T05:00:00.000Z",
        }),
      ),
    );
  });

  it("retains no-submit rules for nonbookable, closed and unauthorized spaces", () => {
    const data = spaceDayFixture();
    const variants: SpaceDayData[] = [
      { ...data, space: { ...data.space, bookable: false, deskCount: 4 } },
      { ...data, openHours: null },
      { ...data, actors: [] },
    ];
    for (const variant of variants) {
      const view = display(variant);
      const submit = screen.queryByRole("button", { name: "예약하기" });
      if (variant.space.bookable) expect(submit).toBeDisabled();
      else {
        expect(submit).toBeNull();
        expect(screen.getByText(/좌석 4석/)).toBeVisible();
      }
      for (const button of within(screen.getByRole("group")).queryAllByRole(
        "button",
      ))
        expect(button).toBeDisabled();
      view.unmount();
    }
    expect(createBooking).not.toHaveBeenCalled();
  });

  it("preserves pending cancellation feedback and never submits cancellation twice", async () => {
    let finish!: (result: ActionResult<{ bookingId: string }>) => void;
    vi.mocked(cancelBooking).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const data = spaceDayFixture();
    data.bookings[0] = { ...data.bookings[0]!, canCancel: true };
    display(data);
    const trigger = screen.getByRole("button", { name: "취소" });
    await userEvent.click(trigger);
    const confirm = screen.getByRole("button", { name: "예약 취소" });
    act(() => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    await waitFor(() => expect(cancelBooking).toHaveBeenCalledTimes(1));
    expect(trigger).toHaveAttribute("data-cancelling", "true");
    expect(
      screen.getByRole("button", { name: "취소하고 있어요" }),
    ).toBeDisabled();
    await act(async () => finish({ ok: true, data: { bookingId: "booking" } }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
});

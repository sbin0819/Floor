import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BookingForm } from "@/features/bookings/components/booking-form";
import { createBooking } from "@/features/bookings/actions";
import { spaceDayFixture } from "./booking-ui-fixtures";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
}));
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
    data: { bookingId: "created" },
  });
});

async function display(capacity: number | null = 6) {
  const data = spaceDayFixture();
  data.space.capacity = capacity;
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <BookingForm data={data} />
    </QueryClientProvider>,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "10:00, 비어 있음" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "예약 내용 바꾸기" }),
  );
  return view;
}

describe("attendee count in the booking form", () => {
  it("submits a chosen count, includes it in the summary, and clears it after success", async () => {
    await display();
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "사용 인원 (선택)" }),
      { target: { value: "5" } },
    );
    expect(screen.getByRole("form", { name: "예약 양식" })).toHaveTextContent(
      "1시간 · 5명",
    );
    await userEvent.click(screen.getByRole("button", { name: "예약하기" }));
    await waitFor(() =>
      expect(createBooking).toHaveBeenCalledExactlyOnceWith({
        spaceId: "space",
        start: "2026-10-07T01:00:00.000Z",
        end: "2026-10-07T02:00:00.000Z",
        teamId: null,
        title: "",
        attendeeCount: 5,
      }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "10:00, 비어 있음" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "예약 내용 바꾸기" }),
    );
    expect(screen.getByRole("spinbutton")).toHaveValue(null);
  });

  it("blocks an oversized direct input including a manually dispatched submit", async () => {
    const view = await display();
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "7" },
    });
    expect(screen.getByText("정원은 6명이에요")).toBeVisible();
    expect(screen.getByRole("button", { name: "예약하기" })).toBeDisabled();
    fireEvent.submit(view.container.querySelector("form")!);
    expect(createBooking).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "6" },
    });
    expect(screen.getByRole("button", { name: "예약하기" })).toBeEnabled();
  });

  it("omits the count control for capacity-one spaces and submits no count", async () => {
    await display(1);
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "예약하기" }));
    await waitFor(() =>
      expect(createBooking).toHaveBeenCalledWith(
        expect.objectContaining({ attendeeCount: null }),
      ),
    );
  });

  it("opens the details and focuses the count for a server capacity error", async () => {
    vi.mocked(createBooking).mockResolvedValue({
      ok: false,
      code: "OVER_CAPACITY",
      message: "attendee_count",
    });
    await display();
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "5" },
    });
    await userEvent.click(
      screen.getByRole("button", { name: "예약 내용 바꾸기" }),
    );
    expect(
      screen.getByRole("button", { name: "예약 내용 바꾸기" }),
    ).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(screen.getByRole("button", { name: "예약하기" }));
    await waitFor(() => expect(screen.getByRole("spinbutton")).toHaveFocus());
    expect(
      screen.getByRole("button", { name: "예약 내용 바꾸기" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("spinbutton")).toHaveAccessibleDescription(
      "정원 6명 정원은 6명이에요",
    );
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

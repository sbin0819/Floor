import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BookingForm } from "@/features/bookings/components/booking-form";
import { createBooking } from "@/features/bookings/actions";
import { fetchParticipants } from "@/features/bookings/participant-search-client";
import {
  bookingDraftScope,
  createBookingDraftStore,
  type BookingDraftStore,
} from "@/features/bookings/booking-draft-store";
import type { ActionResult } from "@/lib/actions/result";
import { spaceDayFixture } from "./booking-ui-fixtures";

const runtime = vi.hoisted(() => ({
  refresh: vi.fn(),
  store: null as BookingDraftStore | null,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => runtime,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/features/bookings/components/branch-workspace", () => ({
  useFloorSelection: () =>
    runtime.store ? { draftStore: runtime.store } : null,
}));
vi.mock("@/features/bookings/actions", () => ({
  createBooking: vi.fn(),
  cancelBooking: vi.fn(),
}));
vi.mock(
  "@/features/bookings/participant-search-client",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/features/bookings/participant-search-client")
    >()),
    fetchParticipants: vi.fn(),
  }),
);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const colleague = {
  userId: "first",
  name: "이서연",
  avatar: { color: "blue" as const, photoUrl: null },
  sharedTeamNames: ["디자인팀"],
  maskedEmail: "se•••@floor.example",
};
const guest = {
  userId: "second",
  name: "김하은",
  avatar: { color: "blue" as const, photoUrl: null },
  sharedTeamNames: [],
  maskedEmail: "ha•••@floor.example",
};
const range = {
  start: "2026-10-07T01:00:00.000Z",
  end: "2026-10-07T02:00:00.000Z",
};
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});
beforeEach(() => {
  vi.clearAllMocks();
  runtime.store = createBookingDraftStore();
  vi.mocked(createBooking).mockResolvedValue({
    ok: true,
    data: { bookingId: "created" },
  });
  vi.mocked(fetchParticipants).mockResolvedValue([colleague]);
});
function display(capacity = 6, variant: "panel" | "strip" = "panel") {
  const data = spaceDayFixture();
  data.space.capacity = capacity;
  const scope = bookingDraftScope(
    data.branch.id,
    data.floor.id,
    data.date,
    data.space.id,
  );
  runtime.store!.getState().activate(scope);
  runtime.store!.getState().changeRange(scope, data.space.id, range);
  const client = new QueryClient();
  const frame = (layout: "panel" | "strip", current = data) => (
    <QueryClientProvider client={client}>
      <BookingForm key={layout} data={current} variant={layout} />
    </QueryClientProvider>
  );
  const view = render(frame(variant));
  return {
    ...view,
    scope,
    data,
    receive: (layout: "panel" | "strip", current = data) =>
      view.rerender(frame(layout, current)),
  };
}
async function expand() {
  await userEvent.click(
    screen.getByRole("button", { name: "예약 내용 바꾸기" }),
  );
}
async function addPerson(query: string, person = colleague) {
  vi.mocked(fetchParticipants).mockResolvedValue([person]);
  await userEvent.type(
    screen.getByRole("combobox", { name: "참석자 (선택)" }),
    query,
  );
  await userEvent.click(
    await screen.findByRole("option", { name: new RegExp(person.name) }),
  );
}
describe("participants in booking forms", () => {
  it("increases a specified attendee count, respects the new minimum and submits only identity/proof", async () => {
    display();
    await expand();
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "2" },
    });
    await addPerson("이서");
    await addPerson("haneul@floor.example", guest);
    expect(screen.getByRole("spinbutton")).toHaveValue(3);
    expect(runtime.store!.getState().draft.attendeeCountTouched).toBe(true);
    expect(screen.getByText("나 포함 3명")).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "예약 양식" })).toHaveTextContent(
      "· 참석자 2명",
    );
    await userEvent.click(screen.getByRole("button", { name: "한 명 줄이기" }));
    expect(screen.getByRole("spinbutton")).toHaveValue(null);
    await userEvent.click(screen.getByRole("button", { name: "한 명 늘리기" }));
    expect(screen.getByRole("spinbutton")).toHaveValue(3);
    await userEvent.click(screen.getByRole("button", { name: "예약하기" }));
    await waitFor(() =>
      expect(createBooking).toHaveBeenCalledWith(
        expect.objectContaining({
          attendeeCount: 3,
          participants: [
            { userId: "first" },
            { userId: "second", email: "haneul@floor.example" },
          ],
        }),
      ),
    );
    await waitFor(() =>
      expect(runtime.store!.getState().draft.participants).toEqual([]),
    );
    expect(runtime.store!.getState().draft.attendeeCount).toBeNull();
    expect(runtime.refresh).toHaveBeenCalledOnce();
  });
  it("leaves an unspecified count unspecified and blocks a manually smaller count", async () => {
    display();
    await expand();
    await addPerson("이서");
    expect(screen.getByRole("spinbutton")).toHaveValue(null);
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "1" },
    });
    expect(
      screen.getByText("참석자 수보다 적을 수 없어요"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "예약하기" })).toBeDisabled();
  });
  it("focuses the same reusable input in the strip popover and preserves draft across display changes", async () => {
    const view = display(6, "strip");
    await userEvent.click(
      screen.getByRole("button", { name: "참석자 없음, 고치기" }),
    );
    expect(
      screen.getByRole("combobox", { name: "참석자 (선택)" }),
    ).toHaveFocus();
    await addPerson("이서");
    await userEvent.keyboard("{Escape}");
    expect(
      screen.getByRole("button", { name: "참석자 1명, 고치기" }),
    ).toBeInTheDocument();
    view.receive("panel");
    await expand();
    expect(
      screen.getByRole("button", { name: "이서연 빼기" }),
    ).toBeInTheDocument();
    view.receive("strip");
    await userEvent.click(
      screen.getByRole("button", { name: "참석자 1명, 고치기" }),
    );
    expect(
      screen.getByRole("button", { name: "이서연 빼기" }),
    ).toBeInTheDocument();
  });
  it("hides attendee/participant inputs at capacity one", async () => {
    display(1);
    await expand();
    expect(
      screen.queryByRole("combobox", { name: "참석자 (선택)" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });
  it.each(["panel", "strip"] as const)(
    "opens %s participant errors and keeps the entered draft",
    async (variant) => {
      vi.mocked(createBooking).mockResolvedValue({
        ok: false,
        code: "INVALID_INPUT",
        fieldErrors: {
          participants: [
            "초대할 수 없는 사람이 있어요. 다시 찾아서 넣어 주세요",
          ],
        },
      });
      display(6, variant);
      if (variant === "panel") await expand();
      else
        await userEvent.click(
          screen.getByRole("button", { name: "참석자 없음, 고치기" }),
        );
      await addPerson("이서");
      if (variant === "panel") await expand();
      else await userEvent.keyboard("{Escape}");
      await userEvent.click(screen.getByRole("button", { name: "예약하기" }));
      const input = await screen.findByRole("combobox", {
        name: "참석자 (선택)",
      });
      await waitFor(() => expect(input).toHaveFocus());
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(
        screen.getByText(
          "초대할 수 없는 사람이 있어요. 다시 찾아서 넣어 주세요",
        ),
      ).toBeInTheDocument();
      expect(runtime.store!.getState().draft.participants).toEqual([colleague]);
    },
  );
  it("protects a new scope's participants from a late successful response", async () => {
    let finish!: (value: ActionResult<{ bookingId: string }>) => void;
    vi.mocked(createBooking).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const view = display();
    await expand();
    await addPerson("이서");
    await userEvent.click(screen.getByRole("button", { name: "예약하기" }));
    const next = bookingDraftScope("branch", "floor", view.data.date, "other");
    act(() => {
      runtime.store!.getState().activate(next);
      runtime.store!.getState().changeDraft(next, {
        participants: [{ ...guest, email: "haneul@floor.example" }],
      });
    });
    await act(async () => {
      finish({ ok: true, data: { bookingId: "created" } });
    });
    expect(runtime.store!.getState().draft.participants).toEqual([
      { ...guest, email: "haneul@floor.example" },
    ]);
  });
});

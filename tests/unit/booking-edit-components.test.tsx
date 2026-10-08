import { Activity } from "react";
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
import { toast } from "sonner";
import { updateBooking } from "@/features/bookings/actions";
import { BookingEditScreen } from "@/features/bookings/components/booking-edit-screen";
import { fetchParticipants } from "@/features/bookings/participant-search-client";
import type { BookingForEditData } from "@/features/bookings/types";
import type { ActionResult } from "@/lib/actions/result";
import { bookingEditFixture } from "./booking-edit-fixtures";

const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/features/bookings/actions", () => ({
  updateBooking: vi.fn(),
  cancelBooking: vi.fn(),
}));
vi.mock("@/features/bookings/participant-search-client", async (original) => ({
  ...(await original<
    typeof import("@/features/bookings/participant-search-client")
  >()),
  fetchParticipants: vi.fn(),
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
  vi.mocked(updateBooking).mockResolvedValue({
    ok: true,
    data: { bookingId: "edit-booking" },
  });
  vi.mocked(fetchParticipants).mockResolvedValue([]);
});
function display(data = bookingEditFixture()) {
  const client = new QueryClient();
  const frame = (current: BookingForEditData, visible = true) => (
    <QueryClientProvider client={client}>
      <Activity mode={visible ? "visible" : "hidden"}>
        <BookingEditScreen data={current} />
      </Activity>
    </QueryClientProvider>
  );
  const view = render(frame(data));
  return {
    ...view,
    receive: (current: BookingForEditData, visible = true) =>
      view.rerender(frame(current, visible)),
  };
}
const save = () => screen.getByRole("button", { name: "바꾼 내용 저장" });
const title = () => screen.getByLabelText("제목 (선택)");
function changeTitle(value = "바뀐 제목") {
  fireEvent.change(title(), { target: { value } });
}
async function selectTime(label: string, value: string) {
  await userEvent.click(screen.getByRole("combobox", { name: label }));
  await userEvent.click(screen.getByRole("option", { name: value }));
}

describe("booking edit local form", () => {
  it("shows original values without Workspace and enables only actual changes", () => {
    display();
    expect(screen.getByRole("combobox", { name: "시작" })).toHaveTextContent(
      "10:00",
    );
    expect(screen.getByRole("combobox", { name: "끝" })).toHaveTextContent(
      "11:00",
    );
    expect(title()).toHaveValue("디자인 회의");
    expect(screen.getByRole("spinbutton")).toHaveValue(3);
    expect(screen.getByRole("button", { name: "이서연 빼기" })).toBeEnabled();
    expect(
      screen.getByRole("complementary", { name: "바꾸는 예약 정보" }),
    ).toHaveTextContent("10:00–11:00 · 3명 · 참석자 1명");
    expect(save()).toBeDisabled();
    changeTitle();
    expect(save()).toBeEnabled();
    changeTitle("디자인 회의");
    expect(save()).toBeDisabled();
    expect(screen.getByRole("link", { name: "돌아가기" })).toHaveAttribute(
      "href",
      "/bookings",
    );
  });
  it("synchronizes timeline selection and time fields with change notes", async () => {
    display();
    await selectTime("시작", "10:30");
    expect(screen.getByText("10:00 → 10:30")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "끝" })).toHaveTextContent(
      "11:30",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "12:00, 비어 있음" }),
    );
    expect(screen.getByRole("combobox", { name: "끝" })).toHaveTextContent(
      "12:30",
    );
    expect(
      screen.getByText("바꾼 시간", {
        exact: false,
        selector: "[data-booking-selection]",
      }),
    ).toHaveTextContent("10:30–12:30");
    await userEvent.click(save());
    await waitFor(() =>
      expect(updateBooking).toHaveBeenCalledWith(
        expect.objectContaining({
          start: "2026-10-07T01:30:00.000Z",
          end: "2026-10-07T03:30:00.000Z",
        }),
      ),
    );
  });
  it("locks only time after start, and preserves metadata-only changes", async () => {
    const data = bookingEditFixture();
    data.booking.started = true;
    display(data);
    expect(
      screen.getByText("진행 중인 예약은 시간을 바꿀 수 없어요"),
    ).toBeVisible();
    expect(screen.getByRole("combobox", { name: "시작" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "끝" })).toBeDisabled();
    for (const button of within(
      screen.getByRole("group", { name: /빈 시간/ }),
    ).getAllByRole("button"))
      expect(button).toBeDisabled();
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "4" },
    });
    expect(save()).toBeEnabled();
    await userEvent.click(save());
    await waitFor(() =>
      expect(updateBooking).toHaveBeenCalledWith(
        expect.objectContaining({
          start: data.booking.start,
          end: data.booking.end,
          attendeeCount: 4,
        }),
      ),
    );
  });
  it("retains original out-of-hours options and allows metadata changes on a now-closed day", async () => {
    const data = bookingEditFixture();
    data.branch.openHours = { wed: null };
    data.openHours = null;
    data.booking.start = "2026-10-07T14:00:00.000Z";
    data.booking.end = "2026-10-07T15:00:00.000Z";
    display(data);
    expect(screen.getByRole("combobox", { name: "시작" })).toHaveTextContent(
      "23:00",
    );
    expect(screen.getByRole("combobox", { name: "끝" })).toHaveTextContent(
      "24:00",
    );
    expect(screen.getByText(/이 날은 운영하지 않아요/)).toBeVisible();
    changeTitle();
    await userEvent.click(save());
    await waitFor(() =>
      expect(updateBooking).toHaveBeenCalledWith(
        expect.objectContaining({
          start: data.booking.start,
          end: data.booking.end,
        }),
      ),
    );
  });
  it("shows and corrects an excessive count before allowing any save", () => {
    const data = bookingEditFixture();
    data.space.capacity = 2;
    display(data);
    expect(screen.getByText("정원은 2명이에요")).toBeVisible();
    changeTitle();
    expect(save()).toBeDisabled();
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "2" },
    });
    expect(save()).toBeEnabled();
  });
  it("keeps corrective participant/count fields at capacity one until manually fixed", async () => {
    const data = bookingEditFixture();
    data.space.capacity = 1;
    display(data);
    expect(screen.getByText("참석자가 정원(1명)보다 많아요")).toBeVisible();
    expect(screen.getByText("정원은 1명이에요")).toBeVisible();
    expect(save()).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "이서연 빼기" }));
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "1" },
    });
    expect(save()).toBeEnabled();
    expect(screen.getByRole("spinbutton")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "참석자 (선택)" }),
    ).toBeDisabled();
  });
  it("does not invent people inputs for a valid capacity-one booking", () => {
    const data = bookingEditFixture();
    data.space.capacity = 1;
    data.booking.attendeeCount = 1;
    data.participants = [];
    display(data);
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "참석자 (선택)" }),
    ).not.toBeInTheDocument();
    changeTitle();
    expect(save()).toBeEnabled();
  });
  it("requires manual removal of existing sixth external participant", async () => {
    const data = bookingEditFixture();
    data.space.capacity = 10;
    data.booking.attendeeCount = null;
    data.participants = Array.from({ length: 6 }, (_, index) => ({
      ...data.participants[0]!,
      userId: `guest${index}`,
      name: `손님${index}`,
      avatar: { color: "blue" as const, photoUrl: null },
    }));
    display(data);
    expect(screen.getByText("손님은 5명까지예요")).toBeVisible();
    changeTitle();
    expect(save()).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "손님5 빼기" }));
    expect(save()).toBeEnabled();
  });
  it("submits the full roster but email proof only for a newly added external person", async () => {
    display();
    const input = screen.getByRole("combobox", { name: "참석자 (선택)" });
    vi.mocked(fetchParticipants).mockResolvedValue([
      {
        userId: "colleague",
        name: "김하은",
        avatar: { color: "blue" as const, photoUrl: null },
        sharedTeamNames: ["가상 팀"],
        maskedEmail: "ha•••@floor.example",
      },
    ]);
    await userEvent.type(input, "김하");
    await userEvent.click(
      await screen.findByRole("option", { name: /김하은/ }),
    );
    vi.mocked(fetchParticipants).mockResolvedValue([
      {
        userId: "guest",
        name: "박지훈",
        avatar: { color: "blue" as const, photoUrl: null },
        sharedTeamNames: [],
        maskedEmail: "ji•••@floor.example",
      },
    ]);
    await userEvent.type(input, "jihun@floor.example");
    await userEvent.click(
      await screen.findByRole("option", { name: /박지훈/ }),
    );
    expect(screen.getByRole("spinbutton")).toHaveValue(4);
    await userEvent.click(save());
    await waitFor(() =>
      expect(updateBooking).toHaveBeenCalledWith({
        bookingId: "edit-booking",
        start: "2026-10-07T01:00:00.000Z",
        end: "2026-10-07T02:00:00.000Z",
        attendeeCount: 4,
        title: "디자인 회의",
        participantIdsAtLoad: ["existing"],
        participants: [
          { userId: "existing" },
          { userId: "colleague" },
          { userId: "guest", email: "jihun@floor.example" },
        ],
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("예약을 바꿨어요");
    expect(navigation.push).toHaveBeenCalledWith("/bookings");
  });
  it("refreshes existing participant team metadata without replacing draft identities or load baseline", async () => {
    const data = bookingEditFixture();
    data.space.capacity = 10;
    data.booking.attendeeCount = null;
    data.participants = Array.from({ length: 6 }, (_, index) => ({
      ...data.participants[0]!,
      userId: `guest${index}`,
      name: `손님${index}`,
      avatar: { color: "blue" as const, photoUrl: null },
    }));
    const view = display(data);
    changeTitle();
    expect(save()).toBeDisabled();
    view.receive({
      ...data,
      participants: data.participants.map((person, index) => ({
        ...person,
        sharedTeamNames: index === 0 ? ["새 팀"] : [],
      })),
    });
    expect(screen.queryByText("손님은 5명까지예요")).not.toBeInTheDocument();
    expect(title()).toHaveValue("바뀐 제목");
    expect(save()).toBeEnabled();
    await userEvent.click(save());
    await waitFor(() =>
      expect(updateBooking).toHaveBeenCalledWith(
        expect.objectContaining({
          participantIdsAtLoad: data.participants.map(({ userId }) => userId),
          participants: data.participants.map(({ userId }) => ({ userId })),
        }),
      ),
    );
  });
  it.each(["BOOKING_CONFLICT", "SPACE_BLOCKED"] as const)(
    "preserves draft and the load-time baseline through %s refresh",
    async (code) => {
      vi.mocked(updateBooking).mockResolvedValue({ ok: false, code });
      const data = bookingEditFixture();
      const view = display(data);
      changeTitle();
      await userEvent.click(save());
      await waitFor(() => expect(navigation.refresh).toHaveBeenCalledOnce());
      const latest = {
        ...data,
        participants: [],
        space: { ...data.space, capacity: 2 },
      };
      view.receive(latest);
      expect(title()).toHaveValue("바뀐 제목");
      expect(screen.getByRole("button", { name: "이서연 빼기" })).toBeVisible();
      expect(screen.getByText("정원은 2명이에요")).toBeVisible();
      fireEvent.change(screen.getByRole("spinbutton"), {
        target: { value: "2" },
      });
      await userEvent.click(save());
      await waitFor(() =>
        expect(updateBooking).toHaveBeenLastCalledWith(
          expect.objectContaining({
            participants: [{ userId: "existing" }],
            participantIdsAtLoad: ["existing"],
            title: "바뀐 제목",
            attendeeCount: 2,
          }),
        ),
      );
    },
  );
  it.each(["attendee_count", "participants"] as const)(
    "attaches %s capacity error to the matching input",
    async (message) => {
      vi.mocked(updateBooking).mockResolvedValue({
        ok: false,
        code: "OVER_CAPACITY",
        message,
      });
      display();
      changeTitle();
      await userEvent.click(save());
      const input =
        message === "participants"
          ? screen.getByRole("combobox", { name: "참석자 (선택)" })
          : screen.getByRole("spinbutton");
      await waitFor(() =>
        expect(input).toHaveAttribute("aria-invalid", "true"),
      );
      expect(input).toHaveFocus();
      expect(title()).toHaveValue("바뀐 제목");
    },
  );
  it("reports NOT_FOUND with a return link and does not resubmit", async () => {
    vi.mocked(updateBooking).mockResolvedValue({
      ok: false,
      code: "NOT_FOUND",
    });
    display();
    changeTitle();
    await userEvent.click(save());
    expect(
      await screen.findByText("이 예약은 더 바꿀 수 없어요"),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "내 예약으로" })).toHaveAttribute(
      "href",
      "/bookings",
    );
    expect(save()).toBeDisabled();
  });
  it("preserves fields on server validation and never displays raw errors", async () => {
    vi.mocked(updateBooking).mockResolvedValue({
      ok: false,
      code: "INVALID_INPUT",
      fieldErrors: {
        title: ["제목은 60자 이내로 적어 주세요"],
        start: ["시간을 다시 골라 주세요"],
      },
    });
    display();
    changeTitle();
    await userEvent.click(save());
    await waitFor(() =>
      expect(title()).toHaveAttribute("aria-invalid", "true"),
    );
    expect(
      screen.getByRole("combobox", { name: "시작" }),
    ).toHaveAccessibleDescription(/시간을 다시 골라 주세요/);
    expect(title()).toHaveValue("바뀐 제목");
  });
  it("serializes duplicate submits and ignores navigation after Activity hides the edit screen", async () => {
    let finish!: (result: ActionResult<{ bookingId: string }>) => void;
    vi.mocked(updateBooking).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const data = bookingEditFixture();
    const view = display(data);
    changeTitle();
    act(() => {
      fireEvent.submit(screen.getByRole("form"));
      fireEvent.submit(screen.getByRole("form"));
    });
    await waitFor(() => expect(updateBooking).toHaveBeenCalledOnce());
    expect(
      screen.getByRole("button", { name: "저장하고 있어요" }),
    ).toBeDisabled();
    view.receive(data, false);
    await act(async () =>
      finish({ ok: true, data: { bookingId: "edit-booking" } }),
    );
    expect(navigation.push).not.toHaveBeenCalled();
    view.receive(data);
    expect(title()).toHaveValue("바뀐 제목");
  });
  it("starts a fresh local draft and baseline when booking identity changes", async () => {
    const view = display();
    changeTitle();
    const next = bookingEditFixture();
    next.booking.id = "other";
    next.booking.title = "다른 예약";
    next.participants = [];
    view.receive(next);
    expect(title()).toHaveValue("다른 예약");
    expect(save()).toBeDisabled();
    changeTitle();
    await userEvent.click(save());
    await waitFor(() =>
      expect(updateBooking).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId: "other",
          participantIdsAtLoad: [],
          participants: [],
        }),
      ),
    );
  });
});

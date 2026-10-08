import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BookingForm } from "@/features/bookings/components/booking-form";
import { BranchList } from "@/features/bookings/components/branch-list";
import { FloorDay } from "@/features/bookings/components/floor-day";
import { MemberNav } from "@/components/member-nav";
import {
  createBooking,
  cancelBooking,
  setDefaultBranch,
} from "@/features/bookings/actions";
import type { ActionResult } from "@/lib/actions/result";
import { floorDayFixture, spaceDayFixture } from "./booking-ui-fixtures";
import { getOperatingState } from "@/features/bookings/operating-state";

const navigation = vi.hoisted(() => ({
  refresh: vi.fn(),
  push: vi.fn(),
  pathname: "/branches/branch/floors/floor",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/features/bookings/actions", () => ({
  createBooking: vi.fn(),
  cancelBooking: vi.fn(),
  setDefaultBranch: vi.fn(),
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
    data: { bookingId: "new-booking" },
  });
  vi.mocked(cancelBooking).mockResolvedValue({
    ok: true,
    data: { bookingId: "booking" },
  });
  vi.mocked(setDefaultBranch).mockResolvedValue({
    ok: true,
    data: { branchId: "branch" },
  });
});
function display(children: ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      {children}
    </QueryClientProvider>,
  );
}

describe("booking form", () => {
  it("requires a time selection, hides an actor selector for users without teams and connects labels", async () => {
    display(<BookingForm data={spaceDayFixture()} />);
    expect(
      screen.queryByRole("button", { name: "예약하기" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "예약 방식" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "시작" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "끝" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "제목 (선택)" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "10:00, 비어 있음" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "예약 내용 바꾸기" }),
    );
    expect(screen.getByLabelText("시작")).toHaveAttribute("role", "combobox");
    expect(screen.getByLabelText("끝")).toBeEnabled();
    expect(screen.getByLabelText("제목 (선택)")).toHaveAttribute(
      "maxLength",
      "60",
    );
    expect(
      screen.queryByRole("button", { name: "11:00, 예약 중" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "13:00, 점검 중" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("article", { name: "가상 팀 예약" }),
    ).toHaveTextContent("11:00–12:00");
    expect(screen.getByRole("article", { name: "점검 중" })).toHaveTextContent(
      "13:00–13:30",
    );
  });

  it("omits unavailable times from the actual start select", async () => {
    display(<BookingForm data={spaceDayFixture()} />);
    await userEvent.click(
      screen.getByRole("button", { name: "10:00, 비어 있음" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "예약 내용 바꾸기" }),
    );
    await userEvent.click(screen.getByRole("combobox", { name: "시작" }));
    expect(screen.getByRole("option", { name: "10:00" })).toBeVisible();
    expect(
      screen.queryByRole("option", { name: "09:30" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "11:00" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "13:00" }),
    ).not.toBeInTheDocument();
  });

  it("offers only allowed teams in restricted spaces", async () => {
    const data = spaceDayFixture();
    data.hasTeams = true;
    data.actors = [{ ...data.actors[0]!, teamId: "team", name: "가상 팀으로" }];
    display(<BookingForm data={data} />);
    await userEvent.click(
      screen.getByRole("button", { name: "10:00, 비어 있음" }),
    );
    await userEvent.click(screen.getByRole("combobox", { name: "예약 방식" }));
    expect(screen.getByRole("option", { name: "가상 팀으로" })).toBeVisible();
    expect(
      screen.queryByRole("option", { name: "개인으로" }),
    ).not.toBeInTheDocument();
  });

  it("submits the selected contiguous hour once, disables pending writes and clears selection after success", async () => {
    let finish!: (result: ActionResult<{ bookingId: string }>) => void;
    vi.mocked(createBooking).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = display(<BookingForm data={spaceDayFixture()} />);
    await userEvent.click(
      screen.getByRole("button", { name: "10:00, 비어 있음" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "예약 내용 바꾸기" }),
    );
    expect(screen.getByRole("combobox", { name: "시작" })).toHaveTextContent(
      "10:00",
    );
    expect(screen.getByRole("combobox", { name: "끝" })).toHaveTextContent(
      "11:00",
    );
    await userEvent.type(screen.getByLabelText("제목 (선택)"), "테스트 회의");
    const form = view.container.querySelector("form")!;
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await waitFor(() => expect(createBooking).toHaveBeenCalledTimes(1));
    expect(createBooking).toHaveBeenCalledWith({
      spaceId: "space",
      start: "2026-10-07T01:00:00.000Z",
      end: "2026-10-07T02:00:00.000Z",
      teamId: null,
      title: "테스트 회의",
      attendeeCount: null,
    });
    expect(
      screen.getByRole("button", { name: "예약하고 있어요" }),
    ).toBeDisabled();
    await act(async () =>
      finish({ ok: true, data: { bookingId: "new-booking" } }),
    );
    await waitFor(() => expect(navigation.refresh).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole("button", { name: "예약하기" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "제목 (선택)" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "10:00, 비어 있음" }),
    );
    expect(
      screen.getByRole("button", { name: "예약 내용 바꾸기" }),
    ).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(
      screen.getByRole("button", { name: "예약 내용 바꾸기" }),
    );
    expect(screen.getByLabelText("제목 (선택)")).toHaveValue("");
  });

  it.each([
    [
      { ok: false, code: "BOOKING_CONFLICT" },
      "방금 다른 예약이 들어왔어요. 시간을 다시 골라 주세요",
      true,
    ],
    [{ ok: false, code: "SPACE_BLOCKED" }, "점검 중인 시간이에요", true],
    [{ ok: false, code: "OUTSIDE_HOURS" }, "운영 시간이 아니에요", false],
    [
      { ok: false, code: "LIMIT_EXCEEDED", message: "per_booking" },
      "한 번에 2시간까지 예약할 수 있어요",
      false,
    ],
    [
      { ok: false, code: "LIMIT_EXCEEDED", message: "per_day" },
      "오늘 예약할 수 있는 시간을 다 썼어요",
      false,
    ],
    [
      { ok: false, code: "LIMIT_EXCEEDED", message: "days_ahead" },
      "7일 뒤까지만 예약할 수 있어요",
      false,
    ],
  ] as const)("shows server failure %j", async (result, message, refresh) => {
    vi.mocked(createBooking).mockResolvedValue(result);
    display(<BookingForm data={spaceDayFixture()} />);
    await userEvent.click(
      screen.getByRole("button", { name: "10:00, 비어 있음" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "예약하기" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(message),
    );
    expect(navigation.refresh).toHaveBeenCalledTimes(refresh ? 1 : 0);
  });

  it("reinitializes selection for a different space/date key", async () => {
    const first = spaceDayFixture();
    const client = new QueryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <BookingForm key={`${first.space.id}:${first.date}`} data={first} />
      </QueryClientProvider>,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "10:00, 비어 있음" }),
    );
    const next = { ...first, space: { ...first.space, id: "next-space" } };
    view.rerender(
      <QueryClientProvider client={client}>
        <BookingForm key={`${next.space.id}:${next.date}`} data={next} />
      </QueryClientProvider>,
    );
    expect(
      screen.queryByRole("button", { name: "예약하기" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["start", "시작", "시작 시각을 다시 확인해 주세요"],
    ["end", "끝", "끝 시각을 다시 확인해 주세요"],
    ["title", "제목 (선택)", "제목을 다시 확인해 주세요"],
  ])(
    "opens hidden %s server errors with an accessible field connection",
    async (key, label, message) => {
      vi.mocked(createBooking).mockResolvedValue({
        ok: false,
        code: "INVALID_INPUT",
        fieldErrors: { [key]: [message] },
      });
      display(<BookingForm data={spaceDayFixture()} />);
      await userEvent.click(
        screen.getByRole("button", { name: "10:00, 비어 있음" }),
      );
      const edit = screen.getByRole("button", { name: "예약 내용 바꾸기" });
      expect(edit).toHaveAttribute("aria-expanded", "false");
      expect(
        screen.queryByRole("combobox", { name: "시작" }),
      ).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "예약하기" }));
      await waitFor(() =>
        expect(edit).toHaveAttribute("aria-expanded", "true"),
      );
      const field = screen.getByLabelText(label);
      expect(field).toBeVisible();
      expect(field).toHaveAttribute("aria-invalid", "true");
      expect(field).toHaveAttribute(
        "aria-describedby",
        screen.getByText(message).id,
      );
      expect(screen.getByRole("status")).toHaveTextContent(
        "입력한 내용을 확인해 주세요",
      );
      expect(navigation.refresh).not.toHaveBeenCalled();
      expect(screen.getByLabelText("시작")).toHaveTextContent("10:00");
      await userEvent.click(edit);
      expect(edit).toHaveAttribute("aria-expanded", "false");
      await userEvent.click(screen.getByRole("button", { name: "예약하기" }));
      await waitFor(() =>
        expect(edit).toHaveAttribute("aria-expanded", "true"),
      );
      expect(createBooking).toHaveBeenCalledTimes(2);
    },
  );

  it("keeps the initial panel to a prompt and limit, then uses compact action rows", async () => {
    const data = spaceDayFixture();
    data.hasTeams = true;
    display(<BookingForm data={data} />);
    const form = screen.getByRole("form", { name: "예약 양식" });
    expect(form).toHaveTextContent("시간을 골라 주세요");
    expect(form).toHaveTextContent(
      "개인 예약은 하루 2시간까지 · 오늘 1시간 남음",
    );
    expect(form.querySelector("button, input")).toBeNull();
    expect(form).toHaveClass("shrink-0", "p-3", "space-y-1");
    await userEvent.click(
      screen.getByRole("button", { name: "10:00, 비어 있음" }),
    );
    const edit = screen.getByRole("button", { name: "예약 내용 바꾸기" });
    expect(edit.parentElement).toHaveTextContent("오늘 · 10:00–11:00");
    expect(edit.parentElement).toHaveTextContent("1시간");
    const submit = screen.getByRole("button", { name: "예약하기" });
    expect(submit.parentElement).toContainElement(
      screen.getByRole("combobox", { name: "예약 방식" }),
    );
    expect(submit).toBeEnabled();
  });
});

describe("booking strip", () => {
  async function selectStart(time = "10:00") {
    await userEvent.click(screen.getByRole("combobox", { name: "시작" }));
    await userEvent.click(screen.getByRole("option", { name: time }));
  }

  it("has accessible inputs without another timeline and cannot submit before selection", async () => {
    const view = display(
      <BookingForm data={spaceDayFixture()} variant="strip" />,
    );
    expect(screen.getByText("시간을 골라 주세요")).toBeVisible();
    expect(screen.getByRole("button", { name: "예약하기" })).toBeDisabled();
    expect(screen.getByLabelText("끝")).toBeDisabled();
    expect(
      screen.queryByRole("combobox", { name: "예약 방식" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "제목 (선택)" }),
    ).toHaveAttribute("maxLength", "60");
    expect(
      screen.queryByRole("button", { name: "제목 추가" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(view.container.querySelector("[data-booking-scroll]")).toBeNull();
    await userEvent.tab();
    expect(screen.getByLabelText("시작")).toHaveFocus();
    fireEvent.submit(screen.getByRole("form", { name: "예약 양식" }));
    expect(createBooking).not.toHaveBeenCalled();
  });

  it("keeps contiguous selection, payload, pending lock and success callback", async () => {
    let finish!: (result: ActionResult<{ bookingId: string }>) => void;
    vi.mocked(createBooking).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const onBooked = vi.fn();
    display(
      <BookingForm
        data={spaceDayFixture()}
        variant="strip"
        onBooked={onBooked}
      />,
    );
    await selectStart();
    expect(screen.getByLabelText("끝")).toHaveTextContent("11:00");
    expect(screen.queryByText("시간을 골라 주세요")).not.toBeInTheDocument();
    await userEvent.type(
      screen.getByLabelText("제목 (선택)"),
      "예약 줄 테스트",
    );
    const form = screen.getByRole("form", { name: "예약 양식" });
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await waitFor(() => expect(createBooking).toHaveBeenCalledTimes(1));
    expect(createBooking).toHaveBeenCalledWith({
      spaceId: "space",
      start: "2026-10-07T01:00:00.000Z",
      end: "2026-10-07T02:00:00.000Z",
      teamId: null,
      title: "예약 줄 테스트",
      attendeeCount: null,
    });
    expect(
      screen.getByRole("button", { name: "예약하고 있어요" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("시작")).toBeDisabled();
    expect(screen.getByLabelText("제목 (선택)")).toBeDisabled();
    expect(onBooked).not.toHaveBeenCalled();
    await act(async () => finish({ ok: true, data: { bookingId: "created" } }));
    await waitFor(() => expect(onBooked).toHaveBeenCalledOnce());
    expect(navigation.refresh).toHaveBeenCalledOnce();
    expect(screen.getByText("시간을 골라 주세요")).toBeVisible();
    expect(screen.getByRole("button", { name: "예약하기" })).toBeDisabled();
    expect(screen.getByLabelText("제목 (선택)")).toHaveValue("");
  });

  it("preserves selected times and title when the same form switches layout", async () => {
    const data = spaceDayFixture();
    const client = new QueryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <BookingForm data={data} />
      </QueryClientProvider>,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "10:00, 비어 있음" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "예약 내용 바꾸기" }),
    );
    await userEvent.type(screen.getByLabelText("제목 (선택)"), "유지할 제목");
    view.rerender(
      <QueryClientProvider client={client}>
        <BookingForm data={data} variant="strip" />
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText("시작")).toHaveTextContent("10:00");
    expect(screen.getByLabelText("끝")).toHaveTextContent("11:00");
    expect(screen.getByLabelText("제목 (선택)")).toHaveValue("유지할 제목");
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    view.rerender(
      <QueryClientProvider client={client}>
        <BookingForm data={data} />
      </QueryClientProvider>,
    );
    expect(
      screen.getByRole("button", { name: "10:00, 비어 있음" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("제목 (선택)")).toHaveValue("유지할 제목");
  });

  it("offers only permitted actors and keeps limit guidance without client-side rejection", async () => {
    const data = spaceDayFixture();
    data.hasTeams = true;
    data.actors = [{ ...data.actors[0]!, teamId: "team", name: "가상 팀으로" }];
    data.bookings = [];
    data.blocks = [];
    display(<BookingForm data={data} variant="strip" />);
    await userEvent.click(screen.getByRole("combobox", { name: "예약 방식" }));
    expect(screen.getByRole("option", { name: "가상 팀으로" })).toBeVisible();
    expect(
      screen.queryByRole("option", { name: "개인으로" }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: "가상 팀으로" }));
    await selectStart();
    await userEvent.click(screen.getByLabelText("끝"));
    await userEvent.click(screen.getByRole("option", { name: "14:00" }));
    expect(screen.getByText(/선택한 시간이 예약 한도를 넘어요/)).toBeVisible();
    expect(screen.getByText(/팀 예약은 하루 2시간까지/)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "예약하기" }));
    await waitFor(() =>
      expect(createBooking).toHaveBeenCalledWith(
        expect.objectContaining({
          teamId: "team",
          end: "2026-10-07T05:00:00.000Z",
        }),
      ),
    );
  });

  it.each([
    [
      { ok: false, code: "BOOKING_CONFLICT" },
      "방금 다른 예약이 들어왔어요. 시간을 다시 골라 주세요",
      true,
    ],
    [{ ok: false, code: "SPACE_BLOCKED" }, "점검 중인 시간이에요", true],
    [{ ok: false, code: "OUTSIDE_HOURS" }, "운영 시간이 아니에요", false],
    [
      { ok: false, code: "LIMIT_EXCEEDED", message: "per_booking" },
      "한 번에 2시간까지 예약할 수 있어요",
      false,
    ],
    [
      { ok: false, code: "LIMIT_EXCEEDED", message: "per_day" },
      "오늘 예약할 수 있는 시간을 다 썼어요",
      false,
    ],
    [
      { ok: false, code: "LIMIT_EXCEEDED", message: "days_ahead" },
      "7일 뒤까지만 예약할 수 있어요",
      false,
    ],
  ] as const)(
    "retains server failure and refresh behavior %j",
    async (result, message, refresh) => {
      vi.mocked(createBooking).mockResolvedValue(result);
      const onBooked = vi.fn();
      display(
        <BookingForm
          data={spaceDayFixture()}
          variant="strip"
          onBooked={onBooked}
        />,
      );
      await selectStart();
      await userEvent.click(screen.getByRole("button", { name: "예약하기" }));
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent(message),
      );
      expect(navigation.refresh).toHaveBeenCalledTimes(refresh ? 1 : 0);
      expect(onBooked).not.toHaveBeenCalled();
      expect(screen.getByLabelText("시작")).toHaveTextContent("10:00");
    },
  );
});

describe("navigation, lists and cancellation", () => {
  it("marks the current member destination", () => {
    render(<MemberNav />);
    expect(screen.getByRole("link", { name: "공간 예약" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "홈" })).not.toHaveAttribute(
      "aria-current",
    );
  });
  it("keeps navigation read-only and stores a default only through the separate button", async () => {
    const data = spaceDayFixture();
    display(
      <BranchList
        branches={[
          {
            ...data.branch,
            isDefault: false,
            lounge: { spaceId: "lounge", joined: true },
            todayHours: data.openHours,
            accessibleFloorCount: 1,
            freeSpaceCount: 1,
            bookableSpaceCount: 1,
            operatingState: getOperatingState(
              new Date(data.now),
              data.branch.timezone,
              data.branch.openHours,
            ),
          },
        ]}
      />,
    );
    const link = screen.getByRole("link", { name: /가상 지점/ });
    expect(link).toHaveAttribute("href", "/branches/branch");
    expect(link.querySelector("button")).toBeNull();
    expect(setDefaultBranch).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "가상 지점 기본 지점으로 설정" }),
    );
    await waitFor(() => expect(navigation.refresh).toHaveBeenCalled());
    expect(navigation.push).not.toHaveBeenCalled();
    expect(setDefaultBranch).toHaveBeenCalledWith({ branchId: "branch" });
    expect(
      screen.getByText("이용할 수 있는 층").parentElement,
    ).toHaveTextContent("1개");
  });
  it("shows a restricted badge without rendering a space link and handles empty floors", () => {
    const data = floorDayFixture();
    const view = render(<FloorDay data={data} />);
    expect(screen.getByText("전용 공간")).toBeVisible();
    expect(view.container.querySelector('a[href*="restricted"]')).toBeNull();
    expect(screen.getByRole("link", { name: /회의실 C/ })).toHaveAttribute(
      "href",
      "/branches/branch/floors/floor?date=2026-10-07&space=space",
    );
    view.rerender(<FloorDay data={{ ...data, spaces: [] }} />);
    expect(screen.getByText("이 층에는 공간이 아직 없어요")).toBeVisible();
  });
});

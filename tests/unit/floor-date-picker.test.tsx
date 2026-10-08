import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { BranchNavigation } from "@/features/bookings/components/branch-navigation";
import { FloorDatePicker } from "@/features/bookings/components/floor-date-picker";
import { floorDayFixture } from "./booking-ui-fixtures";

const context = vi.hoisted(() => ({
  wide: true,
  query: "date=2026-10-07&space=chosen-space&view=timeline",
  change: vi.fn(),
}));
vi.mock("@/features/bookings/components/use-wide-screen", () => ({
  useWideScreen: () => context.wide,
}));
vi.mock("@/features/bookings/components/branch-workspace", () => ({
  useFloorSelection: () => ({
    branchId: "branch",
    isCurrentRoute: () => true,
    location: {
      floorId: "floor",
      date: new URLSearchParams(context.query).get("date"),
      spaceId: "chosen-space",
    },
    change: context.change,
  }),
}));
vi.mock("next/navigation", () => ({
  useSelectedLayoutSegments: () => ["floors", "floor"],
  usePathname: () => "/branches/branch/floors/floor",
  useParams: () => ({ floorId: "floor" }),
  useSearchParams: () => new URLSearchParams(context.query),
}));

const defaults = {
  branchId: "branch",
  floorId: "floor",
  spaceId: "chosen-space",
  view: "timeline",
  date: "2026-10-07",
  today: "2026-10-07",
  timezone: "Asia/Seoul",
  openHours: { sun: null },
  bookingDates: ["2026-10-13"],
};
async function openPicker() {
  fireEvent.click(screen.getByRole("button", { name: "달력에서 날짜 고르기" }));
  return within(await screen.findByRole("dialog"));
}
beforeEach(() => {
  context.wide = true;
  context.query = "date=2026-10-07&space=chosen-space&view=timeline";
  vi.clearAllMocks();
});

describe("floor date picker", () => {
  it("preserves people on calendar date links and date changes", async () => {
    context.query += "&people=5";
    render(<FloorDatePicker {...defaults} />);
    const picker = await openPicker();
    const day = picker.getByRole("link", {
      name: "10월 13일 화요일 내 예약 있음",
    });
    expect(day.getAttribute("href")).toContain("people=5");
    fireEvent.click(day);
    expect(context.change.mock.calls[0]?.[1]).toContain("people=5");
  });
  it("keeps date links and focus usable while reservation marks stream in", async () => {
    let resolve!: (dates: string[]) => void;
    const bookingDates = new Promise<string[]>((done) => {
      resolve = done;
    });
    render(<FloorDatePicker {...defaults} bookingDates={bookingDates} />);
    const picker = await openPicker();
    const selected = picker.getByRole("link", {
      name: "10월 7일 수요일, 오늘",
    });
    const day = picker.getByRole("link", { name: "10월 13일 화요일" });
    expect(selected).toHaveFocus();
    expect(picker.getByRole("status")).toHaveTextContent(
      "예약 표시를 불러오고 있어요",
    );
    expect(picker.queryByText("예약 없음")).not.toBeInTheDocument();
    await act(async () => {
      resolve(["2026-10-13"]);
      await bookingDates;
    });
    expect(
      picker.getByRole("link", { name: "10월 13일 화요일 내 예약 있음" }),
    ).toBe(day);
    expect(selected).toHaveFocus();
    expect(picker.queryByRole("status")).not.toBeInTheDocument();
  });

  it("can change months and select a date before reservation marks resolve", async () => {
    render(
      <FloorDatePicker
        {...defaults}
        bookingDates={new Promise<string[]>(() => {})}
      />,
    );
    const picker = await openPicker();
    fireEvent.click(picker.getByRole("button", { name: "다음 달" }));
    expect(picker.getByRole("heading", { name: "2026년 11월" })).toBeVisible();
    fireEvent.click(picker.getByRole("link", { name: "11월 12일 목요일" }));
    expect(context.change).toHaveBeenCalledWith(
      expect.objectContaining({ date: "2026-11-12" }),
      expect.stringContaining("date=2026-11-12"),
    );
  });

  it("opens at the selected month and keeps the previous and final range boundaries", async () => {
    render(<FloorDatePicker {...defaults} date="2026-11-12" />);
    const picker = await openPicker();
    expect(picker.getByRole("heading", { name: "2026년 11월" })).toBeVisible();
    expect(
      picker.getByRole("link", { name: "11월 12일 목요일" }),
    ).toHaveFocus();
    expect(
      picker.getByRole("link", { name: "11월 12일 목요일" }),
    ).toHaveAttribute("aria-current", "date");
    fireEvent.click(picker.getByRole("button", { name: "이전 달" }));
    expect(picker.getByRole("button", { name: "이전 달" })).toBeDisabled();
    expect(
      picker.queryByRole("link", { name: "10월 6일 화요일" }),
    ).not.toBeInTheDocument();
    expect(picker.getByLabelText("10월 6일 화요일")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    fireEvent.click(picker.getByRole("button", { name: "다음 달" }));
    fireEvent.click(picker.getByRole("button", { name: "다음 달" }));
    expect(picker.getByRole("button", { name: "다음 달" })).toBeDisabled();
    expect(
      picker.getByRole("link", { name: "12월 6일 일요일, 쉬는 날" }),
    ).toHaveAttribute(
      "href",
      "/branches/branch/floors/floor?date=2026-12-06&space=chosen-space&view=timeline",
    );
    expect(
      picker.queryByRole("link", { name: "12월 7일 월요일" }),
    ).not.toBeInTheDocument();
  });

  it("names every state, leaves holidays selectable and uses decorative dots", async () => {
    render(<FloorDatePicker {...defaults} />);
    const picker = await openPicker();
    const holiday = picker.getByRole("link", {
      name: "10월 11일 일요일, 쉬는 날",
    });
    expect(within(holiday).getByText("쉼")).toBeVisible();
    const marked = picker.getByRole("link", {
      name: "10월 13일 화요일 내 예약 있음",
    });
    expect(marked.querySelector('[aria-hidden="true"]')).toBeTruthy();
    expect(
      picker.getByRole("link", { name: "10월 7일 수요일, 오늘" }),
    ).toHaveAttribute("aria-current", "date");
    expect(picker.getByText("내 예약이 있는 날")).toBeVisible();
  });

  it("changes only date, immediately dispatches navigation and closes", async () => {
    render(<FloorDatePicker {...defaults} />);
    const picker = await openPicker();
    const link = picker.getByRole("link", {
      name: "10월 13일 화요일 내 예약 있음",
    });
    expect(link).toHaveAttribute(
      "href",
      "/branches/branch/floors/floor?date=2026-10-13&space=chosen-space&view=timeline",
    );
    fireEvent.click(link);
    expect(context.change).toHaveBeenCalledExactlyOnceWith(
      { floorId: "floor", date: "2026-10-13", spaceId: "chosen-space" },
      "/branches/branch/floors/floor?date=2026-10-13&space=chosen-space&view=timeline",
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("leaves modifier navigation untouched and keeps the calendar open", async () => {
    render(<FloorDatePicker {...defaults} />);
    const picker = await openPicker();
    fireEvent.click(
      picker.getByRole("link", { name: "10월 13일 화요일 내 예약 있음" }),
      { ctrlKey: true },
    );
    expect(context.change).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("uses a single roving date stop, crosses months by arrows and clamps to today", async () => {
    render(<FloorDatePicker {...defaults} date="2026-10-31" />);
    const picker = await openPicker();
    const grid = picker.getByRole("grid");
    expect(
      within(grid)
        .getAllByRole("link")
        .filter((link) => link.tabIndex === 0),
    ).toHaveLength(1);
    fireEvent.keyDown(picker.getByRole("link", { name: "10월 31일 토요일" }), {
      key: "ArrowRight",
    });
    expect(picker.getByRole("heading", { name: "2026년 11월" })).toBeVisible();
    expect(
      picker.getByRole("link", { name: "11월 1일 일요일, 쉬는 날" }),
    ).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(picker.getByRole("heading", { name: "2026년 10월" })).toBeVisible();
    expect(
      picker.getByRole("link", { name: "10월 25일 일요일, 쉬는 날" }),
    ).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(
      picker.getByRole("link", { name: "10월 7일 수요일, 오늘" }),
    ).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(
      picker.getByRole("link", { name: "10월 7일 수요일, 오늘" }),
    ).toHaveFocus();
  });

  it("returns focus on Escape and resets the viewed month when reopened", async () => {
    render(<FloorDatePicker {...defaults} />);
    const picker = await openPicker();
    fireEvent.click(picker.getByRole("button", { name: "다음 달" }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    const trigger = screen.getByRole("button", {
      name: "달력에서 날짜 고르기",
    });
    await waitFor(() => expect(trigger).toHaveFocus());
    const reopened = await openPicker();
    expect(
      reopened.getByRole("heading", { name: "2026년 10월" }),
    ).toBeVisible();
  });

  it("selects a keyboard-focused date with Enter and never passes the final day", async () => {
    const user = userEvent.setup();
    render(<FloorDatePicker {...defaults} date="2026-12-06" />);
    const picker = await openPicker();
    const last = picker.getByRole("link", {
      name: "12월 6일 일요일, 쉬는 날",
    });
    fireEvent.keyDown(last, { key: "ArrowRight" });
    fireEvent.keyDown(last, { key: "ArrowDown" });
    expect(last).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(context.change).toHaveBeenCalledExactlyOnceWith(
      { floorId: "floor", date: "2026-12-06", spaceId: "chosen-space" },
      "/branches/branch/floors/floor?date=2026-12-06&space=chosen-space&view=timeline",
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("uses an accessible bottom sheet on narrow screens with one calendar and close focus", async () => {
    context.wide = false;
    render(<FloorDatePicker {...defaults} />);
    const picker = await openPicker();
    expect(screen.getByRole("dialog", { name: "날짜 고르기" })).toHaveAttribute(
      "data-side",
      "bottom",
    );
    expect(picker.getAllByRole("grid")).toHaveLength(1);
    expect(picker.getByRole("heading", { name: "날짜 고르기" })).toBeVisible();
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription(
      "오늘부터 60일 안의 날짜를 골라 주세요.",
    );
    fireEvent.click(picker.getByRole("button", { name: "날짜 달력 닫기" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "달력에서 날짜 고르기" }),
      ).toHaveFocus(),
    );
  });

  it("keeps today as a link with the same parent, view and space", async () => {
    render(<FloorDatePicker {...defaults} date="2026-11-12" />);
    const picker = await openPicker();
    expect(picker.getByRole("link", { name: "오늘" })).toHaveAttribute(
      "href",
      "/branches/branch/floors/floor?date=2026-10-07&space=chosen-space&view=timeline",
    );
  });

  it("adds booking dots to the date strip and preserves explicit view in date and floor links", async () => {
    const data = floorDayFixture();
    render(
      <BranchNavigation
        data={{
          branch: data.branch,
          floors: data.floors,
          branches: [],
          lounge: { spaceId: "lounge", joined: true },
          today: defaults.today,
          now: data.now,
          bookingDates: ["2026-10-13"],
        }}
      />,
    );
    const dates = within(screen.getByRole("navigation", { name: "날짜 선택" }));
    const marked = dates.getByRole("link", {
      name: "10월 13일 화요일 내 예약 있음",
    });
    expect(marked.querySelector('[aria-hidden="true"]')).toBeTruthy();
    expect(marked).toHaveAttribute(
      "href",
      "/branches/branch/floors/floor?date=2026-10-13&space=chosen-space&view=timeline",
    );
    expect(
      within(screen.getByRole("navigation", { name: "층 선택" })).getByRole(
        "link",
        { name: "7F" },
      ),
    ).toHaveAttribute(
      "href",
      "/branches/branch/floors/floor?date=2026-10-07&view=timeline",
    );
    await act(async () => {
      fireEvent.click(marked);
    });
    expect(context.change).toHaveBeenCalled();
    expect(screen.getByLabelText("공간 상태 범례")).toHaveTextContent(
      "비어 있음예약됨내 예약점검",
    );
  });
});

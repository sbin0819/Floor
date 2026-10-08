import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BranchNavigation } from "@/features/bookings/components/branch-navigation";
import {
  BranchWorkspace,
  useFloorSelection,
} from "@/features/bookings/components/branch-workspace";
import {
  BranchDisplayClockProvider,
  useBranchDisplayNow,
} from "@/features/bookings/components/branch-display-clock";
import type { BranchNavigationData } from "@/features/bookings/types";

const navigation = vi.hoisted(() => ({
  query: "",
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ branchId: "branch", floorId: "floor" }),
  useSearchParams: () => new URLSearchParams(navigation.query),
  useRouter: () => navigation.router,
}));
function fixture(now: string): BranchNavigationData {
  return {
    branch: {
      id: "branch",
      name: "성수점",
      address: "가상 주소",
      timezone: "Asia/Seoul",
      openHours: { thu: { open: "09:00", close: "21:00" } },
      cover: null,
    },
    floors: [{ id: "floor", name: "2F", level: 2, sortOrder: 0 }],
    branches: [],
    today: "2026-10-08",
    bookingDates: [],
    now,
  };
}
function Location() {
  return (
    <output data-testid="date">{useFloorSelection()?.location.date}</output>
  );
}
function FreshDetail({ now }: { now: string }) {
  const displayNow = useBranchDisplayNow({ branchId: "branch", now });
  return <output data-testid="detail-clock">{displayNow}</output>;
}
function Page({
  data,
  detailNow,
}: {
  data: BranchNavigationData;
  detailNow?: string;
}) {
  return (
    <BranchWorkspace>
      <BranchDisplayClockProvider branchId="branch">
        <BranchNavigation data={data} />
        {detailNow && <FreshDetail now={detailNow} />}
      </BranchDisplayClockProvider>
      <Location />
    </BranchWorkspace>
  );
}
describe("branch navigation display clock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    vi.clearAllMocks();
    navigation.query = "";
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it.each([
    ["2026-10-07T23:59:45.000Z", "영업 전", "영업 중"],
    ["2026-10-08T11:59:45.000Z", "영업 중", "영업 종료"],
  ])(
    "updates only the operating label across the boundary at %s",
    (now, before, after) => {
      const data = fixture(now);
      const source = JSON.stringify(data);
      render(<Page data={data} />);
      expect(screen.getByLabelText("선택한 날짜 운영 시간")).toHaveTextContent(
        `${before} · 09:00–21:00`,
      );
      act(() => vi.advanceTimersByTime(15_000));
      expect(screen.getByLabelText("선택한 날짜 운영 시간")).toHaveTextContent(
        `${after} · 09:00–21:00`,
      );
      expect(screen.getByTestId("date")).toHaveTextContent("2026-10-08");
      expect(JSON.stringify(data)).toBe(source);
      expect(navigation.router.push).not.toHaveBeenCalled();
      expect(navigation.router.replace).not.toHaveBeenCalled();
      expect(navigation.router.refresh).not.toHaveBeenCalled();
    },
  );

  it("keeps the server's date normalization and date links when midnight passes", () => {
    const data = fixture("2026-10-08T14:59:45.000Z");
    render(<Page data={data} />);
    const links = () =>
      screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    const before = links();
    expect(screen.getByLabelText("선택한 날짜 운영 시간")).toHaveTextContent(
      "영업 종료 · 09:00–21:00",
    );
    act(() => vi.advanceTimersByTime(15_000));
    expect(screen.getByLabelText("선택한 날짜 운영 시간")).toHaveTextContent(
      /^09:00–21:00$/,
    );
    expect(screen.getByTestId("date")).toHaveTextContent("2026-10-08");
    expect(links()).toEqual(before);
    expect(data.today).toBe("2026-10-08");
    expect(data.now).toBe("2026-10-08T14:59:45.000Z");
    expect(navigation.router.push).not.toHaveBeenCalled();
  });

  it("does not apply today's live status to a selected future date", () => {
    navigation.query = "date=2026-10-15";
    render(<Page data={fixture("2026-10-07T23:59:45.000Z")} />);
    act(() => vi.advanceTimersByTime(15_000));
    expect(screen.getByLabelText("선택한 날짜 운영 시간")).toHaveTextContent(
      /^09:00–21:00$/,
    );
    expect(screen.getByTestId("date")).toHaveTextContent("2026-10-15");
  });

  it("accepts fresh detail timestamps without changing the retained navigation data", () => {
    const data = fixture("2026-10-07T23:59:45.000Z");
    const view = render(<Page data={data} />);
    expect(screen.getByLabelText("선택한 날짜 운영 시간")).toHaveTextContent(
      "영업 전",
    );
    view.rerender(<Page data={data} detailNow="2026-10-08T00:01:00.000Z" />);
    expect(screen.getByLabelText("선택한 날짜 운영 시간")).toHaveTextContent(
      "영업 중",
    );
    expect(screen.getByTestId("detail-clock")).toHaveTextContent(
      "2026-10-08T00:01:00.000Z",
    );
    expect(data.now).toBe("2026-10-07T23:59:45.000Z");
    expect(screen.getByTestId("date")).toHaveTextContent("2026-10-08");
  });
});

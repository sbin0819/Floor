import { useEffect, type ReactNode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BranchWorkspace,
  ResolvedSpaceSelection,
  useFloorSelection,
} from "@/features/bookings/components/branch-workspace";
import { FloorPeopleControl } from "@/features/bookings/components/floor-people-filter";
import {
  FloorViewControl,
  FloorViewProvider,
  useFloorPeople,
} from "@/features/bookings/components/floor-view";
import { FloorViews } from "@/features/bookings/components/floor-views";
import { FloorNavigationLink } from "@/features/bookings/components/floor-navigation-link";
import { floorSelectionKey } from "@/features/bookings/floor-selection";
import { floorHref } from "@/features/bookings/format";
import type { NavigateAction } from "@/components/optimistic-navigation";
import { floorDayFixture } from "./booking-ui-fixtures";
import type { FloorDayData } from "@/features/bookings/types";

const route = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("@/features/floor-plan/use-floor-realtime", () => ({
  useFloorRealtime: () => ({ flashSpaceIds: [] }),
}));
vi.mock("next/navigation", () => ({
  useSelectedLayoutSegments: () => ["floors", "floor"],
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => route,
}));

const small = "abcdefab-1234-4abc-9def-123456789ab1";
const large = "abcdefab-1234-4abc-9def-123456789ab2";
const today = "2026-10-07";
const path = "/branches/branch/floors/floor";
function fixture() {
  const data = floorDayFixture();
  const first = data.spaces[0]!;
  if (first.kind !== "accessible") throw new Error("Missing room");
  data.spaces = [
    { ...first, id: small, name: "작은 방", capacity: 2 },
    { ...first, id: large, name: "큰 방", capacity: 8 },
    { ...first, id: "lounge", name: "라운지", type: "lounge", bookable: false },
    { kind: "restricted", id: "restricted", type: "meeting_room" },
  ];
  data.groups = [
    { type: "meeting_room", totalCount: 3, freeCount: 2 },
    { type: "lounge", totalCount: 1, freeCount: 0 },
  ];
  return data;
}
function Probe() {
  const workspace = useFloorSelection()!;
  const register = workspace.registerNavigation;
  useEffect(
    () => register("branch", today, "2026-10-07T01:10:00.000Z"),
    [register],
  );
  const { people } = useFloorPeople();
  return (
    <>
      <span data-testid="people">{people ?? "all"}</span>
      <span data-testid="full-count">{workspace.floorData?.spaces.length}</span>
      <span data-testid="selection-key">{workspace.selectionKey}</span>
      <FloorNavigationLink
        href={floorHref("branch", "floor", "2026-10-08")}
        location={{ floorId: "floor", date: "2026-10-08", spaceId: null }}
      >
        다음 날
      </FloorNavigationLink>
      <button
        onClick={() =>
          workspace.selectSlot({
            spaceId: large,
            slots: [
              {
                start: "2026-10-07T02:00:00.000Z",
                end: "2026-10-07T02:30:00.000Z",
                label: "11:00",
                endLabel: "11:30",
                state: "free",
              },
            ],
            start: "2026-10-07T02:00:00.000Z",
            href: floorHref("branch", "floor", today, large),
          })
        }
      >
        빈 칸
      </button>
      <button onClick={() => workspace.closeAfterBooking(large, today)}>
        성공 후 닫기
      </button>
    </>
  );
}
function Tree({
  data = fixture(),
  navigateAction,
  selected,
  children,
}: {
  data?: FloorDayData;
  navigateAction?: NavigateAction;
  selected?: string;
  children?: ReactNode;
}) {
  return (
    <FloorViewProvider cookieView={null}>
      <BranchWorkspace branchId="branch" navigateAction={navigateAction}>
        <Probe />
        <FloorPeopleControl />
        <FloorViewControl />
        {selected && (
          <ResolvedSpaceSelection
            selectionKey={floorSelectionKey("branch", "floor", today, selected)}
            spaceId={selected}
          >
            {null}
          </ResolvedSpaceSelection>
        )}
        <FloorViews data={data} initialView="list" />
        {children}
      </BranchWorkspace>
    </FloorViewProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", `${path}?date=${today}&view=list`);
});

describe("floor people control", () => {
  it("uses real links, updates only people without server navigation and keeps selection keys", () => {
    window.history.replaceState(
      null,
      "",
      `${path}?date=${today}&view=list&space=${small}&detail=1`,
    );
    render(<Tree selected={small} />);
    const key = screen.getByTestId("selection-key").textContent;
    const group = within(
      screen.getByRole("group", { name: "인원으로 거르기" }),
    );
    expect(group.getByLabelText("한 명 줄이기")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(group.getByRole("link", { name: "한 명 늘리기" })).toHaveAttribute(
      "href",
      `${path}?date=${today}&view=list&space=${small}&detail=1&people=2`,
    );
    fireEvent.click(group.getByRole("link", { name: "한 명 늘리기" }));
    expect(screen.getByTestId("people")).toHaveTextContent("2");
    expect(new URLSearchParams(window.location.search).get("space")).toBe(
      small,
    );
    expect(screen.getByTestId("selection-key").textContent).toBe(key);
    fireEvent.click(group.getByRole("link", { name: "한 명 줄이기" }));
    expect(screen.getByTestId("people")).toHaveTextContent("all");
    expect(window.location.search).not.toContain("people=");
    expect(route.push).not.toHaveBeenCalled();
    expect(route.replace).not.toHaveBeenCalled();
    expect(screen.queryByText("불러오고 있어요")).not.toBeInTheDocument();
  });
  it("stops at 50 and modifier-click keeps native navigation", () => {
    window.history.replaceState(null, "", `${path}?people=50`);
    render(<Tree />);
    expect(screen.getByLabelText("한 명 늘리기")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(
      screen.queryByRole("link", { name: "한 명 늘리기" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "한 명 줄이기" }), {
      ctrlKey: true,
    });
    expect(window.location.search).toBe("?people=50");
    fireEvent.click(screen.getByRole("link", { name: "인원 조건 지우기" }));
    expect(screen.getByTestId("people")).toHaveTextContent("all");
  });
  it("waits for pending server navigation then merges the latest filter into its final URL", async () => {
    let finish!: () => void;
    const navigation = vi.fn<NavigateAction>(async (href) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      window.history.pushState(null, "", href);
    });
    render(<Tree navigateAction={navigation} />);
    fireEvent.click(screen.getByRole("link", { name: "다음 날" }));
    fireEvent.click(screen.getByRole("link", { name: "한 명 늘리기" }));
    fireEvent.click(screen.getByRole("link", { name: "한 명 늘리기" }));
    expect(screen.getByTestId("people")).toHaveTextContent("3");
    expect(window.location.search).not.toContain("people=");
    await act(async () => finish());
    const query = new URLSearchParams(window.location.search);
    expect(query.get("date")).toBe("2026-10-08");
    expect(query.get("people")).toBe("3");
    expect(navigation).toHaveBeenCalledTimes(1);
  });
  it("preserves people in slot, date, close and view navigation", () => {
    window.history.replaceState(
      null,
      "",
      `${path}?date=${today}&view=list&people=5&space=${large}`,
    );
    render(<Tree selected={large} />);
    expect(
      screen.getByRole("link", { name: "다음 날" }).getAttribute("href"),
    ).toContain("people=5");
    fireEvent.click(screen.getByRole("button", { name: "성공 후 닫기" }));
    expect(route.replace.mock.calls[0]?.[0]).toContain("people=5");
    fireEvent.click(screen.getByRole("link", { name: "시간표 보기" }));
    expect(new URLSearchParams(window.location.search).get("people")).toBe("5");
  });
  it("carries people when a blank slot changes the selected space", () => {
    window.history.replaceState(
      null,
      "",
      `${path}?date=${today}&view=timeline&people=5`,
    );
    render(<Tree />);
    fireEvent.click(screen.getByRole("button", { name: "빈 칸" }));
    expect(route.push.mock.calls[0]?.[0]).toContain(`space=${large}`);
    expect(route.push.mock.calls[0]?.[0]).toContain("people=5");
  });
});

describe("filtered floor presentation", () => {
  it("shows the same matching rows in both views and keeps all original data registered", () => {
    window.history.replaceState(
      null,
      "",
      `${path}?date=${today}&view=list&people=5`,
    );
    render(<Tree />);
    expect(screen.getByRole("region", { name: "공간 목록" })).toHaveTextContent(
      "큰 방",
    );
    expect(screen.queryByText("작은 방")).not.toBeInTheDocument();
    expect(screen.queryByText("라운지")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "5명이 쓸 수 있는 공간만 보여요 · 숨긴 공간 3곳",
    );
    expect(screen.getByTestId("full-count")).toHaveTextContent("4");
    fireEvent.click(screen.getByRole("link", { name: "시간표 보기" }));
    expect(screen.getByRole("region", { name: "층 시간표" })).toHaveTextContent(
      "큰 방",
    );
    expect(screen.queryByText("작은 방")).not.toBeInTheDocument();
    expect(screen.getByTestId("full-count")).toHaveTextContent("4");
    fireEvent.click(screen.getByRole("link", { name: "모두 보기" }));
    expect(screen.getByText("작은 방")).toBeInTheDocument();
  });
  it("retains a selected undersized room and recomputes the group", () => {
    window.history.replaceState(
      null,
      "",
      `${path}?date=${today}&view=list&people=5&space=${small}`,
    );
    render(<Tree selected={small} />);
    expect(screen.getByText("작은 방")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("숨긴 공간 2곳");
    expect(screen.getByText("2곳 · 지금 2곳 비어 있음")).toBeInTheDocument();
  });
  it("gives an explicit empty filter result and no empty group", () => {
    window.history.replaceState(null, "", `${path}?people=50`);
    render(<Tree />);
    expect(
      screen.getByText("50명이 쓸 수 있는 공간이 이 층에 없어요"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "회의실" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "모두 보기" })).toHaveLength(2);
  });
  it("shows only the holiday notice when closed", () => {
    window.history.replaceState(null, "", `${path}?people=5`);
    const data = fixture();
    data.openHours = null;
    render(<Tree data={data} />);
    expect(screen.getByText("이 날은 쉬는 날이에요")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText(/쓸 수 있는 공간/)).not.toBeInTheDocument();
  });
  it("moves timetable keyboard focus across visible rows only", () => {
    window.history.replaceState(
      null,
      "",
      `${path}?date=${today}&people=5&view=timeline`,
    );
    render(<Tree />);
    const room = screen.getByRole("link", { name: /큰 방/ });
    act(() => room.focus());
    fireEvent.keyDown(room, { key: "ArrowRight" });
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(
      /^큰 방,/,
    );
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(
      /^큰 방,/,
    );
    expect(
      screen.queryByRole("link", { name: /작은 방/ }),
    ).not.toBeInTheDocument();
  });
});

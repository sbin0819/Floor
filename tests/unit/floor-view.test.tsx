import { Activity, useEffect } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { FloorViews } from "@/features/bookings/components/floor-views";
import { floorDayFixture, spaceDayFixture } from "./booking-ui-fixtures";
import type { NavigateAction } from "@/components/optimistic-navigation";
import {
  BranchWorkspace,
  ResolvedSpaceSelection,
  useFloorSelection,
} from "@/features/bookings/components/branch-workspace";
import {
  floorSelectionKey,
  type FloorLocation,
} from "@/features/bookings/floor-selection";
import {
  selectableSlots,
  type FloorBookingSelection,
} from "@/features/bookings/selection";
import { resolveFloorView } from "@/features/bookings/floor-view";
import { floorHref } from "@/features/bookings/format";
import {
  FloorViewControl,
  FloorViewProvider,
  useFloorView,
} from "@/features/bookings/components/floor-view";

const route = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("@/features/bookings/components/floor-day", () => ({
  FloorDay: () => <p>공간 목록 보기</p>,
}));
vi.mock("@/features/bookings/components/floor-timetable", () => ({
  FloorTimetable: () => <p>층 시간표 보기</p>,
}));
vi.mock("next/navigation", () => ({
  useSelectedLayoutSegments: () => ["floors", "floor"],
  usePathname: () => window.location.pathname,
  useParams: () => ({ branchId: "branch", floorId: "floor" }),
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ push: route.push }),
}));
function Selected() {
  const { view } = useFloorView();
  return <output data-testid="view">{view ?? "responsive"}</output>;
}
const tree = () => (
  <FloorViewProvider cookieView={null}>
    <BranchWorkspace branchId="branch">
      <FloorViewControl />
      <Selected />
    </BranchWorkspace>
  </FloorViewProvider>
);
const first = "abcdefab-1234-4abc-9def-123456789ab2";
const second = "abcdefab-1234-4abc-9def-123456789ab3";
const today = "2026-10-07";
const slots = selectableSlots(spaceDayFixture());
const firstStart = "2026-10-07T01:00:00.000Z";
function WorkspaceControls() {
  const workspace = useFloorSelection()!;
  const register = workspace.registerNavigation;
  useEffect(() => register("branch", today, spaceDayFixture().now), [register]);
  return (
    <>
      <output data-testid="workspace">
        {JSON.stringify({
          location: workspace.location,
          selection: workspace.selection,
          pending: workspace.navigationPending,
        })}
      </output>
      <button
        onClick={() =>
          workspace.selectSlot({
            spaceId: first,
            slots,
            start: firstStart,
            href: floorHref("branch", "floor", today, first, "timeline"),
          })
        }
      >
        현재 칸 고르기
      </button>
      <button
        onClick={() =>
          workspace.selectSlot({
            spaceId: second,
            slots,
            start: firstStart,
            href: floorHref("branch", "floor", today, second, "timeline"),
          })
        }
      >
        다른 공간 고르기
      </button>
      <button
        onClick={() =>
          workspace.change(
            { ...workspace.location, spaceId: null },
            floorHref("branch", "floor", today, undefined, "timeline"),
            { replace: true },
          )
        }
      >
        공간 닫기
      </button>
    </>
  );
}
function WorkspaceView({
  actualSpaceId = first,
  serverDate = today,
  navigateAction,
}: {
  actualSpaceId?: string | null;
  serverDate?: unknown;
  navigateAction?: NavigateAction;
}) {
  return (
    <FloorViewProvider cookieView={null}>
      <BranchWorkspace branchId="branch" navigateAction={navigateAction}>
        <WorkspaceControls />
        <FloorViewControl />
        <Selected />
        <ResolvedSpaceSelection
          selectionKey={floorSelectionKey(
            "branch",
            "floor",
            serverDate,
            actualSpaceId,
          )}
          spaceId={actualSpaceId}
        >
          <p>서버가 확인한 상세</p>
        </ResolvedSpaceSelection>
      </BranchWorkspace>
    </FloorViewProvider>
  );
}
const workspaceState = () =>
  JSON.parse(screen.getByTestId("workspace").textContent ?? "null") as {
    location: FloorLocation;
    selection: FloorBookingSelection | null;
    pending: boolean;
  };
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(
    null,
    "",
    "/branches/branch/floors/floor?date=2026-10-07&space=space",
  );
  document.cookie = "floor_view=; Max-Age=0; Path=/";
});
afterEach(() => vi.restoreAllMocks());
describe("floor view preference", () => {
  it("server-renders both views with CSS visibility when there is no preference", () => {
    const html = renderToString(
      <FloorViews data={floorDayFixture()} initialView={null} />,
    );
    expect(html).toContain('data-floor-view="list" class="lg:hidden"');
    expect(html).toContain(
      'data-floor-view="timeline" class="hidden lg:block"',
    );
    expect(html).toContain("공간 목록 보기");
    expect(html).toContain("층 시간표 보기");
  });
  it("renders only the explicit URL view even when the cookie differs", () => {
    window.history.replaceState(null, "", "?view=timeline");
    render(
      <FloorViewProvider cookieView="list">
        <FloorViews data={floorDayFixture()} initialView="list" />
      </FloorViewProvider>,
    );
    expect(screen.getByText("층 시간표 보기")).toBeVisible();
    expect(screen.queryByText("공간 목록 보기")).not.toBeInTheDocument();
  });
  it.each([
    ["list", "timeline", "list"],
    ["timeline", "list", "timeline"],
    [undefined, "list", "list"],
    ["invalid", "timeline", "timeline"],
    [["list", "timeline"], "list", "list"],
    [undefined, "invalid", null],
    ["", undefined, null],
    [null, null, null],
  ])("resolves URL %s before cookie %s", (url, cookie, expected) => {
    expect(resolveFloorView(url, cookie)).toBe(expected);
  });
  it("keeps date and space when generating view links", () => {
    expect(floorHref("branch", "floor", "2026-10-07", "room", "timeline")).toBe(
      "/branches/branch/floors/floor?date=2026-10-07&space=room&view=timeline",
    );
  });
  it("updates native history and the preference without a router request", () => {
    render(tree());
    expect(screen.getByRole("link", { name: "시간표 보기" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    const push = vi.spyOn(window.history, "pushState");
    fireEvent.click(screen.getByRole("link", { name: "목록 보기" }));
    expect(push).toHaveBeenCalledWith(
      null,
      "",
      "/branches/branch/floors/floor?date=2026-10-07&space=space&view=list",
    );
    expect(screen.getByTestId("view")).toHaveTextContent("list");
    expect(document.cookie).toContain("floor_view=list");
    expect(route.push).not.toHaveBeenCalled();
    push.mockRestore();
  });
  it.each([
    { metaKey: true },
    { ctrlKey: true },
    { shiftKey: true },
    { altKey: true },
  ])("preserves modified link clicks %j", (modifiers) => {
    render(tree());
    const push = vi.spyOn(window.history, "pushState");
    fireEvent.click(screen.getByRole("link", { name: "목록 보기" }), modifiers);
    expect(push).not.toHaveBeenCalled();
    expect(document.cookie).not.toContain("floor_view=list");
    push.mockRestore();
  });
  it("reads the selected view after browser history changes", () => {
    const view = render(tree());
    window.history.replaceState(null, "", "?view=list");
    view.rerender(tree());
    expect(screen.getByTestId("view")).toHaveTextContent("list");
    window.history.replaceState(null, "", "?view=timeline");
    view.rerender(tree());
    expect(screen.getByTestId("view")).toHaveTextContent("timeline");
  });
  it.each([null, "invalid-date", ["2026-10-07", "2026-10-08"]])(
    "changes only view and preserves the server's raw date key %j",
    (rawDate) => {
      const query = new URLSearchParams({ space: first, view: "timeline" });
      if (Array.isArray(rawDate))
        for (const value of rawDate) query.append("date", value);
      else if (rawDate !== null) query.set("date", rawDate);
      window.history.replaceState(
        null,
        "",
        `/branches/branch/floors/floor?${query}`,
      );
      const view = render(<WorkspaceView serverDate={rawDate} />);
      fireEvent.click(screen.getByText("현재 칸 고르기"));
      const range = workspaceState().selection;
      expect(range).toMatchObject({ spaceId: first, start: firstStart });
      fireEvent.click(screen.getByRole("link", { name: "목록 보기" }));
      // Next의 history 연동이 갱신하는 부모의 searchParams도 같이 반영한다.
      view.rerender(<WorkspaceView serverDate={rawDate} />);
      expect(
        new URLSearchParams(window.location.search).getAll("date"),
      ).toEqual(query.getAll("date"));
      expect(workspaceState().location.spaceId).toBe(first);
      expect(workspaceState().selection).toEqual(range);
      expect(screen.getByTestId("view")).toHaveTextContent("list");
      query.set("view", "timeline");
      window.history.replaceState(null, "", `?${query}`);
      view.rerender(<WorkspaceView serverDate={rawDate} />);
      expect(screen.getByTestId("view")).toHaveTextContent("timeline");
    },
  );
  it("shows a pending view immediately but writes history only after the space response, preserving its latest URL", async () => {
    window.history.replaceState(
      null,
      "",
      floorHref("branch", "floor", today, first, "timeline"),
    );
    const navigation = Promise.withResolvers<void>();
    const navigate = vi.fn<NavigateAction>(() => navigation.promise);
    const view = render(<WorkspaceView navigateAction={navigate} />);
    fireEvent.click(screen.getByText("현재 칸 고르기"));
    fireEvent.click(screen.getByText("다른 공간 고르기"));
    expect(workspaceState().pending).toBe(true);
    expect(workspaceState().selection).toMatchObject({
      spaceId: second,
      start: firstStart,
    });
    const push = vi.spyOn(window.history, "pushState");
    fireEvent.click(screen.getByRole("link", { name: "목록 보기" }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByTestId("view")).toHaveTextContent("list");
    expect(document.cookie).toContain("floor_view=list");
    expect(new URLSearchParams(window.location.search).get("space")).toBe(
      first,
    );
    expect(workspaceState().location.spaceId).toBe(second);
    fireEvent.click(screen.getByRole("link", { name: "시간표 보기" }));
    fireEvent.click(screen.getByRole("link", { name: "목록 보기" }));
    expect(push).not.toHaveBeenCalled();
    window.history.replaceState(
      null,
      "",
      `${floorHref("branch", "floor", today, second, "timeline")}&extra=keep#schedule`,
    );
    view.rerender(
      <WorkspaceView actualSpaceId={second} navigateAction={navigate} />,
    );
    await act(async () => {
      navigation.resolve();
      await navigation.promise;
    });
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    // 실제 Next의 native history patch가 갱신한 useSearchParams를 반영한다.
    view.rerender(
      <WorkspaceView actualSpaceId={second} navigateAction={navigate} />,
    );
    expect(push).toHaveBeenCalledWith(
      null,
      "",
      `${floorHref("branch", "floor", today, second, "list")}&extra=keep#schedule`,
    );
    expect(workspaceState().selection).toMatchObject({
      spaceId: second,
      start: firstStart,
    });
    expect(workspaceState().location).toEqual({
      floorId: "floor",
      date: today,
      spaceId: second,
      detail: false,
    });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("view")).toHaveTextContent("list");
    window.history.replaceState(
      null,
      "",
      floorHref("branch", "floor", today, second, "timeline"),
    );
    view.rerender(
      <WorkspaceView actualSpaceId={second} navigateAction={navigate} />,
    );
    expect(screen.getByTestId("view")).toHaveTextContent("timeline");
  });
  it.each(["inactive", "hidden"] as const)(
    "discards a pending view override on %s route leave and follows the URL on back",
    async (mode) => {
      const original = floorHref("branch", "floor", today, first, "timeline");
      window.history.replaceState(null, "", original);
      const navigation = Promise.withResolvers<void>();
      const navigate = vi.fn<NavigateAction>(() => navigation.promise);
      const frame = (hidden = false) => (
        <Activity mode={hidden ? "hidden" : "visible"}>
          <WorkspaceView navigateAction={navigate} />
        </Activity>
      );
      const view = render(frame());
      fireEvent.click(screen.getByText("다른 공간 고르기"));
      expect(workspaceState().pending).toBe(true);
      const push = vi.spyOn(window.history, "pushState");
      fireEvent.click(screen.getByRole("link", { name: "목록 보기" }));
      expect(screen.getByTestId("view")).toHaveTextContent("list");
      expect(push).not.toHaveBeenCalled();
      window.history.replaceState(null, "", "/bookings?view=calendar");
      await act(async () => view.rerender(frame(mode === "hidden")));
      await act(async () => {
        navigation.resolve();
        await navigation.promise;
      });
      expect(window.location.pathname).toBe("/bookings");
      expect(window.location.search).toBe("?view=calendar");
      expect(push).not.toHaveBeenCalled();
      window.history.replaceState(null, "", original);
      view.rerender(frame());
      await waitFor(() =>
        expect(screen.getByTestId("view")).toHaveTextContent("timeline"),
      );
      expect(screen.getByRole("link", { name: "시간표 보기" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      expect(
        screen.getByRole("link", { name: "목록 보기" }),
      ).not.toHaveAttribute("aria-current");
      expect(document.cookie).toContain("floor_view=list");
      expect(push).not.toHaveBeenCalled();
    },
  );
  it("also defers during closing navigation without putting the removed space back into the URL", async () => {
    window.history.replaceState(
      null,
      "",
      floorHref("branch", "floor", today, first, "timeline"),
    );
    const navigation = Promise.withResolvers<void>();
    const navigate = vi.fn<NavigateAction>(() => navigation.promise);
    const view = render(<WorkspaceView navigateAction={navigate} />);
    fireEvent.click(screen.getByText("공간 닫기"));
    expect(workspaceState().pending).toBe(true);
    expect(workspaceState().location.spaceId).toBeNull();
    const push = vi.spyOn(window.history, "pushState");
    fireEvent.click(screen.getByRole("link", { name: "목록 보기" }));
    expect(push).not.toHaveBeenCalled();
    window.history.replaceState(
      null,
      "",
      floorHref("branch", "floor", today, undefined, "timeline"),
    );
    view.rerender(
      <WorkspaceView actualSpaceId={null} navigateAction={navigate} />,
    );
    await act(async () => {
      navigation.resolve();
      await navigation.promise;
    });
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(push).toHaveBeenCalledWith(
      null,
      "",
      floorHref("branch", "floor", today, undefined, "list"),
    );
    expect(new URLSearchParams(window.location.search).has("space")).toBe(
      false,
    );
    expect(workspaceState().selection).toBeNull();
  });
});

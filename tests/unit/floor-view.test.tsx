import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { FloorViews } from "@/features/bookings/components/floor-views";
import { floorDayFixture } from "./booking-ui-fixtures";
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
    <FloorViewControl />
    <Selected />
  </FloorViewProvider>
);
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(
    null,
    "",
    "/branches/branch/floors/floor?date=2026-10-07&space=space",
  );
  document.cookie = "floor_view=; Max-Age=0; Path=/";
});
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
});

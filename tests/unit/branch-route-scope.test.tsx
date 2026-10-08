import { Activity, useEffect } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BranchWorkspace,
  ResolvedSpaceSelection,
  useFloorSelection,
} from "@/features/bookings/components/branch-workspace";
import {
  FloorViewControl,
  FloorViewProvider,
} from "@/features/bookings/components/floor-view";
import { floorSelectionKey } from "@/features/bookings/floor-selection";
import { floorIdFromSegments } from "@/features/bookings/components/use-branch-route-scope";
import { SpaceDetailContainer } from "@/features/bookings/components/space-detail-container";
import {
  useBookingDraft,
  useBookingRange,
} from "@/features/bookings/components/use-booking-draft";
import type { BookingDraft } from "@/features/bookings/booking-draft-store";
import type { FloorBookingSelection } from "@/features/bookings/selection";

const route = vi.hoisted(() => ({
  pathname: "/branches/branch-a/floors/floor-a",
  segments: ["floors", "floor-a"],
  params: {} as Record<string, string>,
  query: "",
  push: vi.fn(),
  replace: vi.fn(),
  useParams: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useParams: () => route.useParams(route.params),
  usePathname: () => route.pathname,
  useSelectedLayoutSegments: () => route.segments,
  useSearchParams: () => new URLSearchParams(route.query),
  useRouter: () => ({ push: route.push, replace: route.replace }),
}));

const branchId = "branch-a";
const floorId = "floor-a";
const spaceId = "abcdefab-1234-4abc-9def-123456789abc";
const date = "2026-10-07";
const initialQuery = `date=${date}&space=${spaceId}&detail=1&view=timeline`;
const range = { start: "2026-10-07T01:00:00Z", end: "2026-10-07T02:00:00Z" };
let current: NonNullable<ReturnType<typeof useFloorSelection>> & {
  draft: BookingDraft;
  selection: FloorBookingSelection | null;
};

function Controls() {
  const workspace = useFloorSelection()!;
  const draft = useBookingDraft(workspace.draftStore, workspace.bookingScope);
  const selection = useBookingRange(
    workspace.draftStore,
    workspace.bookingScope,
  );
  const register = workspace.registerNavigation;
  useEffect(() => register(branchId, date, "2026-10-07T01:00:00Z"), [register]);
  useEffect(() => {
    current = { ...workspace, draft, selection };
  }, [workspace, draft, selection]);
  return (
    <>
      <output data-testid="scope">
        {JSON.stringify({
          branchId: workspace.branchId,
          location: workspace.location,
          query: workspace.search.toString(),
          active: workspace.routeActive,
          selection,
          draft,
        })}
      </output>
      <button
        onClick={() => {
          workspace.draftStore
            .getState()
            .changeRange(workspace.bookingScope, spaceId, range);
          workspace.draftStore.getState().changeDraft(workspace.bookingScope, {
            title: "남길 제목",
            actorId: "team",
          });
        }}
      >
        초안 입력
      </button>
    </>
  );
}

const narrowMedia = Object.defineProperty(new EventTarget(), "matches", {
  value: false,
}) as MediaQueryList;
const matchNarrow = () => narrowMedia;
function frame(mode: "visible" | "hidden" = "visible", sheet = false) {
  return (
    <Activity mode={mode}>
      <FloorViewProvider cookieView="timeline">
        <BranchWorkspace branchId="BRANCH-A">
          <Controls />
          <FloorViewControl />
          <ResolvedSpaceSelection
            selectionKey={floorSelectionKey(branchId, floorId, date, spaceId)}
            spaceId={spaceId}
          >
            상세
          </ResolvedSpaceSelection>
          {sheet && (
            <SpaceDetailContainer matchMedia={matchNarrow}>
              <p>보존된 공간 내용</p>
            </SpaceDetailContainer>
          )}
        </BranchWorkspace>
      </FloorViewProvider>
    </Activity>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  route.pathname = `/branches/${branchId}/floors/${floorId}`;
  route.segments = ["floors", floorId];
  route.params = { branchId, floorId };
  route.query = initialQuery;
  window.history.replaceState(null, "", `${route.pathname}?${route.query}`);
});

describe("branch-scoped retained routes", () => {
  it.each([
    [[], ""],
    [["floors", "FLOOR-A"], "floor-a"],
    [["other", "floor-a"], ""],
    [["floors"], ""],
  ])(
    "reads the floor only below its branch layout: %j",
    (segments, expected) => {
      expect(floorIdFromSegments(segments)).toBe(expected);
    },
  );

  it.each(["/", "/branches", "/bookings", "/teams", "/teams/team-a"])(
    "keeps its scope when the global route leaves for %s without dynamic branch params",
    (pathname) => {
      const view = render(frame());
      fireEvent.click(screen.getByRole("button", { name: "초안 입력" }));
      const before = screen.getByTestId("scope").textContent!;
      route.pathname = pathname;
      route.params = pathname.includes("team-a") ? { teamId: "team-a" } : {};
      route.query = "date=2099-01-01&space=invalid&detail=0&view=list";
      view.rerender(frame());
      expect(current.branchId).toBe(branchId);
      expect(current.location).toMatchObject({
        floorId,
        date,
        spaceId,
        detail: true,
      });
      expect(current.search.toString()).toBe(initialQuery);
      expect(current.routeActive).toBe(false);
      expect(current.isCurrentRoute()).toBe(false);
      expect(current.selection).toEqual({ spaceId, ...range });
      expect(current.draft).toEqual({ title: "남길 제목", actorId: "team" });
      expect(route.useParams).not.toHaveBeenCalled();
      for (const link of screen.getAllByRole("link"))
        expect(link.getAttribute("href")).toMatch(
          /^\/branches\/branch-a\/floors\/floor-a\?/,
        );
      route.pathname = `/branches/${branchId}/floors/${floorId}`;
      route.params = { branchId, floorId };
      route.query = initialQuery;
      view.rerender(frame());
      expect(screen.getByTestId("scope").textContent).toBe(before);
    },
  );

  it("does not mix another branch's global params or query with the preserved branch", () => {
    const view = render(frame());
    route.pathname = "/branches/branch-b/floors/floor-b";
    route.params = { branchId: "branch-b", floorId: "floor-b" };
    route.query = "date=2026-10-08&space=another&view=list";
    view.rerender(frame());
    expect(current.branchId).toBe(branchId);
    expect(current.location).toMatchObject({ floorId, date, spaceId });
    expect(current.selectionKey).toBe(
      floorSelectionKey(branchId, floorId, date, spaceId),
    );
    expect(current.routeActive).toBe(false);
    expect(route.useParams).not.toHaveBeenCalled();
  });

  it("preserves draft and range through Activity cleanup and re-registers the confirmed selection on back", async () => {
    const view = render(frame());
    fireEvent.click(screen.getByRole("button", { name: "초안 입력" }));
    route.pathname = "/bookings";
    route.params = {};
    route.query = "view=calendar&month=2026-11&day=2026-11-08";
    await act(async () => view.rerender(frame("hidden")));
    expect(current.isCurrentRoute()).toBe(false);
    expect(
      screen.queryByRole("button", { name: "초안 입력" }),
    ).not.toBeInTheDocument();
    route.pathname = `/branches/${branchId}/floors/${floorId}`;
    route.params = { branchId, floorId };
    route.query = initialQuery;
    view.rerender(frame());
    await waitFor(() => expect(current.selectedSpaceId).toBe(spaceId));
    expect(current.location).toMatchObject({
      floorId,
      date,
      spaceId,
      detail: true,
    });
    expect(current.selection).toEqual({ spaceId, ...range });
    expect(current.draft).toEqual({ title: "남길 제목", actorId: "team" });
    expect(current.isCurrentRoute()).toBe(true);
    expect(route.push).not.toHaveBeenCalled();
    expect(route.replace).not.toHaveBeenCalled();
  });

  it("rejects stale close and navigation callbacks after leaving the branch", () => {
    route.query = initialQuery.replace("&detail=1", "");
    const view = render(frame());
    const stale = current;
    route.pathname = "/teams/team-a";
    route.params = { teamId: "team-a" };
    route.query = "space=unrelated&detail=1";
    window.history.replaceState(null, "", `${route.pathname}?${route.query}`);
    view.rerender(frame());
    act(() => {
      stale.closeAfterBooking(spaceId, date);
      stale.change(
        { ...stale.location, spaceId: null },
        "/branches/branch-a/floors/floor-a",
        { replace: true },
      );
      stale.restoreSpaceTrigger();
    });
    fireEvent.click(screen.getByRole("link", { name: "목록 보기" }));
    expect(window.location.pathname).toBe("/teams/team-a");
    expect(window.location.search).toBe("?space=unrelated&detail=1");
    expect(document.cookie).not.toContain("floor_view=list");
    expect(route.push).not.toHaveBeenCalled();
    expect(route.replace).not.toHaveBeenCalled();
  });

  it("hides the whole branch's mobile Sheet on route leave and restores only one on back", async () => {
    const view = render(frame("visible", true));
    expect(
      await screen.findByRole("dialog", { name: "공간 상세" }),
    ).toBeVisible();
    route.pathname = "/teams/team-a";
    route.params = { teamId: "team-a" };
    route.query = "view=list";
    await act(async () => view.rerender(frame("hidden", true)));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    route.pathname = `/branches/${branchId}/floors/${floorId}`;
    route.params = { branchId, floorId };
    route.query = initialQuery;
    view.rerender(frame("visible", true));
    await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(1));
    expect(screen.getByText("보존된 공간 내용")).toBeVisible();
    expect(route.push).not.toHaveBeenCalled();
    expect(route.replace).not.toHaveBeenCalled();
  });

  it("applies a changed floor only when its own layout and the global pathname agree", () => {
    const view = render(frame());
    fireEvent.click(screen.getByRole("button", { name: "초안 입력" }));
    route.pathname = `/branches/${branchId}/floors/floor-next`;
    route.query = "date=2026-10-08";
    view.rerender(frame());
    expect(current.location.floorId).toBe(floorId);
    route.segments = ["floors", "floor-next"];
    view.rerender(frame());
    expect(current.location).toMatchObject({
      floorId: "floor-next",
      date: "2026-10-08",
      spaceId: null,
    });
    expect(current.selection).toBeNull();
    expect(current.draft).toEqual({ title: "", actorId: null });
  });
});

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NavigateAction } from "@/components/optimistic-navigation";
import { BranchNavigation } from "@/features/bookings/components/branch-navigation";
import {
  BranchWorkspace,
  ResolvedSpaceSelection,
} from "@/features/bookings/components/branch-workspace";
import { FloorDay } from "@/features/bookings/components/floor-day";
import {
  EmptySpaceSelection,
  FloorDetailRegion,
  FloorListRegion,
} from "@/features/bookings/components/floor-regions";
import { SpaceDetail } from "@/features/bookings/components/space-detail";
import { floorSelectionKey } from "@/features/bookings/floor-selection";
import { floorDayFixture, spaceDayFixture } from "./booking-ui-fixtures";

const navigation = vi.hoisted(() => ({
  branchId: "branch",
  floorId: "floor",
  query: "date=2026-10-07",
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({
    branchId: navigation.branchId,
    floorId: navigation.floorId,
  }),
  useSearchParams: () => new URLSearchParams(navigation.query),
  useRouter: () => navigation.router,
}));
vi.mock("@/features/bookings/components/booking-form", () => ({
  BookingForm: () => <p>예약 양식</p>,
}));
vi.mock("@/features/bookings/components/floor-view", () => ({
  useFloorView: () => ({ view: "list", effectiveView: "list" }),
}));

const spaceId = "abcdefab-1234-4abc-9def-123456789abc";
const otherSpaceId = "abcdefab-1234-4abc-9def-123456789abd";
const today = "2026-10-07";
function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function finish(response: ReturnType<typeof deferred>) {
  await act(async () => {
    response.resolve();
    await response.promise;
  });
}
function page(
  navigateAction?: NavigateAction,
  actualSpaceId: string | null = null,
) {
  const list = floorDayFixture();
  const detail = spaceDayFixture();
  const query = new URLSearchParams(navigation.query);
  list.spaces = [
    { ...detail.space, id: spaceId, intervals: [], summary: null },
    {
      ...detail.space,
      id: otherSpaceId,
      name: "회의실 D",
      intervals: [],
      summary: null,
    },
  ];
  detail.space.id = actualSpaceId ?? spaceId;
  detail.space.name = actualSpaceId === otherSpaceId ? "회의실 D" : "회의실 C";
  return (
    <BranchWorkspace navigateAction={navigateAction}>
      <BranchNavigation
        data={{
          branch: list.branch,
          floors: [
            list.floor,
            { id: "floor-8", name: "8F", level: 8, sortOrder: 2 },
          ],
          branches: [],
          today,
          bookingDates: [],
          now: detail.now,
        }}
      />
      <div data-testid="list">
        <FloorListRegion>
          <FloorDay data={list} />
        </FloorListRegion>
      </div>
      <div data-testid="detail">
        <FloorDetailRegion>
          <ResolvedSpaceSelection
            selectionKey={floorSelectionKey(
              navigation.branchId,
              navigation.floorId,
              query.get("date") ?? undefined,
              query.get("space") ?? undefined,
            )}
            spaceId={actualSpaceId}
          >
            {actualSpaceId ? (
              <SpaceDetail data={detail} />
            ) : (
              <EmptySpaceSelection />
            )}
          </ResolvedSpaceSelection>
        </FloorDetailRegion>
      </div>
    </BranchWorkspace>
  );
}
function region(name: "list" | "detail") {
  return within(screen.getByTestId(name));
}
function expectNoBusy() {
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(document.querySelector('[aria-busy="true"]')).toBeNull();
}

beforeEach(() => {
  vi.clearAllMocks();
  navigation.branchId = "branch";
  navigation.floorId = "floor";
  navigation.query = `date=${today}`;
});

describe("floor optimistic navigation", () => {
  it("lets the timetable grid item shrink so horizontal overflow stays inside the timetable", () => {
    render(
      <FloorListRegion>
        <div data-testid="wide-timetable" style={{ minWidth: 1380 }} />
      </FloorListRegion>,
    );
    const gridItem = screen.getByTestId("wide-timetable").parentElement
      ?.parentElement;
    expect(gridItem).toHaveClass("min-w-0", "min-h-0");
  });

  it("selects a space before the response and replaces only the detail, then uses server selection", async () => {
    const response = deferred();
    const navigate = vi.fn<NavigateAction>(() => response.promise);
    const view = render(page(navigate));
    const link = screen.getByRole("link", { name: /회의실 C/ });
    expect(link).toHaveAttribute(
      "href",
      `/branches/branch/floors/floor?date=${today}&space=${spaceId}`,
    );
    await act(async () => {
      fireEvent.click(link);
    });
    expect(link).toHaveAttribute("aria-current", "true");
    expect(
      region("list").getByRole("region", { name: "공간 목록" }),
    ).toBeVisible();
    expect(region("list").queryByRole("status")).not.toBeInTheDocument();
    expect(region("detail").getByRole("status")).toHaveTextContent(
      "불러오고 있어요",
    );
    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      link.getAttribute("href"),
      { replace: undefined },
    );
    navigation.query = `date=${today}&space=${spaceId}`;
    view.rerender(page(navigate, spaceId));
    await finish(response);
    expect(screen.getByRole("link", { name: /회의실 C/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("region", { name: "공간 상세" })).toBeVisible();
    expectNoBusy();
  });

  it("keeps the confirmed space on a date change and replaces both regions immediately", async () => {
    navigation.query += `&space=${spaceId}`;
    const response = deferred();
    const navigate = vi.fn<NavigateAction>(() => response.promise);
    render(page(navigate, spaceId));
    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "10월 8일 목요일" }));
    });
    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      `/branches/branch/floors/floor?date=2026-10-08&space=${spaceId}`,
      { replace: undefined },
    );
    expect(region("list").getByRole("status")).toBeVisible();
    expect(region("detail").getByRole("status")).toBeVisible();
    expect(screen.getByRole("link", { name: /^오늘 ·/ })).toHaveAttribute(
      "href",
      `/branches/branch/floors/floor?date=${today}&space=${spaceId}`,
    );
    expect(screen.getByRole("link", { name: /^오늘 ·/ })).not.toHaveAttribute(
      "aria-current",
    );
    await finish(response);
    expectNoBusy();
  });

  it("changes the active floor immediately, clearing detail while only the list loads", async () => {
    navigation.query += `&space=${spaceId}`;
    const response = deferred();
    const navigate = vi.fn<NavigateAction>(() => response.promise);
    render(page(navigate, spaceId));
    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "8F" }));
    });
    expect(screen.getByRole("link", { name: "8F" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "7F" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(region("list").getByRole("status")).toBeVisible();
    expect(
      region("detail").getByRole("heading", { name: "공간을 골라 주세요" }),
    ).toBeVisible();
    expect(region("detail").queryByRole("status")).not.toBeInTheDocument();
    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      `/branches/branch/floors/floor-8?date=${today}`,
      { replace: undefined },
    );
    await finish(response);
  });

  it("loads only the list when the date changes without a selected space", async () => {
    const response = deferred();
    render(page(() => response.promise));
    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "10월 8일 목요일" }));
    });
    expect(region("list").getByRole("status")).toBeVisible();
    expect(region("detail").queryByRole("status")).not.toBeInTheDocument();
    expect(
      region("detail").getByRole("heading", { name: "공간을 골라 주세요" }),
    ).toBeVisible();
    await finish(response);
  });

  it("discards an optimistic selection when the server rejects the requested space", async () => {
    const response = deferred();
    const navigate = () => response.promise;
    const view = render(page(navigate));
    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: /회의실 C/ }));
    });
    navigation.query = `date=${today}&space=${spaceId}`;
    view.rerender(page(navigate, null));
    await finish(response);
    expect(screen.getByRole("link", { name: /회의실 C/ })).not.toHaveAttribute(
      "aria-current",
    );
    expect(
      region("detail").getByRole("heading", { name: "공간을 골라 주세요" }),
    ).toBeVisible();
    expectNoBusy();
  });

  it("closes with replace and immediately shows an empty detail without hiding the list", async () => {
    navigation.query += `&space=${spaceId}`;
    const response = deferred();
    const navigate = vi.fn<NavigateAction>(() => response.promise);
    const view = render(page(navigate, spaceId));
    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "공간 상세 닫기" }));
    });
    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      `/branches/branch/floors/floor?date=${today}`,
      { replace: true },
    );
    expect(
      region("detail").getByRole("heading", { name: "공간을 골라 주세요" }),
    ).toBeVisible();
    expect(
      region("detail").queryByRole("region", { name: "공간 상세" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /회의실 C/ })).not.toHaveAttribute(
      "aria-current",
    );
    expectNoBusy();
    navigation.query = `date=${today}`;
    view.rerender(page(navigate));
    await finish(response);
    expectNoBusy();
  });

  it("uses confirmed direct links and back navigation without an optimistic skeleton", () => {
    navigation.query += `&space=${spaceId}`;
    const view = render(page(undefined, spaceId));
    expect(screen.getByRole("link", { name: /회의실 C/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expectNoBusy();
    navigation.query = `date=${today}&space=${otherSpaceId}`;
    view.rerender(page(undefined, otherSpaceId));
    expect(screen.getByRole("link", { name: /회의실 D/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expectNoBusy();
    navigation.query = `date=${today}&space=${spaceId}`;
    view.rerender(page(undefined, spaceId));
    expect(screen.getByRole("link", { name: /회의실 C/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expectNoBusy();
  });

  it.each(["invalid", otherSpaceId])(
    "does not select an invalid or inaccessible direct space %s",
    (requested) => {
      navigation.query = `date=2099-01-01&space=${requested}`;
      render(page());
      expect(
        screen.getByRole("link", { name: /회의실 C/ }),
      ).not.toHaveAttribute("aria-current");
      expect(
        screen.getByRole("link", { name: /회의실 D/ }),
      ).not.toHaveAttribute("aria-current");
      expect(
        region("detail").getByRole("heading", { name: "공간을 골라 주세요" }),
      ).toBeVisible();
      expect(screen.getByRole("link", { name: /^오늘 ·/ })).toHaveAttribute(
        "aria-current",
        "date",
      );
      expectNoBusy();
    },
  );

  it("does not replace unchanged regions for the same selection or a refresh", async () => {
    navigation.query += `&space=${spaceId}`;
    const response = deferred();
    const navigate = vi.fn<NavigateAction>(() => response.promise);
    const view = render(page(navigate, spaceId));
    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: /회의실 C/ }));
    });
    expectNoBusy();
    await finish(response);
    navigation.router.refresh();
    view.rerender(page(navigate, spaceId));
    expectNoBusy();
    expect(screen.getByRole("region", { name: "공간 상세" })).toBeVisible();
  });

  it.each([
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
  ])("leaves modified navigation %j to the real link", async (options) => {
    const navigate = vi.fn<NavigateAction>();
    render(page(navigate));
    const link = screen.getByRole("link", { name: /회의실 C/ });
    const defaultState: boolean[] = [];
    // JSDOM은 문서 이동을 지원하지 않으므로 앱의 이벤트 처리 뒤 기본 동작만 막는다.
    document.addEventListener(
      "click",
      (event) => {
        defaultState.push(event.defaultPrevented);
        event.preventDefault();
      },
      { once: true },
    );
    await act(async () => {
      fireEvent.click(link, options);
    });
    expect(defaultState).toEqual([false]);
    expect(navigate).not.toHaveBeenCalled();
    expect(link).not.toHaveAttribute("aria-current");
    expectNoBusy();
  });

  it("routes ordinary clicks through push and close through replace by default", async () => {
    navigation.query += `&space=${spaceId}`;
    render(page(undefined, spaceId));
    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: /회의실 D/ }));
    });
    expect(navigation.router.push).toHaveBeenCalledWith(
      `/branches/branch/floors/floor?date=${today}&space=${otherSpaceId}`,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "공간 상세 닫기" }));
    });
    expect(navigation.router.replace).toHaveBeenCalledWith(
      `/branches/branch/floors/floor?date=${today}`,
    );
  });
});

import { Activity, useEffect, useEffectEvent, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFloorRealtime } from "@/features/floor-plan/use-floor-realtime";
import type { FloorDayData } from "@/features/bookings/types";
import type { RealtimeEvent } from "@/lib/realtime/types";
import type { RealtimeLifecycleEvent } from "@/lib/realtime/ably-browser";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";
import { floorDayFixture } from "./booking-ui-fixtures";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  change: vi.fn(),
  restore: vi.fn(),
  current: vi.fn(() => true),
}));
const first = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const listeners = new Map<string, (event: RealtimeEvent) => void>();
let lifecycle: ((event: RealtimeLifecycleEvent) => void) | undefined;
let selection: {
  branchId: string;
  routeActive: boolean;
  navigationPending: boolean;
  location: {
    floorId: string;
    date: string;
    spaceId: string | null;
    detail: boolean;
  };
  search: URLSearchParams;
  isCurrentRoute: typeof mocks.current;
  change: typeof mocks.change;
  restoreSpaceTrigger: typeof mocks.restore;
};
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("@/features/bookings/components/branch-workspace", () => ({
  useFloorSelection: () => selection,
}));
vi.mock("@/components/realtime-provider", () => ({
  useRealtimeChannel(
    channel: string | null,
    onEvent: (event: RealtimeEvent) => void,
  ) {
    const receive = useEffectEvent(onEvent);
    useEffect(() => {
      if (!channel) return;
      listeners.set(channel, (event) => receive(event));
      return () => {
        listeners.delete(channel);
      };
    }, [channel]);
  },
  useRealtimeLifecycle(onEvent: (event: RealtimeLifecycleEvent) => void) {
    const receive = useEffectEvent(onEvent);
    useEffect(() => {
      lifecycle = (event) => receive(event);
      return () => {
        lifecycle = undefined;
      };
    }, []);
  },
}));

function data(): FloorDayData {
  const result = floorDayFixture();
  result.floor = { ...result.floor, plan: { id: "plan-1", version: 1 } };
  result.spaces = result.spaces.map((space, index) => ({
    ...space,
    id: index === 0 ? first : other,
  }));
  return result;
}
function document(spaceId: string = first): FloorPlanDocument {
  return {
    schema: 1,
    unit: "mm",
    bounds: { w: 1000, h: 600 },
    walls: [],
    openings: [],
    fixtures: [],
    seats: [],
    spaces: [
      {
        id: "shape",
        spaceId,
        polygon: [
          [20, 20],
          [220, 20],
          [220, 220],
          [20, 220],
        ],
        label: { at: [120, 120] },
      },
    ],
  };
}
function mount(initial = data()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  let mode: "visible" | "hidden" = "visible";
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <Activity mode={mode}>{children}</Activity>
    </QueryClientProvider>
  );
  const view = renderHook(({ data }) => useFloorRealtime(data), {
    initialProps: { data: initial },
    wrapper,
  });
  return {
    ...view,
    client,
    activity(next: typeof mode) {
      mode = next;
      view.rerender({ data: initial });
    },
  };
}
function event(value: RealtimeEvent, floorId = "floor") {
  act(() => listeners.get(`floor:${floorId}`)?.(value));
}
function attached(resumed: boolean, floorId = "floor") {
  act(() =>
    lifecycle?.({
      type: "channel",
      channel: `floor:${floorId}`,
      state: "attached",
      resumed,
    }),
  );
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
async function commit() {
  await act(async () => {});
}
function published(initial: FloorDayData, version = 2) {
  return {
    ...initial,
    floor: { ...initial.floor, plan: { id: `plan-${version}`, version } },
    now: "2026-10-07T01:11:00.000Z",
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  listeners.clear();
  lifecycle = undefined;
  mocks.current.mockReturnValue(true);
  selection = {
    branchId: "branch",
    routeActive: true,
    navigationPending: false,
    location: {
      floorId: "floor",
      date: "2026-10-07",
      spaceId: first,
      detail: true,
    },
    search: new URLSearchParams(
      `date=2026-10-07&space=${first}&detail=1&view=timeline&people=6`,
    ),
    isCurrentRoute: mocks.current,
    change: mocks.change,
    restoreSpaceTrigger: mocks.restore,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(document())),
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("shared floor realtime refresh", () => {
  it("combines all three event types into one 300ms refresh while preserving client selection", async () => {
    const { result } = mount();
    expect([...listeners.keys()]).toEqual(["floor:floor"]);
    event({ type: "booking.changed", spaceId: first });
    await advance(100);
    event({ type: "space.status_changed", spaceId: other });
    event({ type: "plan.published", floorId: "floor", version: 2 });
    await advance(199);
    expect(mocks.refresh).not.toHaveBeenCalled();
    await advance(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.change).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.flashSpaceIds).toEqual([]);
    await advance(1000);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
  it("flashes only after fresh server data arrives, then clears at 200ms", async () => {
    const initial = data();
    const { result, rerender } = mount(initial);
    event({ type: "booking.changed", spaceId: first });
    event({ type: "booking.changed", spaceId: "absent" });
    await advance(300);
    rerender({ data: initial });
    expect(result.current.flashSpaceIds).toEqual([]);
    rerender({ data: { ...initial, now: "2026-10-07T01:11:00.000Z" } });
    expect(result.current.flashSpaceIds).toEqual([first]);
    await advance(199);
    expect(result.current.flashSpaceIds).toEqual([first]);
    await advance(1);
    expect(result.current.flashSpaceIds).toEqual([]);
  });
  it("refreshes without animation when reduced motion is requested", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    const initial = data();
    const { result, rerender } = mount(initial);
    event({ type: "booking.changed", spaceId: first });
    await advance(300);
    rerender({ data: { ...initial } });
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(result.current.flashSpaceIds).toEqual([]);
  });
  it("ignores first attach/resumed continuity and catches a later lost attachment once", async () => {
    mount();
    attached(false);
    attached(true);
    attached(false, "another");
    await advance(300);
    expect(mocks.refresh).not.toHaveBeenCalled();
    attached(false);
    attached(false);
    event({ type: "booking.changed", spaceId: first });
    await advance(300);
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it("catches missed events when Activity restores an already attached floor", async () => {
    const view = mount();
    attached(false);
    view.activity("hidden");
    expect(listeners.size).toBe(0);
    event({ type: "booking.changed", spaceId: first });
    await advance(1000);
    expect(mocks.refresh).not.toHaveBeenCalled();
    view.activity("visible");
    attached(false);
    attached(false);
    await advance(300);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    const next = data();
    next.floor = { ...next.floor, id: "next-floor" };
    selection.location.floorId = "next-floor";
    view.rerender({ data: next });
    attached(false, "next-floor");
    await advance(300);
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it("does not interrupt an in-flight server navigation", async () => {
    selection.navigationPending = true;
    const initial = data();
    const { rerender } = mount(initial);
    event({ type: "booking.changed", spaceId: first });
    await advance(300);
    expect(mocks.refresh).not.toHaveBeenCalled();
    selection = { ...selection, navigationPending: false };
    rerender({ data: initial });
    await advance(300);
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it("cleans queued work when the route departs or the floor changes", async () => {
    const initial = data();
    const { rerender } = mount(initial);
    event({ type: "booking.changed", spaceId: first });
    mocks.current.mockReturnValue(false);
    await advance(300);
    expect(mocks.refresh).not.toHaveBeenCalled();
    selection = { ...selection, routeActive: false };
    rerender({ data: initial });
    expect(listeners.size).toBe(0);
    selection = {
      ...selection,
      routeActive: true,
      location: { ...selection.location, floorId: "other-floor" },
    };
    mocks.current.mockReturnValue(true);
    rerender({
      data: { ...initial, floor: { ...initial.floor, id: "other-floor" } },
    });
    await advance(1000);
    expect([...listeners.keys()]).toEqual(["floor:other-floor"]);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("releases subscriptions and old queued refreshes during Activity hiding and unmount", async () => {
    const view = mount();
    event({ type: "booking.changed", spaceId: first });
    view.activity("hidden");
    await advance(300);
    expect(listeners.size).toBe(0);
    expect(mocks.refresh).not.toHaveBeenCalled();
    view.activity("visible");
    expect([...listeners.keys()]).toEqual(["floor:floor"]);
    event({ type: "space.status_changed", spaceId: first });
    view.unmount();
    await advance(300);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("keeps subscription on closed days and ignores unrelated/stale/malformed publications", async () => {
    mount({ ...data(), openHours: null });
    event({ type: "friend.changed" });
    for (const version of [-1, 0, 1, 1.5, Infinity])
      event({ type: "plan.published", floorId: "floor", version });
    event({ type: "plan.published", floorId: "wrong", version: 2 });
    await advance(300);
    expect(mocks.refresh).not.toHaveBeenCalled();
    event({ type: "booking.changed", spaceId: first });
    await advance(300);
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
});

describe("published plan selection validation", () => {
  it("waits for the new id and successful document before clearing a missing space in any view", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json(document(other)));
    const initial = data();
    const { rerender } = mount(initial);
    event({ type: "plan.published", floorId: "floor", version: 2 });
    await advance(300);
    rerender({ data: { ...initial } });
    await commit();
    expect(fetch).not.toHaveBeenCalled();
    rerender({ data: published(initial) });
    await commit();
    expect(fetch).toHaveBeenCalledWith(
      "/api/floor-plans/plan-2",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        cache: "default",
        credentials: "same-origin",
        method: "GET",
      }),
    );
    expect(mocks.change).toHaveBeenCalledExactlyOnceWith(
      { floorId: "floor", date: initial.date, spaceId: null, detail: false },
      `/branches/branch/floors/floor?date=${initial.date}&view=timeline&people=6`,
      { replace: true },
    );
    expect(mocks.restore).toHaveBeenCalledOnce();
  });
  it("reuses the immutable query cache and retains an existing shape", async () => {
    const initial = data();
    const { client, rerender } = mount(initial);
    client.setQueryData(["floor-plan", "plan-2"], document());
    event({ type: "plan.published", floorId: "floor", version: 2 });
    await advance(300);
    rerender({ data: published(initial) });
    await commit();
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.change).not.toHaveBeenCalled();
  });
  it("never clears selection for failed document reads", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 500 }));
    const initial = data();
    const { rerender } = mount(initial);
    event({ type: "plan.published", floorId: "floor", version: 2 });
    await advance(300);
    rerender({ data: published(initial) });
    await commit();
    expect(mocks.change).not.toHaveBeenCalled();
  });
  it("ignores a late document after a different selection, even if the user returns to the same space", async () => {
    let resolve!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const initial = data();
    const view = mount(initial);
    event({ type: "plan.published", floorId: "floor", version: 2 });
    await advance(300);
    const next = published(initial);
    view.rerender({ data: next });
    await commit();
    selection = {
      ...selection,
      location: { ...selection.location, spaceId: other },
    };
    view.rerender({ data: next });
    selection = {
      ...selection,
      location: { ...selection.location, spaceId: first },
    };
    view.rerender({ data: next });
    await act(async () => resolve(Response.json(document(other))));
    expect(mocks.change).not.toHaveBeenCalled();
  });
  it("discards earlier publication responses when a newer version or route has won", async () => {
    const reads = new Map<string, (value: Response) => void>();
    vi.mocked(fetch).mockImplementation(
      (url) =>
        new Promise((resolve) => {
          reads.set(String(url), resolve);
        }),
    );
    const initial = data();
    const view = mount(initial);
    event({ type: "plan.published", floorId: "floor", version: 2 });
    await advance(300);
    view.rerender({ data: published(initial) });
    await commit();
    event({ type: "plan.published", floorId: "floor", version: 3 });
    await advance(300);
    view.rerender({ data: published(initial, 3) });
    await commit();
    await act(async () =>
      reads.get("/api/floor-plans/plan-2")!(Response.json(document(other))),
    );
    expect(mocks.change).not.toHaveBeenCalled();
    selection = { ...selection, routeActive: false };
    view.rerender({ data: published(initial, 3) });
    await act(async () =>
      reads.get("/api/floor-plans/plan-3")!(Response.json(document(other))),
    );
    expect(mocks.change).not.toHaveBeenCalled();
  });
  it("does not fetch a document when there is no selection to validate", async () => {
    selection.location.spaceId = null;
    const initial = data();
    const { rerender } = mount(initial);
    event({ type: "plan.published", floorId: "floor", version: 2 });
    await advance(300);
    rerender({ data: published(initial) });
    await commit();
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.change).not.toHaveBeenCalled();
  });
});

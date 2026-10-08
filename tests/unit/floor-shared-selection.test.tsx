import { useEffect } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BranchWorkspace,
  ResolvedSpaceSelection,
  useFloorSelection,
} from "@/features/bookings/components/branch-workspace";
import { floorSelectionKey } from "@/features/bookings/floor-selection";
import { useBookingRange } from "@/features/bookings/components/use-booking-draft";
import {
  selectFloorBookingSlot,
  selectableSlots,
} from "@/features/bookings/selection";
import { spaceDayFixture } from "./booking-ui-fixtures";

const route = vi.hoisted(() => ({
  query: "",
  floorId: "floor",
  push: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useSelectedLayoutSegments: () =>
    route.floorId ? ["floors", route.floorId] : [],
  usePathname: () =>
    `/branches/${"branch"}${route.floorId ? `/floors/${route.floorId}` : ""}`,
  useParams: () => ({ branchId: "branch", floorId: route.floorId }),
  useSearchParams: () => new URLSearchParams(route.query),
  useRouter: () => ({ push: route.push, replace: route.replace }),
}));
const first = "abcdefab-1234-4abc-9def-123456789abc";
const second = "abcdefab-1234-4abc-9def-123456789abd";
const third = "abcdefab-1234-4abc-9def-123456789abe";
const today = "2026-10-07";
const slots = selectableSlots({
  ...spaceDayFixture(),
  bookings: [],
  blocks: [],
}).filter(({ state }) => state === "free");
const start = slots[0]!.start;
let completePrevious: (() => void) | undefined;
function Controls() {
  const state = useFloorSelection()!;
  const range = useBookingRange(state.draftStore, state.bookingScope);
  const register = state.registerNavigation;
  useEffect(() => register("branch", today, spaceDayFixture().now), [register]);
  return (
    <>
      <output data-testid="range">{JSON.stringify(range)}</output>
      <output data-testid="detail">
        {String(state.location.detail === true)}
      </output>
      <output data-testid="pending">{String(state.detailPending)}</output>
      <button
        onClick={() =>
          state.selectSlot({
            spaceId: third,
            slots,
            start,
            href: `?date=${today}&space=${third}`,
          })
        }
      >
        세 번째 행
      </button>
      <button
        onClick={() =>
          state.change(
            { ...state.location, detail: true },
            `?date=${today}&space=${first}&detail=1`,
          )
        }
      >
        상세 열기
      </button>
      <button
        onClick={() => {
          const scope = state.bookingScope;
          completePrevious = () =>
            state.draftStore.getState().changeRange(scope, first, null);
        }}
      >
        제출 시작
      </button>
      <button
        onClick={() =>
          state.selectSlot({
            spaceId: first,
            slots,
            start,
            href: `?date=${today}&space=${first}`,
          })
        }
      >
        첫 칸
      </button>
      <button
        onClick={() =>
          state.selectSlot({
            spaceId: second,
            slots,
            start,
            href: `?date=${today}&space=${second}`,
          })
        }
      >
        다른 행
      </button>
      <button
        onClick={() =>
          state.draftStore
            .getState()
            .changeRange(state.bookingScope, first, {
              start,
              end: slots[2]!.end,
            })
        }
      >
        끝 바꾸기
      </button>
      <button
        onClick={() =>
          state.change({ ...state.location, spaceId: null }, `?date=${today}`, {
            replace: true,
          })
        }
      >
        닫기
      </button>
      <button
        onClick={() =>
          state.draftStore
            .getState()
            .changeRange(state.bookingScope, first, null)
        }
      >
        예약 성공
      </button>
      <button
        onClick={() =>
          state.change(
            { ...state.location, date: "2026-10-08" },
            "?date=2026-10-08",
          )
        }
      >
        날짜 바꾸기
      </button>
    </>
  );
}
function Frame({
  actual = first,
  navigateAction,
}: {
  actual?: string;
  navigateAction?: () => Promise<void>;
}) {
  const search = new URLSearchParams(route.query);
  return (
    <BranchWorkspace branchId="branch" navigateAction={navigateAction}>
      <Controls />
      <ResolvedSpaceSelection
        selectionKey={floorSelectionKey(
          "branch",
          route.floorId,
          search.get("date") ?? undefined,
          search.get("space") ?? undefined,
        )}
        spaceId={actual}
      >
        <span>상세</span>
      </ResolvedSpaceSelection>
    </BranchWorkspace>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  route.floorId = "floor";
  route.query = `date=${today}&space=${first}`;
});
const selection = () =>
  JSON.parse(screen.getByTestId("range").textContent ?? "null") as {
    spaceId: string;
    start: string;
    end: string;
  } | null;

describe("shared floor booking range", () => {
  it("preserves the range without a skeleton on detail-only navigation", async () => {
    let complete = () => {};
    const pending = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const view = render(<Frame navigateAction={() => pending} />);
    fireEvent.click(screen.getByText("첫 칸"));
    const original = selection();
    fireEvent.click(screen.getByText("상세 열기"));
    expect(screen.getByTestId("detail")).toHaveTextContent("true");
    expect(screen.getByTestId("pending")).toHaveTextContent("false");
    expect(selection()).toEqual(original);
    route.query += "&detail=1";
    view.rerender(<Frame navigateAction={() => pending} />);
    await act(async () => {
      complete();
      await pending;
    });
    expect(selection()).toEqual(original);
    fireEvent.click(screen.getByText("닫기"));
    expect(screen.getByTestId("detail")).toHaveTextContent("false");
  });
  it("ignores detail without a confirmed space", () => {
    route.query = `date=${today}&detail=1`;
    render(<Frame />);
    expect(screen.getByTestId("detail")).toHaveTextContent("false");
  });
  it("shares slot and select-box changes while preserving the range across a view change", () => {
    const view = render(<Frame />);
    fireEvent.click(screen.getByText("첫 칸"));
    expect(selection()).toMatchObject({ spaceId: first, start });
    fireEvent.click(screen.getByText("끝 바꾸기"));
    expect(selection()?.end).toBe(slots[2]!.end);
    route.query += "&view=timeline";
    view.rerender(<Frame />);
    expect(selection()?.end).toBe(slots[2]!.end);
    expect(route.push).not.toHaveBeenCalled();
  });
  it("sets the next row atomically and retains it when its server response arrives", async () => {
    let complete = () => {};
    const pending = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const navigateAction = vi.fn(() => pending);
    const view = render(<Frame navigateAction={navigateAction} />);
    fireEvent.click(screen.getByText("첫 칸"));
    fireEvent.click(screen.getByText("제출 시작"));
    fireEvent.click(screen.getByText("다른 행"));
    expect(selection()).toMatchObject({ spaceId: second, start });
    route.query = `date=${today}&space=${second}`;
    view.rerender(<Frame actual={second} navigateAction={navigateAction} />);
    await act(async () => {
      complete();
      await pending;
    });
    expect(selection()).toMatchObject({ spaceId: second, start });
    expect(navigateAction).toHaveBeenCalledTimes(1);
    act(() => completePrevious?.());
    expect(selection()).toMatchObject({ spaceId: second, start });
  });
  it.each(["닫기", "예약 성공", "날짜 바꾸기"])("clears on %s", (button) => {
    render(<Frame />);
    fireEvent.click(screen.getByText("첫 칸"));
    expect(selection()).not.toBeNull();
    fireEvent.click(screen.getByText(button));
    expect(selection()).toBeNull();
  });
  it("keeps the latest optimistic range through an intermediate URL commit", async () => {
    const pending = Promise.withResolvers<void>();
    const navigateAction = vi.fn(() => pending.promise);
    const view = render(<Frame navigateAction={navigateAction} />);
    fireEvent.click(screen.getByText("다른 행"));
    fireEvent.click(screen.getByText("세 번째 행"));
    expect(selection()).toMatchObject({ spaceId: third, start });
    route.query = `date=${today}&space=${second}`;
    view.rerender(<Frame actual={second} navigateAction={navigateAction} />);
    expect(selection()).toMatchObject({ spaceId: third, start });
    route.query = `date=${today}&space=${third}`;
    view.rerender(<Frame actual={third} navigateAction={navigateAction} />);
    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    expect(selection()).toMatchObject({ spaceId: third, start });
    expect(navigateAction).toHaveBeenCalledTimes(2);
  });
  it("does not resurrect a range after browser navigation to another floor and back", () => {
    const view = render(<Frame />);
    fireEvent.click(screen.getByText("첫 칸"));
    route.floorId = "other-floor";
    view.rerender(<Frame />);
    expect(selection()).toBeNull();
    route.floorId = "floor";
    view.rerender(<Frame />);
    expect(selection()).toBeNull();
  });
  it("restarts on another row and only extends an uninterrupted interval on the same row", () => {
    const initial = selectFloorBookingSlot(first, slots, null, start)!;
    expect(
      selectFloorBookingSlot(first, slots, initial, slots[2]!.start),
    ).toEqual({ ...initial, end: slots[2]!.end });
    const moved = selectFloorBookingSlot(
      second,
      slots,
      initial,
      slots[2]!.start,
    );
    expect(moved).toMatchObject({ spaceId: second, start: slots[2]!.start });
    const blocked = slots.map((slot, index) =>
      index === 1 ? { ...slot, state: "reserved" as const } : slot,
    );
    expect(
      selectFloorBookingSlot(first, blocked, initial, slots[2]!.start)?.start,
    ).toBe(slots[2]!.start);
  });
});

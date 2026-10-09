import { Activity } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FloorPlanView } from "@/features/floor-plan/components/floor-plan-view";
import { DeskPicker } from "@/features/bookings/components/desk-picker";
import {
  bookingDraftScope,
  createBookingDraftStore,
  type BookingDraftStore,
} from "@/features/bookings/booking-draft-store";
import type { DeskDayData } from "@/features/bookings/types";
import { floorPlanSchema } from "@/lib/floor-plan/schema";
import planSource from "@/docs/spec/examples/gangnam-7f.plan.json";
import { floorDayFixture, spaceDayFixture } from "./booking-ui-fixtures";

const navigation = vi.hoisted(() => ({
  draftStore: null as BookingDraftStore | null,
  change: vi.fn(),
  rememberSpaceTrigger: vi.fn(),
  restoreSpaceTrigger: vi.fn(),
  isCurrentRoute: vi.fn(() => true),
  refresh: vi.fn(),
  location: {
    floorId: "floor",
    date: "2026-10-07",
    spaceId: null as string | null,
    detail: true,
  },
  search: new URLSearchParams("view=plan&people=6"),
}));
vi.mock("@/features/bookings/components/branch-workspace", () => ({
  useFloorSelection: () => navigation,
}));
vi.mock("@/features/bookings/components/floor-view", () => ({
  useFloorView: () => ({ effectiveView: "plan", hasPlan: true }),
}));
vi.mock("@/features/floor-plan/components/plan-touch-hint", () => ({
  PlanTouchHint: () => null,
}));
vi.mock("@/features/floor-plan/components/use-plan-colors", () => ({
  usePlanColors: () => null,
}));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/features/bookings/actions", () => ({
  createDeskBooking: vi.fn(),
  cancelBooking: vi.fn(),
}));
const document = floorPlanSchema.parse(planSource);
const area = document.spaces.find(({ id }) => id === "sh_desks")!;
function fixture() {
  const floor = floorDayFixture();
  const base = floor.spaces[0]!;
  if (base.kind !== "accessible") throw new Error("fixture");
  floor.spaces = [
    {
      ...base,
      id: area.spaceId,
      name: "오픈 데스크",
      type: "desk_area",
      bookable: false,
      deskCount: document.seats.length,
    },
  ];
  const detail = spaceDayFixture();
  detail.space = {
    ...detail.space,
    id: area.spaceId,
    name: "오픈 데스크",
    type: "desk_area",
    bookable: false,
    deskCount: document.seats.length,
  };
  const desk: DeskDayData = {
    parts: [
      {
        part: "am",
        start: "2026-10-07T00:00:00Z",
        end: "2026-10-07T04:00:00Z",
        selectable: true,
        freeCount: 1,
        myDeskName: null,
      },
      {
        part: "pm",
        start: "2026-10-07T04:00:00Z",
        end: "2026-10-07T05:00:00Z",
        selectable: true,
        freeCount: 2,
        myDeskName: null,
      },
    ],
    seats: document.seats
      .slice(0, 5)
      .map((seat, index) => ({
        id: seat.spaceId,
        name: `A-0${index + 1}`,
        row: 0,
        column: index,
        states: {
          am: index === 0 ? "booked" : "free",
          pm: (["free", "booked", "mine", "blocked", "unavailable"] as const)[
            index
          ]!,
        },
      })),
    myBookings: [],
  };
  detail.desk = desk;
  return { floor, detail, desk };
}
beforeEach(() => {
  vi.clearAllMocks();
  navigation.isCurrentRoute.mockReturnValue(true);
  navigation.location.spaceId = area.spaceId;
  navigation.location.detail = true;
  navigation.draftStore = createBookingDraftStore();
  const scope = bookingDraftScope(
    "branch",
    "floor",
    "2026-10-07",
    area.spaceId,
  );
  navigation.draftStore.getState().activate(scope);
  navigation.draftStore.getState().changeDeskPart(scope, "pm");
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function mount() {
  const input = fixture();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["floor-plan", "plan"], document);
  const frame = (mode: "visible" | "hidden" = "visible") => (
    <QueryClientProvider client={client}>
      <Activity mode={mode}>
        <FloorPlanView data={input.floor} planId="plan" />
        <DeskPicker data={input.detail} desk={input.desk} />
      </Activity>
    </QueryClientProvider>
  );
  return { ...render(frame()), frame, input };
}
describe("approved desk detail to floor plan selection", () => {
  it("uses the actual picker snapshot with no seat fetch and shares selection/toggle/part changes", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    mount();
    const seat = await screen.findByRole("button", { name: "A-01, 비어 있음" });
    expect(screen.queryByRole("group", { name: "좌석 배치도" })).toBeNull();
    await userEvent.click(seat);
    expect(screen.getByText("A-01 · 오후")).toBeInTheDocument();
    expect(navigation.draftStore!.getState().deskId).toBe(
      document.seats[0]!.spaceId,
    );
    expect(seat).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(seat);
    expect(navigation.draftStore!.getState().deskId).toBeNull();
    await userEvent.click(seat);
    await userEvent.click(screen.getByRole("radio", { name: /오전/ }));
    expect(navigation.draftStore!.getState().deskId).toBeNull();
    expect(
      screen.getByRole("button", { name: "A-01, 예약됨" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("blocks booked/maintenance/unavailable seats, allows mine and ignores a preserved inactive route", async () => {
    mount();
    for (const name of [
      "A-02, 예약됨",
      "A-04, 점검",
      "A-05, 예약할 수 없는 자리",
    ]) {
      const button = await screen.findByRole("button", { name });
      expect(button).toHaveAttribute("aria-disabled", "true");
      fireEvent.click(button);
      expect(navigation.draftStore!.getState().deskId).toBeNull();
    }
    fireEvent.click(screen.getByRole("button", { name: "A-03, 내 자리" }));
    expect(navigation.draftStore!.getState().deskId).toBe(
      document.seats[2]!.spaceId,
    );
    navigation.isCurrentRoute.mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "A-01, 비어 있음" }));
    expect(navigation.draftStore!.getState().deskId).toBe(
      document.seats[2]!.spaceId,
    );
  });
  it("clears published seat data while Activity is hidden then restores it without dropping the chosen seat", async () => {
    const { rerender, frame } = mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "A-01, 비어 있음" }),
    );
    rerender(frame("hidden"));
    expect(navigation.draftStore!.getState().deskSeats).toBeNull();
    expect(navigation.draftStore!.getState().deskId).toBe(
      document.seats[0]!.spaceId,
    );
    rerender(frame());
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "A-01, 비어 있음" }),
      ).toHaveAttribute("aria-pressed", "true"),
    );
  });
  it("opens the desk area detail URL and never carries a previous scope's seats", async () => {
    const { rerender, frame } = mount();
    const areaButton = screen.getByRole("button", { name: /오픈 데스크,/ });
    fireEvent.click(areaButton);
    expect(navigation.change).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: area.spaceId, detail: true }),
      expect.stringContaining(
        `space=${area.spaceId}&detail=1&view=plan&people=6`,
      ),
    );
    act(() => navigation.draftStore!.getState().activate("other-scope"));
    rerender(frame());
    expect(
      screen.queryByRole("button", { name: "A-01, 비어 있음" }),
    ).toBeNull();
  });
});

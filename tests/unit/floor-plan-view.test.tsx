import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FloorPlanView } from "@/features/floor-plan/components/floor-plan-view";
import { PlanTimeBar } from "@/features/floor-plan/components/plan-time-bar";
import { floorPlanSchema } from "@/lib/floor-plan/schema";
import { createScene } from "@/lib/floor-plan/render/scene";
import type { PlanShape, PlanStates } from "@/lib/floor-plan/render/types";
import planSource from "@/docs/spec/examples/gangnam-7f.plan.json";
import { floorDayFixture } from "./booking-ui-fixtures";

const navigation = vi.hoisted(() => ({
  change: vi.fn(),
  isCurrentRoute: vi.fn(() => true),
  location: {
    floorId: "floor",
    date: "2026-10-07",
    spaceId: null,
    detail: false,
  },
  search: new URLSearchParams("view=plan&people=6"),
}));
vi.mock("@/features/bookings/components/branch-workspace", () => ({
  useFloorSelection: () => navigation,
}));
vi.mock("@/features/floor-plan/components/plan-canvas", () => ({
  PlanCanvas: ({
    states,
    onSelect,
    onHover,
  }: {
    states: PlanStates;
    onSelect: (shape: PlanShape) => void;
    onHover: (shape: PlanShape) => void;
  }) => (
    <div>
      {createScene(floorPlanSchema.parse(planSource))
        .shapes.filter(
          (shape) => shape.kind === "space" && states.has(shape.spaceId!),
        )
        .map((shape) => (
          <button
            key={shape.id}
            onClick={() => onSelect(shape)}
            onMouseEnter={() => onHover(shape)}
          >
            {states.get(shape.spaceId!)!.name}
          </button>
        ))}
    </div>
  ),
}));
const document = floorPlanSchema.parse(planSource);
const first = document.spaces[0]!.spaceId;
const second = document.spaces[1]!.spaceId;
function fixture() {
  const data = floorDayFixture();
  const visible = data.spaces[0]!;
  if (visible.kind !== "accessible") throw new Error("fixture");
  data.spaces = [
    { ...visible, id: first, name: "회의실 B" },
    { kind: "restricted", id: second, type: "meeting_room" },
  ];
  return data;
}
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <FloorPlanView data={fixture()} planId="plan" />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  navigation.isCurrentRoute.mockReturnValue(true);
});
afterEach(() => vi.unstubAllGlobals());
describe("floor plan view", () => {
  it("shows time controls while the document is pending, without an empty claim", async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      ),
    );
    mount();
    expect(
      screen.getByRole("slider", { name: "평면도 기준 시각" }),
    ).toHaveValue("2");
    expect(screen.getByRole("status")).toHaveTextContent(
      "평면도를 불러오고 있어요",
    );
    fireEvent.click(screen.getByRole("button", { name: "다음 30분" }));
    expect(screen.getByRole("slider")).toHaveAttribute(
      "aria-valuetext",
      "10시 30분",
    );
    await act(async () => resolve(Response.json(document)));
    expect(
      await screen.findByRole("button", { name: "회의실 B" }),
    ).toBeVisible();
  });
  it("selects using the workspace URL, preserves queries, and refuses restricted or inactive selection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(document)),
    );
    mount();
    const room = await screen.findByRole("button", { name: "회의실 B" });
    fireEvent.click(room);
    expect(navigation.change).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: first, detail: false }),
      `/branches/branch/floors/floor?date=2026-10-07&space=${first}&view=plan&people=6`,
    );
    navigation.change.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "전용 공간" }));
    navigation.isCurrentRoute.mockReturnValue(false);
    fireEvent.click(room);
    expect(navigation.change).not.toHaveBeenCalled();
  });
  it("only includes safe status text in hover and gives a retry on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 500 }))
        .mockResolvedValue(Response.json(document)),
    );
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "평면도를 불러오지 못했어요",
    );
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    fireEvent.mouseEnter(
      await screen.findByRole("button", { name: "전용 공간" }),
    );
    expect(screen.getByRole("tooltip")).toHaveTextContent("다른 팀 전용이에요");
    expect(screen.getByRole("tooltip")).not.toHaveTextContent("디자인팀");
  });
  it("announces half-hour steps and stops at opening/last slot", () => {
    const changed = vi.fn();
    const data = fixture();
    const { rerender } = render(
      <PlanTimeBar
        data={data}
        at={Date.parse("2026-10-07T00:00:00Z")}
        onChange={changed}
        summary="빈 공간 1"
      />,
    );
    expect(screen.getByRole("button", { name: "이전 30분" })).toBeDisabled();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "3" } });
    expect(changed).toHaveBeenLastCalledWith(
      Date.parse("2026-10-07T01:30:00Z"),
    );
    rerender(
      <PlanTimeBar
        data={data}
        at={Date.parse("2026-10-07T04:30:00Z")}
        onChange={changed}
        summary="빈 공간 1"
      />,
    );
    expect(screen.getByRole("button", { name: "다음 30분" })).toBeDisabled();
  });
});

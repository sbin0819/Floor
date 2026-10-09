import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeMiniPlan } from "@/features/floor-plan/components/home-mini-plan";
import type { PlanStates } from "@/lib/floor-plan/render/types";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";

vi.mock("@/features/floor-plan/components/plan-canvas", () => ({
  PlanCanvas: ({
    states,
    interactive,
    document,
  }: {
    states: PlanStates;
    interactive?: boolean;
    document: FloorPlanDocument;
  }) => (
    <output
      data-testid="mini-canvas"
      data-interactive={String(interactive)}
      data-fixtures={JSON.stringify(document.fixtures)}
    >
      {JSON.stringify([...states])}
    </output>
  ),
}));
const room = "a1111111-1111-4111-8111-111111111111";
const seat = "22222222-2222-4222-8222-222222222222";
const plan: FloorPlanDocument = {
  schema: 1,
  unit: "mm",
  bounds: { w: 10000, h: 10000 },
  walls: [],
  openings: [],
  fixtures: [],
  spaces: [
    {
      id: "room",
      spaceId: room,
      polygon: [
        [0, 0],
        [8000, 0],
        [8000, 8000],
        [0, 8000],
      ],
      label: { at: [4000, 4000] },
    },
  ],
  seats: [
    {
      id: "seat",
      spaceId: seat,
      at: [1000, 1000],
      size: [400, 400],
      rotation: 0,
    },
  ],
};
let wide = false;
let change: () => void;
let client: QueryClient;
let fetcher: ReturnType<typeof vi.fn>;
function tree() {
  return (
    <QueryClientProvider client={client}>
      <HomeMiniPlan planId="plan" spaceId={room} seatId={seat} />
    </QueryClientProvider>
  );
}
beforeEach(() => {
  wide = false;
  client = new QueryClient();
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return wide;
    },
    addEventListener: (_: string, listener: () => void) => {
      change = listener;
    },
    removeEventListener: vi.fn(),
  }));
  fetcher = vi.fn(
    async () => new Response(JSON.stringify(plan), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  client.clear();
  vi.unstubAllGlobals();
});
describe("home miniature plan", () => {
  it("does not mount or request a document on the server or a narrow screen", () => {
    expect(renderToString(tree())).not.toContain("mini-canvas");
    render(tree());
    expect(screen.queryByTestId("mini-canvas")).not.toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses the common immutable document cache and highlights only the booked area and seat without names or interaction", async () => {
    client.setQueryData(["floor-plan", "plan"], plan);
    wide = true;
    render(tree());
    const canvas = await screen.findByTestId("mini-canvas");
    expect(canvas).toHaveAttribute("data-interactive", "false");
    expect(canvas.parentElement).toHaveAttribute("aria-hidden", "true");
    expect(JSON.parse(canvas.textContent!)).toEqual([
      [room, { kind: "mine", name: "" }],
      [seat, { kind: "mine", name: "" }],
    ]);
    expect(fetcher).not.toHaveBeenCalled();
    act(() => {
      wide = false;
      change();
    });
    expect(screen.queryByTestId("mini-canvas")).not.toBeInTheDocument();
  });
  it("omits the miniature when access was revoked instead of revealing a fallback name", async () => {
    fetcher.mockResolvedValue(new Response(null, { status: 404 }));
    wide = true;
    render(tree());
    await waitFor(() =>
      expect(client.getQueryState(["floor-plan", "plan"])?.status).toBe(
        "error",
      ),
    );
    expect(screen.queryByTestId("mini-canvas")).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("recognizes uppercase UUIDs without drawing any fixture labels", async () => {
    client.setQueryData(["floor-plan", "plan"], {
      ...plan,
      fixtures: [
        {
          id: "core",
          kind: "core",
          polygon: [
            [0, 0],
            [1000, 0],
            [1000, 1000],
            [0, 1000],
          ],
          label: "중앙 코어",
        },
      ],
      spaces: plan.spaces.map((space) => ({
        ...space,
        spaceId: space.spaceId.toUpperCase(),
      })),
    });
    wide = true;
    render(tree());
    expect(
      JSON.parse((await screen.findByTestId("mini-canvas")).textContent!)[0],
    ).toEqual([room, { kind: "mine", name: "" }]);
    expect(
      screen.getByTestId("mini-canvas").getAttribute("data-fixtures"),
    ).not.toContain("label");
  });
  it("hides a cached miniature after a revalidation reports revoked access", async () => {
    client.setQueryData(["floor-plan", "plan"], plan);
    wide = true;
    render(tree());
    expect(await screen.findByTestId("mini-canvas")).toBeInTheDocument();
    fetcher.mockResolvedValue(new Response(null, { status: 404 }));
    await act(() =>
      client.invalidateQueries({ queryKey: ["floor-plan", "plan"] }),
    );
    expect(client.getQueryData(["floor-plan", "plan"])).toEqual(plan);
    await waitFor(() =>
      expect(screen.queryByTestId("mini-canvas")).not.toBeInTheDocument(),
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

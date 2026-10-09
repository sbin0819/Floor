import { readFileSync } from "node:fs";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PlanAccessibility } from "@/features/floor-plan/components/plan-accessibility";
import { createPlanDrawer } from "@/lib/floor-plan/render/draw";
import { createPlanLayers } from "@/lib/floor-plan/render/layers";
import { createScene } from "@/lib/floor-plan/render/scene";
import { createSpatialIndex } from "@/lib/floor-plan/render/spatial-index";
import {
  utilizationBand,
  utilizationLabel,
  utilizationPercent,
} from "@/lib/floor-plan/render/utilization";
import type {
  PlanColors,
  PlanContext,
  PlanFrame,
  PlanShapeState,
} from "@/lib/floor-plan/render/types";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";

const document: FloorPlanDocument = {
  schema: 1,
  unit: "mm",
  bounds: { w: 500, h: 500 },
  walls: [],
  openings: [],
  fixtures: [],
  spaces: [
    {
      id: "area",
      spaceId: "area",
      polygon: [
        [0, 0],
        [200, 0],
        [200, 200],
        [0, 200],
      ],
      label: { at: [100, 100] },
    },
    {
      id: "room",
      spaceId: "room",
      polygon: [
        [250, 0],
        [450, 0],
        [450, 200],
        [250, 200],
      ],
      label: { at: [350, 100] },
    },
  ],
  seats: [
    { id: "seat", spaceId: "seat", at: [50, 50], size: [40, 40], rotation: 0 },
  ],
};
const palette = (name: string) => ({
  fill: `${name}-fill`,
  stroke: `${name}-stroke`,
  text: `${name}-text`,
});
const colors: PlanColors = {
  background: "background",
  border: "border",
  foreground: "foreground",
  muted: "muted",
  selection: "selection",
  focus: "focus",
  shadow: "shadow",
  free: palette("free"),
  booked: palette("booked"),
  mine: palette("mine"),
  maintenance: palette("maintenance"),
  restricted: palette("restricted"),
  neutral: palette("neutral"),
  fixture: palette("fixture"),
  heat: [
    palette("heat1"),
    palette("heat2"),
    palette("heat3"),
    palette("heat4"),
  ],
};
function frame(): PlanFrame {
  const scene = createScene(document);
  return {
    scene,
    index: createSpatialIndex(scene.shapes),
    mode: "utilization",
    camera: { scale: 1, x: 0, y: 0 },
    viewport: { width: 500, height: 500 },
    dpr: 1,
    colors,
    states: new Map<string, PlanShapeState>([
      [
        "area",
        {
          kind: "neutral",
          name: "오픈 데스크",
          deskArea: true,
          utilization: 0.68,
        },
      ],
      ["room", { kind: "neutral", name: "라운지", utilization: null }],
      ["seat", { kind: "mine", name: "A-01", utilization: 1 }],
    ]),
  };
}
function context() {
  const fills: unknown[] = [];
  const labels: {
    value: string;
    x: number;
    y: number;
    align: string;
    color: unknown;
  }[] = [];
  const ctx: PlanContext = {
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    rect: vi.fn(),
    arc: vi.fn(),
    stroke: vi.fn(),
    clip: vi.fn(),
    setLineDash: vi.fn(),
    fill: () => {
      fills.push(ctx.fillStyle);
    },
    fillText: (value, x, y) => {
      labels.push({ value, x, y, align: ctx.textAlign, color: ctx.fillStyle });
    },
    measureText: (value) => ({ width: value.length * 6 }) as TextMetrics,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    font: "",
    textAlign: "center",
    textBaseline: "middle",
    shadowColor: "",
    shadowBlur: 0,
  };
  return { ctx, fills, labels };
}

describe("shared plan utilization rendering", () => {
  it.each([
    [0, 0],
    [0.24, 0],
    [0.25, 1],
    [0.49, 1],
    [0.5, 2],
    [0.74, 2],
    [0.75, 3],
    [1, 3],
  ])("maps ratio %s to heat band %s", (value, band) => {
    expect(utilizationBand(value)).toBe(band);
  });
  it("normalizes nullable ratios consistently for visible and accessible text", () => {
    expect(utilizationPercent(0.678)).toBe(68);
    expect(utilizationPercent(null)).toBeNull();
    expect(utilizationPercent(Number.NaN)).toBeNull();
    expect(utilizationLabel(null)).toBe("이용률 없음");
    expect(utilizationLabel(0.68)).toBe("이용률 68%");
  });
  it("fills desk areas, hides seats on every layer and labels percentages at bottom-right", () => {
    const current = frame();
    const painter = createPlanDrawer({ createPath: () => null });
    const base = context(),
      state = context(),
      overlay = context();
    painter.drawBase(base.ctx, current);
    expect(base.fills).toHaveLength(2);
    painter.drawStates(state.ctx, current);
    expect(state.fills).toEqual(["heat3-fill", "maintenance-fill"]);
    expect(state.labels).toContainEqual({
      value: "68%",
      x: 192,
      y: 192,
      align: "right",
      color: "heat3-text",
    });
    expect(state.labels.some(({ value }) => value === "A-01")).toBe(false);
    expect(state.labels.some(({ value }) => value === "이용률 없음")).toBe(
      true,
    );
    expect(state.ctx.setLineDash).not.toHaveBeenCalledWith([6, 4]);
    painter.drawOverlay(overlay.ctx, current, {
      selectedSeatId: "seat",
      hoveredId: "seat",
      focusedId: "seat",
    });
    expect(overlay.ctx.stroke).not.toHaveBeenCalled();
  });
  it("uses hatch for a null cell and high-contrast fourth-band text", () => {
    const current = frame();
    const pattern = { setTransform: vi.fn() } as unknown as CanvasPattern;
    const states = new Map(current.states);
    states.set("area", { ...states.get("area")!, utilization: 0.99 });
    const recorder = context();
    createPlanDrawer({ createPath: () => null }).drawStates(recorder.ctx, {
      ...current,
      states,
      colors: { ...colors, maintenancePattern: pattern },
    });
    expect(recorder.fills).toEqual(["heat4-fill", pattern]);
    expect(recorder.labels.find(({ value }) => value === "99%")?.color).toBe(
      "heat4-text",
    );
  });
  it("only repaints changed utilization and fully redraws when switching back to booking", () => {
    const a = context(),
      b = context(),
      c = context();
    const renderer = createPlanLayers(
      { base: a.ctx, state: b.ctx, overlay: c.ctx },
      { createPath: () => null },
    );
    const current = frame();
    renderer.render(current);
    expect(renderer.render(current)).toMatchObject({
      base: false,
      state: false,
      overlay: false,
    });
    const states = new Map(current.states);
    states.set("area", { ...states.get("area")!, utilization: 0.9 });
    expect(renderer.render({ ...current, states })).toMatchObject({
      base: false,
      state: true,
      overlay: false,
    });
    expect(
      renderer.render({ ...current, states, mode: "booking" }),
    ).toMatchObject({ base: true, state: true, overlay: true });
    expect(b.fills).toContain("mine-fill");
    expect(b.labels.some(({ value }) => value === "A-01")).toBe(true);
  });
  it("exposes utilization names and keyboard navigation, never seats even with a selected desk area", async () => {
    const current = frame();
    render(
      <PlanAccessibility
        mode="utilization"
        scene={current.scene}
        states={current.states}
        activeDeskAreaId="area"
        lastFocusedId={null}
        timeLabel="11:30 기준"
        onFocus={() => {}}
        onClear={() => {}}
        onSelect={() => {}}
      />,
    );
    const list = screen.getByRole("list", { name: "평면도 공간 목록" });
    const buttons = within(list).getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAccessibleName("오픈 데스크, 이용률 68%");
    expect(buttons[1]).toHaveAccessibleName("라운지, 이용률 없음");
    const user = userEvent.setup();
    await user.tab();
    expect(buttons[0]).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(buttons[1]).toHaveFocus();
  });
  it("registers all four light/dark CSS tokens instead of renderer color literals", () => {
    const css = readFileSync("app/globals.css", "utf8");
    for (const [index, color] of [
      "eef1fc",
      "c9d3f5",
      "8fa3ea",
      "3a5bd9",
    ].entries()) {
      expect(
        css.match(new RegExp(`--heat-${index + 1}: #${color};`, "g")),
      ).toHaveLength(2);
      expect(css).toContain(
        `--color-heat-${index + 1}: var(--heat-${index + 1})`,
      );
    }
    expect(readFileSync("lib/floor-plan/render/draw.ts", "utf8")).not.toMatch(
      /#[\da-f]{6}/i,
    );
  });
});

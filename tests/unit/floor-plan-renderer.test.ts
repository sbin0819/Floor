import { describe, expect, it, vi } from "vitest";
import example from "@/docs/spec/examples/gangnam-7f.plan.json";
import { floorPlanSchema } from "@/lib/floor-plan/schema";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";
import {
  ensureVisible,
  fit,
  pan,
  screenBounds,
  toScreen,
  toWorld,
  worldViewport,
  zoomAt,
} from "@/lib/floor-plan/render/camera";
import { createScene, seatPolygon } from "@/lib/floor-plan/render/scene";
import { createSpatialIndex } from "@/lib/floor-plan/render/spatial-index";
import { hitTest, pointInPolygon } from "@/lib/floor-plan/render/hit-test";
import { createPlanDrawer } from "@/lib/floor-plan/render/draw";
import { createPlanLayers } from "@/lib/floor-plan/render/layers";
import type {
  PlanColors,
  PlanContext,
  PlanFrame,
  PlanShapeState,
  Point,
} from "@/lib/floor-plan/render/types";

const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const c = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const desk = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const rectangle = (
  x: number,
  y: number,
  w: number,
  h: number,
): [number, number][] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];
function document(): FloorPlanDocument {
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
        id: "a",
        spaceId: a,
        polygon: rectangle(20, 20, 100, 100),
        label: { at: [70, 70] },
      },
      {
        id: "b",
        spaceId: b,
        polygon: rectangle(120, 20, 100, 100),
        label: { at: [170, 70] },
      },
      {
        id: "c",
        spaceId: c,
        polygon: rectangle(700, 20, 100, 100),
        label: { at: [750, 70] },
      },
    ],
  };
}
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
};
function frame(doc = document()): PlanFrame {
  const scene = createScene(doc);
  return {
    scene,
    index: createSpatialIndex(scene.shapes),
    camera: { scale: 1, x: 0, y: 0 },
    viewport: { width: 500, height: 300 },
    dpr: 2,
    colors,
    states: new Map([
      [a, { kind: "free", name: "A", label: "비어 있음" }],
      [b, { kind: "booked", name: "B" }],
      [c, { kind: "mine", name: "C" }],
    ]),
  };
}
function recordingContext() {
  const calls: { name: string; args: unknown[] }[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push({ name, args });
    };
  const ctx: PlanContext = {
    save: record("save"),
    restore: record("restore"),
    setTransform: record("setTransform"),
    clearRect: record("clearRect"),
    fillRect: record("fillRect"),
    beginPath: record("beginPath"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    closePath: record("closePath"),
    rect: record("rect"),
    arc: record("arc"),
    fill: (...args: unknown[]) =>
      calls.push({ name: "fill", args: [ctx.fillStyle, ...args] }),
    stroke: (...args: unknown[]) =>
      calls.push({ name: "stroke", args: [ctx.strokeStyle, ...args] }),
    clip: record("clip"),
    setLineDash: record("setLineDash"),
    fillText: record("fillText"),
    measureText: (value) => ({
      width: Array.from(value).length * 5,
      actualBoundingBoxAscent: 0,
      actualBoundingBoxDescent: 0,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: 0,
      fontBoundingBoxAscent: 0,
      fontBoundingBoxDescent: 0,
      emHeightAscent: 0,
      emHeightDescent: 0,
      hangingBaseline: 0,
      alphabeticBaseline: 0,
      ideographicBaseline: 0,
    }),
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
  return {
    ctx,
    calls,
    of: (name: string) =>
      calls.filter((call) => call.name === name).map((call) => call.args),
    clear: () => {
      calls.length = 0;
    },
  };
}

describe("floor plan camera in CSS pixels", () => {
  it.each(
    (
      [
        [0, 0],
        [10000, 15000],
        [-12, 13.5],
      ] as Point[]
    ).map((point) => ({ point })),
  )("round trips $point without mutating the camera", ({ point }) => {
    const camera = { scale: 0.03, x: 37, y: -19 };
    const result = toWorld(toScreen(point, camera), camera);
    expect(result[0]).toBeCloseTo(point[0], 8);
    expect(result[1]).toBeCloseTo(point[1], 8);
    expect(camera).toEqual({ scale: 0.03, x: 37, y: -19 });
  });
  it("fits within padding, centers bounds, and accepts temporarily zero viewport", () => {
    const camera = fit({ w: 10000, h: 5000 }, { width: 500, height: 300 }, 20);
    expect(camera).toEqual({ scale: 0.046, x: 20, y: 35 });
    expect(
      Object.values(fit({ w: 10000, h: 5000 }, { width: 0, height: 0 })).every(
        Number.isFinite,
      ),
    ).toBe(true);
  });
  it("anchors zoom under the pointer and clamps to 0.5–8 times fit", () => {
    const camera = { scale: 0.1, x: 20, y: 30 };
    const point: Point = [47, 89];
    const before = toWorld(point, camera);
    for (const factor of [0.00001, 0.7, 1, 3, 1e7]) {
      const result = zoomAt(camera, point, factor, 0.1);
      expect(result.scale).toBeGreaterThanOrEqual(0.05);
      expect(result.scale).toBeLessThanOrEqual(0.8);
      expect(toWorld(point, result)[0]).toBeCloseTo(before[0]);
      expect(toWorld(point, result)[1]).toBeCloseTo(before[1]);
    }
    expect(zoomAt(camera, point, NaN, 0.1)).toBe(camera);
  });
  it("pans, computes inverse viewport and only moves an offscreen selection", () => {
    const camera = { scale: 2, x: 20, y: 30 };
    expect(pan(camera, 3, -5)).toEqual({ scale: 2, x: 23, y: 25 });
    expect(worldViewport(camera, { width: 100, height: 80 })).toEqual({
      minX: -10,
      minY: -15,
      maxX: 40,
      maxY: 25,
    });
    const visible = { minX: 10, minY: 10, maxX: 20, maxY: 20 };
    expect(ensureVisible(camera, visible, { width: 200, height: 200 })).toBe(
      camera,
    );
    const moved = ensureVisible(
      camera,
      { minX: 200, minY: 100, maxX: 240, maxY: 140 },
      { width: 200, height: 200 },
    );
    expect(toScreen([220, 120], moved)).toEqual([100, 100]);
  });
});

describe("numeric scene and spatial hit testing", () => {
  it("preprocesses the real plan without Path2D, mutation, or losing IDs", () => {
    const plan = floorPlanSchema.parse(example);
    const before = structuredClone(plan);
    const scene = createScene(plan);
    expect(plan).toEqual(before);
    expect(structuredClone(scene)).toEqual(scene);
    expect(scene.shapes.filter((shape) => shape.kind === "seat")).toHaveLength(
      24,
    );
    expect(
      scene.shapes.find((shape) => shape.id === plan.spaces[0]!.id)?.spaceId,
    ).toBe(plan.spaces[0]!.spaceId);
  });
  it.each([0, 90, 180, 270, 45, -45, 450])(
    "rotates a seat by %s degrees and indexes the full footprint",
    (rotation) => {
      const plan = document();
      plan.seats = [
        { id: "seat", spaceId: desk, at: [80, 80], size: [40, 20], rotation },
      ];
      const scene = createScene(plan);
      const shape = scene.shapes.find((shape) => shape.id === "seat")!;
      expect(shape.points).toEqual(seatPolygon(plan.seats[0]!));
      const index = createSpatialIndex(scene.shapes);
      expect(hitTest(index, { scale: 2, x: 10, y: -20 }, [170, 140])?.id).toBe(
        "seat",
      );
      for (const corner of shape.points)
        expect(pointInPolygon(corner, shape.points)).toBe(true);
      expect(index.search(shape.bounds)).toContain(shape);
    },
  );
  it("puts seats before later spaces but allows the stage33 spaces-only filter", () => {
    const plan = document();
    plan.seats = [
      { id: "seat", spaceId: desk, at: [70, 70], size: [20, 20], rotation: 0 },
    ];
    const scene = createScene(plan);
    const seat = scene.shapes.find((shape) => shape.id === "seat")!;
    const space = scene.shapes.find((shape) => shape.id === "a")!;
    const index = createSpatialIndex([
      { ...seat, order: 0 },
      { ...space, order: 20 },
    ]);
    expect(hitTest(index, { scale: 1, x: 0, y: 0 }, [70, 70])?.id).toBe("seat");
    expect(
      hitTest(index, { scale: 1, x: 0, y: 0 }, [70, 70], { kinds: ["space"] })
        ?.id,
    ).toBe("a");
  });
  it("uses later paint order for overlapping spaces and rejects empty hits", () => {
    const plan = document();
    plan.spaces.push({ ...plan.spaces[0]!, id: "last", spaceId: desk });
    const scene = createScene(plan),
      index = createSpatialIndex(scene.shapes);
    expect(hitTest(index, { scale: 1, x: 0, y: 0 }, [70, 70])?.id).toBe("last");
    expect(hitTest(index, { scale: 1, x: 0, y: 0 }, [0, 0])).toBeNull();
    expect(
      createSpatialIndex([]).search({ minX: 0, minY: 0, maxX: 1, maxY: 1 }),
    ).toEqual([]);
  });
  it("handles concavity, reversed winding, vertices and edge boundaries", () => {
    const concave: Point[] = [
      [0, 0],
      [100, 0],
      [100, 40],
      [40, 40],
      [40, 100],
      [0, 100],
    ];
    for (const points of [concave, [...concave].reverse()]) {
      expect(pointInPolygon([70, 70], points)).toBe(false);
      for (const point of [
        [10, 70],
        [0, 50],
        [40, 60],
        [40, 40],
        [100, 20],
      ] as Point[])
        expect(pointInPolygon(point, points)).toBe(true);
      expect(pointInPolygon([40.001, 70], points)).toBe(false);
    }
  });
  it("resolves opening positions by total length including the closing edge", () => {
    const plan = document();
    plan.walls = [
      {
        id: "wall",
        points: [
          [0, 0],
          [100, 0],
          [100, 100],
          [0, 100],
        ],
        closed: true,
        thickness: 10,
      },
    ];
    plan.openings = [
      { id: "door", wallId: "wall", at: 0.875, width: 20, kind: "door" },
    ];
    const scene = createScene(plan);
    const door = scene.shapes.find((shape) => shape.id === "door");
    expect(door).toMatchObject({
      kind: "opening",
      labelAt: [0, 50],
      hinge: [0, 60],
      radius: 20,
      door: true,
    });
    expect(scene.shapes.find((shape) => shape.id === "wall")).toMatchObject({
      bounds: { minX: -5, minY: -5, maxX: 105, maxY: 105 },
      segments: [
        [
          [0, 0],
          [100, 0],
        ],
        [
          [100, 0],
          [100, 100],
        ],
        [
          [100, 100],
          [0, 100],
        ],
        [
          [0, 100],
          [0, 60],
        ],
        [
          [0, 40],
          [0, 0],
        ],
      ],
    });
  });
  it.each([0, 1])(
    "supports opening endpoint %s, repeated wall points and a zero-length wall",
    (at) => {
      const plan = document();
      plan.walls = [
        {
          id: "wall",
          points: [
            [0, 0],
            [0, 0],
            [100, 0],
          ],
          closed: false,
          thickness: 10,
        },
        {
          id: "zero",
          points: [
            [0, 0],
            [0, 0],
          ],
          closed: true,
          thickness: 10,
        },
      ];
      plan.openings = [
        { id: "opening", wallId: "wall", at, width: 20, kind: "opening" },
        { id: "zero-opening", wallId: "zero", at, width: 20, kind: "door" },
      ];
      const scene = createScene(plan);
      expect(
        scene.shapes.find((shape) => shape.id === "opening")?.labelAt,
      ).toEqual([at * 100, 0]);
      expect(
        scene.shapes.some(
          (shape) => shape.id === "zero" || shape.id === "zero-opening",
        ),
      ).toBe(false);
      for (const shape of scene.shapes)
        expect(Object.values(shape.bounds).every(Number.isFinite)).toBe(true);
    },
  );
});

describe("three canvas layers and partial rendering", () => {
  it("redraws only the changed state rectangle and intersecting neighbours", () => {
    const base = recordingContext(),
      state = recordingContext(),
      overlay = recordingContext();
    const layers = createPlanLayers(
      { base: base.ctx, state: state.ctx, overlay: overlay.ctx },
      { createPath: () => null },
    );
    const current = frame();
    layers.render(current);
    base.clear();
    state.clear();
    overlay.clear();
    const result = layers.render({
      ...current,
      states: new Map(current.states).set(a, {
        kind: "mine",
        name: "A",
        label: "내 예약",
      }),
    });
    expect(result).toEqual({
      base: false,
      state: true,
      overlay: false,
      dirty: [{ minX: 18, minY: 18, maxX: 122, maxY: 122 }],
    });
    expect(base.calls).toEqual([]);
    expect(overlay.calls).toEqual([]);
    expect(state.of("clearRect")).toEqual([[18, 18, 104, 104]]);
    expect(state.of("rect")[0]).toEqual([18, 18, 104, 104]);
    expect(state.of("fillText").map((call) => call[0])).toEqual([
      "A",
      "내 예약",
      "B",
    ]);
    expect(state.of("clip").length).toBeGreaterThan(0);
    expect(state.of("setTransform")).toEqual([
      [2, 0, 0, 2, 0, 0],
      [2, 0, 0, 2, 0, 0],
    ]);
  });
  it("does no work for equal state and redraws all layers for camera, DPR or palette changes", () => {
    const base = recordingContext(),
      state = recordingContext(),
      overlay = recordingContext();
    const layers = createPlanLayers(
      { base: base.ctx, state: state.ctx, overlay: overlay.ctx },
      { createPath: () => null },
    );
    const current = frame();
    layers.render(current);
    expect(
      layers.render({ ...current, states: new Map(current.states) }),
    ).toMatchObject({ base: false, state: false, overlay: false });
    for (const changed of [
      { ...current, camera: pan(current.camera, 5, 6) },
      { ...current, dpr: 1 },
      { ...current, colors: { ...colors } },
    ])
      expect(layers.render(changed)).toMatchObject({
        base: true,
        state: true,
        overlay: true,
      });
    expect(layers.render({ ...current }, {}, true)).toMatchObject({
      base: true,
      state: true,
      overlay: true,
    });
  });
  it("only changes the overlay for hover/selection/focus and accepts DB space IDs", () => {
    const base = recordingContext(),
      state = recordingContext(),
      overlay = recordingContext();
    const layers = createPlanLayers(
      { base: base.ctx, state: state.ctx, overlay: overlay.ctx },
      { createPath: () => null },
    );
    const current = frame();
    layers.render(current);
    base.clear();
    state.clear();
    overlay.clear();
    expect(
      layers.render(current, { selectedId: a, focusedId: "b" }),
    ).toMatchObject({ base: false, state: false, overlay: true });
    expect(base.calls).toEqual([]);
    expect(state.calls).toEqual([]);
    expect(overlay.of("stroke").map((call) => call[0])).toEqual([
      "selection",
      "focus",
    ]);
  });
  it("removes old labels on missing state and refreshes the base for hidden/desk-area geometry", () => {
    const base = recordingContext(),
      state = recordingContext(),
      overlay = recordingContext();
    const layers = createPlanLayers(
      { base: base.ctx, state: state.ctx, overlay: overlay.ctx },
      { createPath: () => null },
    );
    const current = frame();
    layers.render(current);
    state.clear();
    const states = new Map(current.states);
    states.delete(a);
    expect(layers.render({ ...current, states }).dirty).toHaveLength(1);
    expect(state.of("fillText").some((call) => call[0] === "A")).toBe(false);
    expect(
      layers.render({
        ...current,
        states: new Map(current.states).set(a, {
          kind: "neutral",
          name: "구역",
          deskArea: true,
        }),
      }).base,
    ).toBe(true);
    expect(
      layers.render({
        ...current,
        states: new Map(current.states).set(a, {
          kind: "free",
          name: "A",
          hidden: true,
        }),
      }).base,
    ).toBe(true);
  });
  it("keeps offscreen changes off canvas and copies mutable state snapshots", () => {
    const recordings = [
      recordingContext(),
      recordingContext(),
      recordingContext(),
    ];
    const layers = createPlanLayers(
      {
        base: recordings[0]!.ctx,
        state: recordings[1]!.ctx,
        overlay: recordings[2]!.ctx,
      },
      { createPath: () => null },
    );
    const current = frame(),
      states = new Map(current.states);
    layers.render({ ...current, states });
    states.set(c, { kind: "booked", name: "C" });
    expect(layers.render({ ...current, states })).toMatchObject({
      base: false,
      state: false,
      overlay: false,
      dirty: [],
    });
    states.set(a, { kind: "mine", name: "A" });
    expect(layers.render({ ...current, states }).dirty).toEqual([
      screenBounds(
        current.scene.shapes.find((shape) => shape.id === "a")!.bounds,
        current.camera,
        2,
      ),
    ]);
  });
  it("uses token styles and screen-sized hatch patterns; unknown states are not free", () => {
    const current = frame(),
      ctx = recordingContext();
    const setTransform = vi.fn();
    const pattern: CanvasPattern = { setTransform };
    const drawer = createPlanDrawer({ createPath: () => null });
    drawer.drawStates(ctx.ctx, {
      ...current,
      camera: { scale: 0.5, x: 10, y: 20 },
      colors: { ...colors, maintenancePattern: pattern },
      states: new Map([[a, { kind: "maintenance", name: "점검" }]]),
    });
    expect(setTransform).toHaveBeenCalledWith({ a: 2, d: 2, e: -20, f: -40 });
    expect(ctx.of("fill").map((call) => call[0])).toEqual([pattern]);
    ctx.clear();
    drawer.drawStates(ctx.ctx, { ...current, states: new Map() });
    expect(ctx.of("fill")).toEqual([]);
  });
  it("leaves desks as transparent dashed areas with neutral seat outlines", () => {
    const doc = document();
    doc.seats = [
      { id: "seat", spaceId: desk, at: [70, 70], size: [20, 20], rotation: 0 },
    ];
    const current = frame(doc),
      ctx = recordingContext(),
      drawer = createPlanDrawer({ createPath: () => null });
    const states = new Map<string, PlanShapeState>([
      [a, { kind: "neutral", name: "데스크", deskArea: true }],
    ]);
    drawer.drawBase(ctx.ctx, { ...current, states });
    expect(ctx.of("setLineDash")).toContainEqual([[6, 4]]);
    expect(ctx.of("fill").length).toBe(2);
    ctx.clear();
    drawer.drawStates(ctx.ctx, { ...current, states });
    expect(ctx.of("fill")).toEqual([]);
  });
  it("hides labels below zoom thresholds and truncates long names inside shape clipping", () => {
    const current = frame(),
      ctx = recordingContext(),
      drawer = createPlanDrawer({ createPath: () => null });
    drawer.drawStates(ctx.ctx, {
      ...current,
      camera: { scale: 0.3, x: 0, y: 0 },
    });
    expect(ctx.of("fillText")).toEqual([]);
    ctx.clear();
    drawer.drawStates(ctx.ctx, {
      ...current,
      states: new Map([
        [
          a,
          {
            kind: "restricted",
            name: "아주 긴 공간 이름을 그대로 넘겨도 밖으로 나오지 않아요",
            label: "설명",
          },
        ],
      ]),
    });
    expect(ctx.of("fillText")[0]?.[0]).toMatch(/…$/u);
    expect(ctx.of("clip").length).toBeGreaterThan(0);
    expect(ctx.of("arc")).toHaveLength(1);
  });
  it("caches injected paths per immutable shape and still works without Path2D", () => {
    const current = frame(),
      ctx = recordingContext();
    const createPath = vi.fn(
      () =>
        ({
          moveTo: vi.fn(),
          lineTo: vi.fn(),
          closePath: vi.fn(),
        }) as unknown as Path2D,
    );
    const drawer = createPlanDrawer({ createPath });
    drawer.drawBase(ctx.ctx, current);
    drawer.drawStates(ctx.ctx, current);
    drawer.drawOverlay(ctx.ctx, current, { selectedId: a });
    expect(createPath).toHaveBeenCalledTimes(2);
  });
});

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanCanvas } from "@/features/floor-plan/components/plan-canvas";
import { fit, toScreen, toWorld } from "@/lib/floor-plan/render/camera";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";
import type {
  PlanColors,
  PlanFrame,
  PlanOverlay,
  PlanStates,
  Point,
} from "@/lib/floor-plan/render/types";

const painter = vi.hoisted(() => ({
  render:
    vi.fn<(frame: PlanFrame, overlay: PlanOverlay, force: boolean) => void>(),
  create: vi.fn(),
  colors: null as PlanColors | null,
}));
vi.mock("@/lib/floor-plan/render/layers", () => ({
  createPlanLayers: (contexts: unknown) => {
    painter.create(contexts);
    return { render: painter.render };
  },
}));
vi.mock("@/features/floor-plan/components/use-plan-colors", () => ({
  usePlanColors: () => painter.colors,
}));

const first = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
const seat = "33333333-3333-4333-8333-333333333333";
const plan: FloorPlanDocument = {
  schema: 1,
  unit: "mm",
  bounds: { w: 1000, h: 600 },
  walls: [],
  openings: [],
  fixtures: [],
  spaces: [
    {
      id: "room-a",
      spaceId: first,
      polygon: [
        [20, 20],
        [220, 20],
        [220, 220],
        [20, 220],
      ],
      label: { at: [120, 120] },
    },
    {
      id: "room-b",
      spaceId: second,
      polygon: [
        [700, 20],
        [900, 20],
        [900, 220],
        [700, 220],
      ],
      label: { at: [800, 120] },
    },
  ],
  seats: [
    {
      id: "desk-a",
      spaceId: seat,
      at: [120, 120],
      size: [40, 40],
      rotation: 45,
    },
  ],
};
const palette = { fill: "fill", stroke: "stroke", text: "text" };
const colors: PlanColors = {
  background: "background",
  border: "border",
  foreground: "foreground",
  muted: "muted",
  selection: "selection",
  focus: "focus",
  shadow: "shadow",
  free: palette,
  booked: palette,
  mine: palette,
  maintenance: palette,
  restricted: palette,
  neutral: palette,
  fixture: palette,
};
const states: PlanStates = new Map([
  [first, { kind: "free", name: "회의실 A" }],
  [second, { kind: "restricted", name: "전용 공간" }],
  [seat, { kind: "neutral", name: "좌석" }],
]);
let dimensions = { width: 800, height: 520 };
let rafId = 0;
let frames: Map<number, FrameRequestCallback>;
let observers: FakeResizeObserver[];
let fontsReady: () => void;
const descriptors: {
  owner: object;
  key: string;
  previous?: PropertyDescriptor;
}[] = [];
function property(owner: object, key: string, value: unknown) {
  descriptors.push({
    owner,
    key,
    previous: Object.getOwnPropertyDescriptor(owner, key),
  });
  Object.defineProperty(owner, key, {
    value,
    configurable: true,
    writable: true,
  });
}
class FakeResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  constructor(private callback: ResizeObserverCallback) {
    observers.push(this);
  }
  resize() {
    this.callback([], this as unknown as ResizeObserver);
  }
}
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? "mouse";
  }
}
function flushFrames() {
  act(() => {
    const pending = [...frames];
    frames.clear();
    for (const [id, callback] of pending) callback(id * 16);
  });
}
function lastFrame() {
  const call = painter.render.mock.calls.at(-1);
  if (!call) throw new Error("Expected a painted frame");
  return call[0];
}
function host(container: HTMLElement) {
  const element = container.querySelector<HTMLDivElement>("[data-plan-canvas]");
  if (!element) throw new Error("Missing canvas host");
  return element;
}
function wheel(element: HTMLElement, init: WheelEventInit = {}) {
  const event = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  fireEvent(element, event);
  return event;
}
function client(point: Point) {
  return { clientX: point[0] + 40, clientY: point[1] + 60 };
}
function tap(element: HTMLElement, point: Point, pointerId = 1) {
  fireEvent.pointerDown(element, { ...client(point), pointerId, button: 0 });
  fireEvent.pointerUp(element, { ...client(point), pointerId, button: 0 });
}

beforeEach(() => {
  vi.clearAllMocks();
  painter.colors = colors;
  dimensions = { width: 800, height: 520 };
  frames = new Map();
  observers = [];
  rafId = 0;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      frames.set(++rafId, callback);
      return rafId;
    }),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn((id: number) => frames.delete(id)),
  );
  property(window, "devicePixelRatio", 2);
  property(document, "fonts", {
    ready: new Promise<void>((resolve) => {
      fontsReady = resolve;
    }),
  });
  property(HTMLElement.prototype, "setPointerCapture", vi.fn());
  property(HTMLElement.prototype, "releasePointerCapture", vi.fn());
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => ({
      ...dimensions,
      x: 40,
      y: 60,
      left: 40,
      top: 60,
      right: 40 + dimensions.width,
      bottom: 60 + dimensions.height,
      toJSON: () => ({}),
    }),
  );
  const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      let context = contexts.get(this);
      if (!context) {
        context = { canvas: this } as CanvasRenderingContext2D;
        contexts.set(this, context);
      }
      return context;
    },
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const { owner, key, previous } of descriptors.splice(0).reverse()) {
    if (previous) Object.defineProperty(owner, key, previous);
    else Reflect.deleteProperty(owner, key);
  }
});

describe("plan canvas lifecycle", () => {
  it("draws and keeps the keyboard focus in view without repainting the base", () => {
    const accessible: PlanStates = new Map([
      [first, { kind: "free", name: "회의실 A" }],
      [second, { kind: "free", name: "회의실 B" }],
    ]);
    const select = vi.fn();
    const clear = vi.fn();
    const { container } = render(
      <PlanCanvas
        document={plan}
        states={accessible}
        onSelect={select}
        onClear={clear}
        timeLabel="10시 기준"
      />,
    );
    flushFrames();
    wheel(host(container), { deltaX: 2000 });
    flushFrames();
    act(() =>
      screen.getByRole("button", { name: "회의실 A, 10시 기준" }).focus(),
    );
    flushFrames();
    expect(painter.render.mock.calls.at(-1)?.[1].focusedId).toBe("room-a");
    const focused = toScreen([20, 20], lastFrame().camera);
    expect(focused[0]).toBeGreaterThanOrEqual(24);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    flushFrames();
    const room = screen.getByRole("button", { name: "회의실 B, 10시 기준" });
    expect(room).toHaveFocus();
    expect(painter.render.mock.calls.at(-1)?.[1].focusedId).toBe("room-b");
    fireEvent.click(room);
    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({ id: "room-b" }),
    );
    fireEvent.keyDown(room, { key: "Escape" });
    expect(clear).toHaveBeenCalledOnce();
    act(() => screen.getByRole("button", { name: "평면도 확대" }).focus());
    flushFrames();
    expect(painter.render.mock.calls.at(-1)?.[1].focusedId).toBeNull();
  });
  it("creates three DPR-sized hidden layers and paints the initial fit once", () => {
    const { container } = render(
      <PlanCanvas document={plan} states={states} onSelect={vi.fn()} />,
    );
    const canvases = [...container.querySelectorAll("canvas")];
    expect(canvases).toHaveLength(3);
    for (const canvas of canvases) {
      expect(canvas).toHaveAttribute("aria-hidden", "true");
      expect(canvas.width).toBe(1600);
      expect(canvas.height).toBe(1040);
    }
    expect(painter.create).toHaveBeenCalledTimes(1);
    expect(observers[0]!.observe).toHaveBeenCalledWith(host(container));
    expect(painter.render).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);
    flushFrames();
    expect(painter.render).toHaveBeenCalledTimes(1);
    expect(lastFrame()).toMatchObject({
      camera: fit(plan.bounds, dimensions),
      viewport: dimensions,
      dpr: 2,
    });
    expect(painter.render.mock.calls[0]![2]).toBe(true);
  });

  it("coalesces wheel updates into one frame without applying DPR twice", () => {
    const { container } = render(
      <PlanCanvas document={plan} states={states} onSelect={vi.fn()} />,
    );
    flushFrames();
    const initial = lastFrame().camera;
    const element = host(container);
    act(() => {
      expect(wheel(element, { deltaX: 10, deltaY: 20 }).defaultPrevented).toBe(
        true,
      );
      wheel(element, { deltaX: 5, deltaY: 10 });
      wheel(element, { deltaY: 7 });
    });
    expect(frames.size).toBe(1);
    expect(painter.render).toHaveBeenCalledTimes(1);
    flushFrames();
    expect(lastFrame().camera).toEqual({
      ...initial,
      x: initial.x - 15,
      y: initial.y - 37,
    });
    expect(painter.render.mock.calls.at(-1)![2]).toBe(false);
  });

  it.each(["ctrlKey", "metaKey"] as const)(
    "anchors %s wheel zoom to the CSS cursor",
    (modifier) => {
      const { container } = render(
        <PlanCanvas document={plan} states={states} onSelect={vi.fn()} />,
      );
      flushFrames();
      const before = lastFrame().camera;
      const point: Point = [180, 120];
      const world = toWorld(point, before);
      wheel(host(container), {
        ...client(point),
        deltaY: -90,
        [modifier]: true,
      });
      flushFrames();
      const after = lastFrame().camera;
      expect(after.scale).toBeCloseTo(before.scale * Math.exp(0.3));
      expect(toScreen(world, after)[0]).toBeCloseTo(point[0]);
      expect(toScreen(world, after)[1]).toBeCloseTo(point[1]);
    },
  );

  it("keeps user panning through status updates and font readiness, then explicitly fits", async () => {
    const { container, rerender } = render(
      <PlanCanvas
        document={plan}
        states={states}
        selectedSpaceId={first}
        onSelect={vi.fn()}
      />,
    );
    flushFrames();
    flushFrames();
    wheel(host(container), { deltaY: 900 });
    flushFrames();
    const panned = lastFrame().camera;
    const nextStates: PlanStates = new Map([
      ...states,
      [first, { kind: "booked", name: "회의실 A" }],
    ]);
    rerender(
      <PlanCanvas
        document={plan}
        states={nextStates}
        selectedSpaceId={first}
        onSelect={vi.fn()}
      />,
    );
    flushFrames();
    expect(lastFrame().camera).toEqual(panned);
    await act(async () => fontsReady());
    flushFrames();
    expect(lastFrame().camera).toEqual(panned);
    expect(painter.render.mock.calls.at(-1)![2]).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "맞춤" }));
    flushFrames();
    expect(lastFrame().camera).toEqual(fit(plan.bounds, dimensions));
  });

  it("resizes backing stores on DPR change without resetting a user camera", () => {
    const { container } = render(
      <PlanCanvas document={plan} states={states} onSelect={vi.fn()} />,
    );
    flushFrames();
    wheel(host(container), { deltaY: 80, ctrlKey: true });
    flushFrames();
    const moved = lastFrame().camera;
    property(window, "devicePixelRatio", 3);
    fireEvent(window, new Event("resize"));
    flushFrames();
    expect(lastFrame().camera).toEqual(moved);
    expect(lastFrame().dpr).toBe(3);
    expect(painter.render.mock.calls.at(-1)![2]).toBe(true);
    for (const canvas of container.querySelectorAll("canvas"))
      expect(canvas.width).toBe(2400);
    act(() => observers[0]!.resize());
    flushFrames();
    expect(lastFrame().camera).toEqual(moved);
  });

  it("ignores zero-size observations and forces redraw after a real size change", () => {
    render(<PlanCanvas document={plan} states={states} onSelect={vi.fn()} />);
    flushFrames();
    const initial = lastFrame();
    dimensions = { width: 0, height: 0 };
    act(() => observers[0]!.resize());
    flushFrames();
    expect(painter.render).toHaveBeenCalledTimes(1);
    expect(lastFrame()).toBe(initial);
    dimensions = { width: 420, height: 480 };
    act(() => observers[0]!.resize());
    flushFrames();
    expect(lastFrame().viewport).toEqual(dimensions);
    expect(painter.render.mock.calls.at(-1)![2]).toBe(true);
  });

  it("cleans observers, wheel/resize handlers and pending animation frames on unmount", async () => {
    const { container, unmount } = render(
      <PlanCanvas document={plan} states={states} onSelect={vi.fn()} />,
    );
    const element = host(container);
    unmount();
    expect(observers[0]!.disconnect).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    expect(wheel(element, { deltaY: 20 }).defaultPrevented).toBe(false);
    fireEvent(window, new Event("resize"));
    await act(async () => fontsReady());
    flushFrames();
    expect(painter.render).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it("fits a new floor and replaces the observer/layer instance", () => {
    const { container, rerender } = render(
      <PlanCanvas document={plan} states={states} onSelect={vi.fn()} />,
    );
    flushFrames();
    wheel(host(container), { deltaY: 120 });
    flushFrames();
    const next = { ...plan, bounds: { w: 2000, h: 1400 } };
    rerender(<PlanCanvas document={next} states={states} onSelect={vi.fn()} />);
    flushFrames();
    expect(observers[0]!.disconnect).toHaveBeenCalledTimes(1);
    expect(painter.create).toHaveBeenCalledTimes(2);
    expect(lastFrame().camera).toEqual(fit(next.bounds, dimensions));
    expect(painter.render.mock.calls.at(-1)![2]).toBe(true);
  });

  it("repositions a new offscreen selection but does not chase subsequent user panning", () => {
    const onSelect = vi.fn();
    const { container, rerender } = render(
      <PlanCanvas document={plan} states={states} onSelect={onSelect} />,
    );
    flushFrames();
    const element = host(container);
    wheel(element, { deltaY: 900 });
    flushFrames();
    const moved = lastFrame().camera;
    rerender(
      <PlanCanvas
        document={plan}
        states={states}
        selectedSpaceId={first}
        onSelect={onSelect}
      />,
    );
    flushFrames();
    flushFrames();
    expect(lastFrame().camera).not.toEqual(moved);
    const visible = toScreen([120, 120], lastFrame().camera);
    expect(visible[1]).toBeGreaterThanOrEqual(24);
    expect(visible[1]).toBeLessThanOrEqual(dimensions.height - 24);
    wheel(element, { deltaY: 800 });
    flushFrames();
    const pannedAgain = lastFrame().camera;
    rerender(
      <PlanCanvas
        document={plan}
        states={new Map(states)}
        selectedSpaceId={first}
        onSelect={onSelect}
      />,
    );
    flushFrames();
    expect(lastFrame().camera).toEqual(pannedAgain);
    rerender(
      <PlanCanvas document={plan} states={states} onSelect={onSelect} />,
    );
    flushFrames();
    rerender(
      <PlanCanvas
        document={plan}
        states={states}
        selectedSpaceId={first}
        onSelect={onSelect}
      />,
    );
    flushFrames();
    flushFrames();
    expect(lastFrame().camera).not.toEqual(pannedAgain);
  });

  it("selects a space above an overlapping seat, hovers restricted spaces but cannot select them", () => {
    const onSelect = vi.fn();
    const onHover = vi.fn();
    const { container } = render(
      <PlanCanvas
        document={plan}
        states={states}
        onSelect={onSelect}
        onHover={onHover}
      />,
    );
    flushFrames();
    const element = host(container);
    const camera = lastFrame().camera;
    tap(element, toScreen([120, 120], camera));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "room-a", kind: "space" }),
    );
    onSelect.mockClear();
    const restricted = toScreen([800, 120], camera);
    fireEvent.pointerMove(element, {
      ...client(restricted),
      pointerType: "mouse",
    });
    expect(onHover).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "room-b" }),
    );
    tap(element, restricted);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.pointerLeave(element);
    expect(onHover).toHaveBeenLastCalledWith(null);
  });

  it("does not select or hover filtered geometry", () => {
    const filtered: PlanStates = new Map([
      [first, { kind: "free", name: "회의실 A", hidden: true }],
    ]);
    const onSelect = vi.fn();
    const onHover = vi.fn();
    const { container } = render(
      <PlanCanvas
        document={plan}
        states={filtered}
        onSelect={onSelect}
        onHover={onHover}
      />,
    );
    flushFrames();
    const element = host(container);
    const point = toScreen([120, 120], lastFrame().camera);
    fireEvent.pointerMove(element, { ...client(point), pointerType: "mouse" });
    tap(element, point);
    expect(onHover).toHaveBeenLastCalledWith(null);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("pans a drag without selecting, and cancels an unfinished gesture", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <PlanCanvas document={plan} states={states} onSelect={onSelect} />,
    );
    flushFrames();
    const element = host(container);
    const before = lastFrame().camera;
    const point = toScreen([120, 120], before);
    fireEvent.pointerDown(element, {
      ...client(point),
      pointerId: 8,
      button: 0,
    });
    fireEvent.pointerMove(element, {
      ...client([point[0] + 20, point[1] + 30]),
      pointerId: 8,
    });
    fireEvent.pointerUp(element, {
      ...client([point[0] + 20, point[1] + 30]),
      pointerId: 8,
    });
    flushFrames();
    expect(lastFrame().camera).toEqual({
      ...before,
      x: before.x + 20,
      y: before.y + 30,
    });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.pointerDown(element, {
      ...client(point),
      pointerId: 9,
      button: 0,
    });
    fireEvent.pointerCancel(element, { pointerId: 9 });
    fireEvent.pointerUp(element, { ...client(point), pointerId: 9 });
    expect(onSelect).not.toHaveBeenCalled();
  });
});

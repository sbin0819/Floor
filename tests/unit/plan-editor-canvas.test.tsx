import { Activity } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorCanvas } from "@/features/floor-plan/editor/editor-canvas";
import { PlanEditorContext } from "@/features/floor-plan/editor/editor-context";
import {
  handles,
  hitHandle,
  insideSelection,
  isRectangle,
  rectanglePoints,
  resizedBox,
  selectionBox,
} from "@/features/floor-plan/editor/canvas-geometry";
import { moveShapesCommand } from "@/features/floor-plan/editor/transforms";
import { fit, toScreen } from "@/lib/floor-plan/render/camera";
import { createScene } from "@/lib/floor-plan/render/scene";
import { createSpatialIndex } from "@/lib/floor-plan/render/spatial-index";
import { hitTest } from "@/lib/floor-plan/render/hit-test";
import type {
  PlanColors,
  PlanContext,
  PlanStates,
  Point,
} from "@/lib/floor-plan/render/types";
import {
  editorDocument,
  editorSpaceId,
  editorStore,
} from "../helpers/plan-editor-store";

vi.mock("@/features/floor-plan/components/use-plan-colors", () => ({
  usePlanColors: () => colors,
}));
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
  [editorSpaceId, { kind: "free", name: "회의실 A" }],
]);
const viewport = { width: 1000, height: 700 };
const bounds = {
  ...viewport,
  x: 40,
  y: 60,
  left: 40,
  top: 60,
  right: 1040,
  bottom: 760,
  toJSON: () => ({}),
};
let frames: Map<number, FrameRequestCallback>;
let frameId = 0;
let contexts: Map<HTMLCanvasElement, ReturnType<typeof recordingContext>>;
let observers: FakeResizeObserver[];
let fontsReady: () => void;
const descriptors: {
  owner: object;
  key: string;
  value?: PropertyDescriptor;
}[] = [];
function property(owner: object, key: string, value: unknown) {
  descriptors.push({
    owner,
    key,
    value: Object.getOwnPropertyDescriptor(owner, key),
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
  constructor(readonly callback: ResizeObserverCallback) {
    observers.push(this);
  }
}
class Pointer extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, input: PointerEventInit = {}) {
    super(type, input);
    this.pointerId = input.pointerId ?? 1;
  }
}
function recordingContext() {
  const clearRect = vi.fn();
  const ctx: PlanContext & Pick<CanvasRenderingContext2D, "strokeRect"> = {
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    clearRect,
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    rect: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    clip: vi.fn(),
    setLineDash: vi.fn(),
    fillText: vi.fn(),
    measureText: (text) => ({ width: text.length * 5 }) as TextMetrics,
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
  return { ctx, clearRect };
}
function flushFrames() {
  act(() => {
    const pending = [...frames];
    frames.clear();
    for (const [id, callback] of pending) callback(id * 16);
  });
}
function harness(store = editorStore(), onPolygon = vi.fn()) {
  let focusIds: readonly string[] = [];
  const view = (visible = true) => (
    <Activity mode={visible ? "visible" : "hidden"}>
      <PlanEditorContext value={store}>
        <main>
          <input aria-label="숫자 입력" />
          <EditorCanvas
            states={states}
            onPolygon={onPolygon}
            focusIds={focusIds}
          />
        </main>
      </PlanEditorContext>
    </Activity>
  );
  const rendered = render(view());
  flushFrames();
  const host = screen.getByRole("application", { name: "평면도 편집 캔버스" });
  const point = (world: Point) => {
    const camera =
      store.getState().camera ??
      fit(store.getState().document.bounds, viewport);
    const screen = toScreen(world, camera);
    return {
      clientX: screen[0] + bounds.left,
      clientY: screen[1] + bounds.top,
      pointerId: 1,
      button: 0,
    };
  };
  const down = (world: Point, extra: PointerEventInit = {}) =>
    fireEvent.pointerDown(host, { ...point(world), ...extra });
  const move = (world: Point, extra: PointerEventInit = {}) =>
    fireEvent.pointerMove(host, { ...point(world), ...extra });
  const up = (world: Point, extra: PointerEventInit = {}) =>
    fireEvent.pointerUp(host, { ...point(world), ...extra });
  const tap = (world: Point, extra: PointerEventInit = {}) => {
    down(world, extra);
    up(world, extra);
  };
  return {
    ...rendered,
    store,
    onPolygon,
    host,
    down,
    move,
    up,
    tap,
    key: (key: string, extra: KeyboardEventInit = {}) =>
      fireEvent.keyDown(host, { key, ...extra }),
    visibility: (visible: boolean) => rendered.rerender(view(visible)),
    focusShapes: (ids: readonly string[]) => {
      focusIds = ids;
      rendered.rerender(view());
    },
  };
}
beforeEach(() => {
  frames = new Map();
  contexts = new Map();
  observers = [];
  frameId = 0;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("PointerEvent", Pointer);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  property(document, "fonts", {
    ready: new Promise<void>((resolve) => {
      fontsReady = resolve;
    }),
  });
  property(HTMLElement.prototype, "setPointerCapture", vi.fn());
  property(HTMLElement.prototype, "releasePointerCapture", vi.fn());
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    bounds,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      if (!contexts.has(this)) contexts.set(this, recordingContext());
      return contexts.get(this)!.ctx as CanvasRenderingContext2D;
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const entry of descriptors.splice(0).reverse()) {
    if (entry.value) Object.defineProperty(entry.owner, entry.key, entry.value);
    else Reflect.deleteProperty(entry.owner, entry.key);
  }
});

describe("editor canvas pointer and keyboard", () => {
  it("draws a snapped rectangle without committing until the parent connects it", () => {
    const h = harness();
    h.key("r");
    const original = h.store.getState().document;
    h.down([8070, 3070]);
    h.move([12170, 7140]);
    flushFrames();
    expect(h.onPolygon).not.toHaveBeenCalled();
    expect(h.store.getState().document).toBe(original);
    h.up([12170, 7140]);
    expect(h.onPolygon).toHaveBeenCalledExactlyOnceWith([
      [8100, 3100],
      [12200, 3100],
      [12200, 7100],
      [8100, 7100],
    ]);
    expect(h.store.getState().undoStack).toHaveLength(0);
  });
  it("Alt disables grid rounding but keeps integer coordinates", () => {
    const h = harness();
    h.key("r");
    h.down([8053, 3051], { altKey: true });
    h.up([12173, 7149], { altKey: true });
    expect(h.onPolygon).toHaveBeenCalledExactlyOnceWith([
      [8053, 3051],
      [12173, 3051],
      [12173, 7149],
      [8053, 7149],
    ]);
  });
  it("finishes polygons with Enter, Backspace removes one vertex, and Escape cancels", () => {
    const h = harness();
    h.key("p");
    h.tap([8000, 3000]);
    h.tap([12000, 3000]);
    h.tap([12000, 7000]);
    h.key("Backspace");
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent(
      "꼭짓점 2개",
    );
    h.key("Enter");
    expect(h.onPolygon).not.toHaveBeenCalled();
    h.tap([8000, 7000]);
    h.key("Enter");
    expect(h.onPolygon).toHaveBeenCalledExactlyOnceWith([
      [8000, 3000],
      [12000, 3000],
      [8000, 7000],
    ]);
    h.tap([8000, 3000]);
    h.tap([12000, 3000]);
    h.key("Escape");
    h.key("Enter");
    expect(h.onPolygon).toHaveBeenCalledTimes(1);
    expect(h.store.getState().document.spaces).toHaveLength(1);
  });
  it("closes a polygon by its first point without duplicating the final vertex", () => {
    const h = harness();
    h.key("p");
    h.tap([8000, 3000]);
    h.tap([12000, 3000]);
    h.tap([12000, 7000]);
    h.tap([8000, 3000]);
    expect(h.onPolygon).toHaveBeenCalledExactlyOnceWith([
      [8000, 3000],
      [12000, 3000],
      [12000, 7000],
    ]);
  });
  it("previews dragging in only the overlay and commits one command on pointerup", () => {
    const h = harness();
    const original = h.store.getState().document;
    const [base, state, overlay] = [...contexts.values()];
    base!.clearRect.mockClear();
    state!.clearRect.mockClear();
    overlay!.clearRect.mockClear();
    h.down([2000, 2000]);
    h.move([2500, 2500]);
    h.move([3000, 3000]);
    flushFrames();
    expect(h.store.getState().document).toBe(original);
    expect(h.store.getState().undoStack).toHaveLength(0);
    expect(base!.clearRect).not.toHaveBeenCalled();
    expect(state!.clearRect).not.toHaveBeenCalled();
    expect(overlay!.clearRect).toHaveBeenCalled();
    h.up([3000, 3000]);
    expect(h.store.getState().undoStack).toHaveLength(1);
    expect(h.store.getState().document.spaces[0]!.polygon[0]).toEqual([
      2000, 2000,
    ]);
    h.key("z", { metaKey: true });
    expect(h.store.getState().document).toEqual(original);
    h.key("z", { ctrlKey: true, shiftKey: true });
    expect(h.store.getState().document.spaces[0]!.polygon[0]).toEqual([
      2000, 2000,
    ]);
  });
  it("selects an off-grid shape by click without snapping or creating an edit", () => {
    const doc = editorDocument();
    doc.spaces[0]!.polygon = [
      [1025, 1050],
      [3025, 1050],
      [3025, 3050],
      [1025, 3050],
    ];
    const h = harness(editorStore(doc));
    h.tap([2000, 2000]);
    expect(h.store.getState().selectedIds).toEqual(["a"]);
    expect(h.store.getState().changeId).toBe(0);
    expect(h.store.getState().document).toBe(doc);
  });
  it.each(["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const)(
    "resizes using the %s handle and preserves one undo step",
    (name) => {
      const h = harness();
      act(() => h.store.getState().select(["a"]));
      const box = selectionBox(h.store.getState().document, ["a"])!;
      const handle = handles(box).find((value) => value.name === name)!;
      const destination: Point = [
        handle.at[0] +
          (name.includes("w") ? -500 : name.includes("e") ? 500 : 0),
        handle.at[1] +
          (name.includes("n") ? -500 : name.includes("s") ? 500 : 0),
      ];
      h.down(handle.at);
      h.move(destination);
      expect(h.store.getState().undoStack).toHaveLength(0);
      h.up(destination);
      expect(h.store.getState().undoStack).toHaveLength(1);
      const expected = resizedBox(box, name, destination);
      expect(selectionBox(h.store.getState().document, ["a"])).toEqual({
        minX: expected.x,
        minY: expected.y,
        maxX: expected.x + expected.width,
        maxY: expected.y + expected.height,
      });
    },
  );
  it("marquee selects only fully contained editable shapes and Shift toggles hit selection", () => {
    const h = harness();
    h.down([500, 500]);
    h.move([7500, 7500]);
    h.up([7500, 7500]);
    expect([...h.store.getState().selectedIds].sort()).toEqual(["a", "b"]);
    h.tap([10000, 10000], { shiftKey: true });
    expect([...h.store.getState().selectedIds].sort()).toEqual(["a", "b", "c"]);
    h.tap([2000, 2000], { shiftKey: true });
    expect(h.store.getState().selectedIds).toEqual(["b", "c"]);
    expect(h.store.getState().changeId).toBe(0);
  });
  it("moves by 100 or 1000mm, duplicates fixtures only and ignores all input shortcuts", () => {
    const h = harness();
    h.tap([2000, 2000]);
    h.key("ArrowRight");
    h.key("ArrowDown", { shiftKey: true });
    expect(h.store.getState().document.spaces[0]!.polygon[0]).toEqual([
      1100, 2000,
    ]);
    h.key("d", { metaKey: true });
    expect(h.store.getState().document.spaces).toHaveLength(1);
    h.tap([6000, 6000]);
    h.key("d", { ctrlKey: true });
    expect(h.store.getState().document.fixtures).toHaveLength(4);
    const count = h.store.getState().changeId;
    const input = screen.getByRole("textbox", { name: "숫자 입력" });
    for (const key of [
      "Delete",
      "Backspace",
      "ArrowRight",
      "g",
      "p",
      "r",
      "v",
      "z",
      "d",
    ])
      fireEvent.keyDown(input, { key, ctrlKey: true });
    expect(h.store.getState().changeId).toBe(count);
    expect(h.store.getState().tool).toBe("select");
    h.key("Delete");
    expect(h.store.getState().selectedIds).toEqual([]);
  });
  it("cancels drags on Escape, pointer cancellation, lost capture or a concurrent edit", () => {
    const h = harness();
    h.down([2000, 2000]);
    h.move([2500, 2500]);
    h.key("Escape");
    h.up([2500, 2500]);
    expect(h.store.getState().changeId).toBe(0);
    h.down([2000, 2000]);
    h.move([2500, 2500]);
    fireEvent.pointerCancel(h.host, { pointerId: 1 });
    h.up([2500, 2500]);
    expect(h.store.getState().changeId).toBe(0);
    h.down([2000, 2000]);
    h.move([2500, 2500]);
    fireEvent.lostPointerCapture(h.host, { pointerId: 1 });
    h.up([2500, 2500]);
    expect(h.store.getState().changeId).toBe(0);
    h.down([2000, 2000]);
    h.move([2500, 2500]);
    act(() =>
      h.store.getState().execute(
        moveShapesCommand(h.store.getState().document, ["b"], [100, 0], {
          snap: false,
        }),
      ),
    );
    h.up([2500, 2500]);
    expect(h.store.getState().changeId).toBe(1);
    expect(h.store.getState().document.spaces[0]!.polygon[0]).toEqual([
      1000, 1000,
    ]);
  });
  it("pans with held Space, zooms/fits without document changes and provides keyboard-accessible shape selection", () => {
    const h = harness();
    const original = h.store.getState().document;
    h.key(" ", { code: "Space" });
    h.down([12000, 10000]);
    h.move([14000, 12000]);
    h.up([14000, 12000]);
    fireEvent.keyUp(h.host, { key: " ", code: "Space" });
    expect(h.store.getState().camera).not.toBeNull();
    expect(h.store.getState().document).toBe(original);
    fireEvent.click(screen.getByRole("button", { name: "평면도 확대" }));
    expect(
      screen.getByRole("status", { name: "평면도 배율" }),
    ).not.toHaveTextContent("100%");
    fireEvent.click(screen.getByRole("button", { name: "맞춤" }));
    expect(h.store.getState().camera).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "회의실 A" }));
    expect(h.store.getState().selectedIds).toEqual(["a"]);
    expect(h.store.getState().changeId).toBe(0);
  });
  it("cleans RAF, resize, wheel and keyboard listeners on unmount, including delayed fonts", async () => {
    const h = harness();
    h.tap([2000, 2000]);
    h.move([3000, 3000]);
    h.unmount();
    expect(
      observers.every((observer) => observer.disconnect.mock.calls.length > 0),
    ).toBe(true);
    expect(frames.size).toBe(0);
    fireEvent.keyDown(document.body, { key: "Delete" });
    fireEvent.wheel(h.host, { deltaY: 100 });
    await act(async () => fontsReady());
    expect(h.store.getState().changeId).toBe(0);
    expect(h.store.getState().camera).toBeNull();
    expect(frames.size).toBe(0);
  });
  it("disables mutation when already stale", () => {
    const h = harness();
    act(() => h.store.setState({ saveState: "stale" }));
    h.tap([2000, 2000]);
    h.key("Delete");
    h.key("r");
    expect(h.store.getState().changeId).toBe(0);
    expect(h.store.getState().selectedIds).toEqual([]);
    expect(h.store.getState().tool).toBe("select");
  });
  it("selects seats before their area, rotates and duplicates with an empty label in one command", () => {
    const doc = editorDocument();
    doc.seats = [
      {
        id: "seat",
        spaceId: "20000000-0000-4000-8000-000000000002",
        at: [2000, 2000],
        size: [1400, 700],
        rotation: 0,
        label: "A-01",
      },
    ];
    const h = harness(editorStore(doc));
    h.tap([2000, 2000]);
    expect(h.store.getState().selectedIds).toEqual(["seat"]);
    h.key("r");
    expect(h.store.getState().document.seats[0]!.rotation).toBe(90);
    expect(h.store.getState().tool).toBe("select");
    h.key("ArrowRight");
    expect(h.store.getState().document.seats[0]!.at).toEqual([2100, 2000]);
    h.key("d", { metaKey: true });
    const copy = h.store.getState().document.seats[1]!;
    expect(copy.id).not.toBe("seat");
    expect(copy.spaceId).not.toBe(doc.seats[0]!.spaceId);
    expect(copy).not.toHaveProperty("label");
    expect(h.store.getState().undoStack).toHaveLength(3);
    h.key("z", { metaKey: true });
    expect(h.store.getState().document.seats).toHaveLength(1);
    expect(screen.getByRole("button", { name: "A-01" })).toBeInTheDocument();
    h.key("Delete");
    expect(h.store.getState().document.seats).toHaveLength(0);
  });
  it("drops active gestures and keyboard edits while publishing locks the editor", () => {
    const h = harness();
    h.down([2000, 2000]);
    h.move([2500, 2500]);
    act(() => h.store.getState().setWriteLocked(true));
    h.up([2500, 2500]);
    for (const key of ["r", "Delete", "ArrowRight"]) h.key(key);
    expect(h.store.getState().changeId).toBe(0);
    expect(h.store.getState().tool).toBe("select");
  });
  it("drops an in-progress drag if a STALE response arrives before pointerup", () => {
    const h = harness();
    h.down([2000, 2000]);
    h.move([2500, 2500]);
    act(() => h.store.setState({ saveState: "stale" }));
    h.up([2500, 2500]);
    expect(h.store.getState().changeId).toBe(0);
    expect(h.store.getState().document.spaces[0]!.polygon[0]).toEqual([
      1000, 1000,
    ]);
  });
  it("discards a transient gesture across Activity while preserving committed document and selection", () => {
    const h = harness();
    h.down([2000, 2000]);
    h.move([2500, 2500]);
    const original = h.store.getState().document;
    h.visibility(false);
    expect(frames.size).toBe(0);
    h.visibility(true);
    flushFrames();
    expect(h.store.getState().document).toBe(original);
    expect(h.store.getState().selectedIds).toEqual(["a"]);
    h.up([2500, 2500]);
    expect(h.store.getState().changeId).toBe(0);
  });
  it("reveals requested issue shapes once without following later pan or document edits", () => {
    const h = harness();
    const offscreen = { scale: 0.02, x: -1000, y: -1000 };
    act(() => h.store.getState().setCamera(offscreen));
    const request = ["a"];
    h.focusShapes(request);
    flushFrames();
    expect(h.store.getState().camera).not.toEqual(offscreen);
    const centered = h.store.getState().camera;
    act(() => h.store.getState().setCamera(offscreen));
    h.focusShapes(request);
    flushFrames();
    expect(h.store.getState().camera).toEqual(offscreen);
    act(() =>
      h.store.getState().execute(
        moveShapesCommand(h.store.getState().document, ["a"], [100, 0], {
          snap: false,
        }),
      ),
    );
    flushFrames();
    expect(h.store.getState().camera).toEqual(offscreen);
    h.focusShapes(["a"]);
    flushFrames();
    expect(h.store.getState().camera).not.toEqual(offscreen);
    expect(h.store.getState().camera).not.toEqual(centered);
  });
});

describe("editor canvas geometry", () => {
  it("includes rotated seats in selection bounds and marquee without turning walls into editable shapes", () => {
    const doc = editorDocument();
    doc.seats = [
      {
        id: "seat",
        spaceId: "20000000-0000-4000-8000-000000000002",
        at: [2000, 2000],
        size: [1400, 700],
        rotation: 90,
      },
    ];
    const box = selectionBox(doc, ["seat"])!;
    expect(box.minX).toBeCloseTo(1650);
    expect(box.minY).toBeCloseTo(1300);
    expect(box.maxX).toBeCloseTo(2350);
    expect(box.maxY).toBeCloseTo(2700);
    const seat = createScene(doc).shapes.find(({ id }) => id === "seat")!;
    expect(
      insideSelection({ minX: 1000, minY: 1000, maxX: 3000, maxY: 3000 }, seat),
    ).toBe(true);
    expect(
      insideSelection({ minX: 1800, minY: 1000, maxX: 3000, maxY: 3000 }, seat),
    ).toBe(false);
  });
  it("opts into fixture hits without changing member default seat/space priority", () => {
    const doc = editorDocument();
    doc.fixtures[0]!.polygon = doc.spaces[0]!.polygon;
    doc.seats = [
      {
        id: "seat",
        spaceId: "20000000-0000-4000-8000-000000000002",
        at: [2000, 2000],
        size: [1000, 1000],
        rotation: 0,
      },
    ];
    const scene = createScene(doc),
      index = createSpatialIndex(scene.shapes),
      camera = fit(doc.bounds, viewport),
      point = toScreen([2000, 2000], camera);
    expect(hitTest(index, camera, point)?.kind).toBe("seat");
    expect(hitTest(index, camera, point, { kinds: ["fixture"] })?.id).toBe("b");
    expect(hitTest(index, camera, toScreen([10000, 10000], camera))).toBeNull();
    expect(
      hitTest(index, camera, toScreen([10000, 10000], camera), {
        kinds: ["fixture"],
      })?.id,
    ).toBe("c");
  });
  it("normalizes rectangle endpoints and rejects non-axis-aligned numeric rectangles", () => {
    expect(rectanglePoints([20, 30], [1, 2])).toEqual([
      [1, 2],
      [20, 2],
      [20, 30],
      [1, 30],
    ]);
    expect(isRectangle(rectanglePoints([20, 30], [1, 2]))).toBe(true);
    expect(
      isRectangle([
        [0, 10],
        [10, 0],
        [20, 10],
        [10, 20],
      ]),
    ).toBe(false);
    expect(
      isRectangle([
        [0, 0],
        [10, 10],
        [10, 0],
        [0, 10],
      ]),
    ).toBe(false);
  });
  it("hit handles are 8 CSS pixels and marquee excludes unsupported shapes", () => {
    const doc = editorDocument(),
      camera = { scale: 0.02, x: 0, y: 0 };
    const box = selectionBox(doc, ["a"])!;
    expect(handles(box)).toHaveLength(8);
    expect(hitHandle(box, [20 - 8, 20], camera)).toBe("nw");
    expect(hitHandle(box, [20 - 8.01, 20], camera)).toBeNull();
    const scene = createScene(doc);
    expect(
      insideSelection(
        { minX: 0, minY: 0, maxX: 30000, maxY: 20000 },
        scene.shapes.find(({ id }) => id === "wall")!,
      ),
    ).toBe(false);
    expect(selectionBox(doc, ["wall"])).toBeNull();
  });
});

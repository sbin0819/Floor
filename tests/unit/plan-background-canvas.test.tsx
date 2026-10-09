import { Activity, useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BackgroundCanvas,
  type BackgroundCanvasProps,
} from "@/features/floor-plan/editor/background-canvas";

class FakeImage {
  src = "";
  decoding = "auto";
  naturalWidth = 640;
  naturalHeight = 480;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  removeAttribute = vi.fn((name: string) => {
    if (name === "src") this.src = "";
  });
  constructor() {
    images.push(this);
  }
}
let images: FakeImage[];
let frameId: number;
let frames: Map<number, FrameRequestCallback>;
const context = {
  save: vi.fn(),
  restore: vi.fn(),
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  drawImage: vi.fn(),
  globalAlpha: 1,
};
const props: BackgroundCanvasProps = {
  background: { transform: [10, 0, 0, 10, 100, 200], opacity: 0.35 },
  src: "/api/plan-backgrounds/a1000000-0000-4000-8000-000000000001",
  camera: { scale: 0.2, x: 50, y: 20 },
  viewport: { width: 800, height: 500 },
};
function flush() {
  act(() => {
    const pending = [...frames];
    frames.clear();
    for (const [id, callback] of pending) callback(id * 16);
  });
}
function load(index = images.length - 1) {
  act(() => images[index]!.onload?.());
  flush();
}
beforeEach(() => {
  vi.clearAllMocks();
  images = [];
  frames = new Map();
  frameId = 0;
  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal("devicePixelRatio", 2);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    }),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn((id: number) => frames.delete(id)),
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("editor background canvas", () => {
  it("composes image pixels→mm→camera→DPR and stays decorative/noninteractive", () => {
    const { container } = render(<BackgroundCanvas {...props} />);
    flush();
    expect(context.drawImage).not.toHaveBeenCalled();
    expect(images[0]!.src).toBe(props.src);
    expect(images[0]!.decoding).toBe("async");
    load();
    const canvas = container.querySelector("canvas")!;
    expect([canvas.width, canvas.height]).toEqual([1600, 1000]);
    expect(canvas).toHaveAttribute("aria-hidden", "true");
    expect(canvas).toHaveClass("pointer-events-none");
    expect(context.setTransform).toHaveBeenLastCalledWith(4, 0, 0, 4, 140, 120);
    expect(context.drawImage).toHaveBeenCalledExactlyOnceWith(images[0], 0, 0);
    expect(context.globalAlpha).toBe(0.35);
    expect(context.save).toHaveBeenCalledTimes(1);
    expect(context.restore).toHaveBeenCalledTimes(1);
  });
  it("handles a rotated background without treating the transform as a screen-space transform", () => {
    render(
      <BackgroundCanvas
        {...props}
        background={{ transform: [0, 10, -10, 0, 300, 400], opacity: 0.6 }}
      />,
    );
    load();
    expect(context.setTransform).toHaveBeenLastCalledWith(
      0,
      4,
      -4,
      0,
      220,
      200,
    );
    expect(context.globalAlpha).toBe(0.6);
  });
  it("reports natural dimensions once per load without reloading for a changed callback", () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { rerender } = render(
      <BackgroundCanvas {...props} onImageSize={first} />,
    );
    rerender(<BackgroundCanvas {...props} onImageSize={latest} />);
    load();
    load();
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledExactlyOnceWith({ width: 640, height: 480 });
    expect(images).toHaveLength(1);
    rerender(
      <BackgroundCanvas
        {...props}
        src={`${props.src}?image=next`}
        onImageSize={latest}
      />,
    );
    images[1]!.naturalWidth = 200;
    images[1]!.naturalHeight = 100;
    load();
    expect(latest).toHaveBeenLastCalledWith({ width: 200, height: 100 });
    expect(latest).toHaveBeenCalledTimes(2);
  });
  it("does not reload or redraw for referentially-new but numerically-identical props", () => {
    const { rerender } = render(<BackgroundCanvas {...props} />);
    load();
    context.drawImage.mockClear();
    context.clearRect.mockClear();
    rerender(
      <BackgroundCanvas
        {...props}
        camera={{ ...props.camera }}
        viewport={{ ...props.viewport }}
        background={{
          ...props.background!,
          transform: [...props.background!.transform],
        }}
        onLoadError={() => undefined}
      />,
    );
    flush();
    expect(images).toHaveLength(1);
    expect(context.drawImage).not.toHaveBeenCalled();
    expect(context.clearRect).not.toHaveBeenCalled();
  });
  it("coalesces camera changes while reusing the image", () => {
    const { rerender } = render(<BackgroundCanvas {...props} />);
    load();
    context.drawImage.mockClear();
    rerender(
      <BackgroundCanvas {...props} camera={{ scale: 0.3, x: 20, y: 10 }} />,
    );
    rerender(
      <BackgroundCanvas {...props} camera={{ scale: 0.5, x: 10, y: 30 }} />,
    );
    expect(frames.size).toBe(1);
    flush();
    expect(images).toHaveLength(1);
    expect(context.drawImage).toHaveBeenCalledTimes(1);
    expect(context.setTransform).toHaveBeenLastCalledWith(
      10,
      0,
      0,
      10,
      120,
      260,
    );
  });
  it("redraws on opacity/transform changes without decoding again", () => {
    const { rerender } = render(<BackgroundCanvas {...props} />);
    load();
    context.drawImage.mockClear();
    rerender(
      <BackgroundCanvas
        {...props}
        background={{ transform: [20, 0, 0, 20, 0, 0], opacity: 0.1 }}
      />,
    );
    flush();
    expect(images).toHaveLength(1);
    expect(context.drawImage).toHaveBeenCalledTimes(1);
    expect(context.setTransform).toHaveBeenLastCalledWith(8, 0, 0, 8, 100, 40);
    expect(context.globalAlpha).toBe(0.1);
  });
  it("responds to viewport changes and DPR-only resize", () => {
    const { container, rerender } = render(<BackgroundCanvas {...props} />);
    load();
    rerender(
      <BackgroundCanvas {...props} viewport={{ width: 640, height: 400 }} />,
    );
    flush();
    const canvas = container.querySelector("canvas")!;
    expect([canvas.width, canvas.height]).toEqual([1280, 800]);
    context.drawImage.mockClear();
    vi.stubGlobal("devicePixelRatio", 3);
    fireEvent(window, new Event("resize"));
    flush();
    expect([canvas.width, canvas.height]).toEqual([1920, 1200]);
    expect(context.drawImage).toHaveBeenCalledTimes(1);
    const transform = context.setTransform.mock.calls.at(-1)!;
    [6, 0, 0, 6, 210, 180].forEach((value, index) =>
      expect(transform[index]).toBeCloseTo(value, 12),
    );
  });
  it("never loads an image when no document background or image source exists", () => {
    const { rerender } = render(
      <BackgroundCanvas {...props} background={undefined} />,
    );
    flush();
    expect(images).toHaveLength(0);
    rerender(<BackgroundCanvas {...props} src={null} />);
    flush();
    expect(images).toHaveLength(0);
    expect(context.drawImage).not.toHaveBeenCalled();
  });
  it("clears the old bitmap immediately on source change and ignores its late success/error", () => {
    const error = vi.fn();
    const { rerender } = render(
      <BackgroundCanvas {...props} onLoadError={error} />,
    );
    const old = images[0]!;
    const staleLoad = old.onload;
    const staleError = old.onerror;
    load();
    context.drawImage.mockClear();
    error.mockClear();
    rerender(
      <BackgroundCanvas
        {...props}
        src={`${props.src}?image=next`}
        onLoadError={error}
      />,
    );
    flush();
    expect(context.drawImage).not.toHaveBeenCalled();
    expect(old.removeAttribute).toHaveBeenCalledWith("src");
    act(() => {
      staleLoad?.();
      staleError?.();
    });
    flush();
    expect(error.mock.calls).toEqual([[false]]);
    expect(context.drawImage).not.toHaveBeenCalled();
    load();
    expect(context.drawImage).toHaveBeenCalledExactlyOnceWith(images[1], 0, 0);
  });
  it("drops the image and clears the canvas when the background is removed", () => {
    const { rerender } = render(<BackgroundCanvas {...props} />);
    load();
    context.drawImage.mockClear();
    context.clearRect.mockClear();
    rerender(<BackgroundCanvas {...props} background={undefined} />);
    flush();
    expect(context.drawImage).not.toHaveBeenCalled();
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 1600, 1000);
    expect(images[0]!.onload).toBeNull();
  });
  it("ignores load after unmount and cancels pending drawing/listeners", () => {
    const error = vi.fn();
    const { unmount } = render(
      <BackgroundCanvas {...props} onLoadError={error} />,
    );
    const stale = images[0]!.onload;
    const removed = vi.spyOn(window, "removeEventListener");
    unmount();
    error.mockClear();
    act(() => stale?.());
    flush();
    fireEvent(window, new Event("resize"));
    expect(frames.size).toBe(0);
    expect(error).not.toHaveBeenCalled();
    expect(context.drawImage).not.toHaveBeenCalled();
    expect(removed).toHaveBeenCalledWith("resize", expect.any(Function));
  });
  it("reloads safely after Activity reactivation without drawing a hidden late image", () => {
    const view = (visible: boolean) => (
      <Activity mode={visible ? "visible" : "hidden"}>
        <BackgroundCanvas {...props} />
      </Activity>
    );
    const { rerender } = render(view(true));
    const stale = images[0]!.onload;
    rerender(view(false));
    act(() => stale?.());
    flush();
    expect(context.drawImage).not.toHaveBeenCalled();
    rerender(view(true));
    expect(images).toHaveLength(2);
    load();
    expect(context.drawImage).toHaveBeenCalledExactlyOnceWith(images[1], 0, 0);
  });
  it("reports only safe boolean errors and callback-driven rerender does not reload", () => {
    function Harness() {
      const [failed, setFailed] = useState(false);
      return (
        <>
          <BackgroundCanvas
            {...props}
            onLoadError={(value) => setFailed(value)}
          />
          <p>{failed ? "도면을 불러오지 못했어요" : "도면을 불러와요"}</p>
        </>
      );
    }
    render(<Harness />);
    act(() => images[0]!.onerror?.());
    flush();
    expect(screen.getByText("도면을 불러오지 못했어요")).toBeInTheDocument();
    expect(images).toHaveLength(1);
    expect(context.drawImage).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  createPlanPreprocessor,
  preprocessPlan,
  type PlanSceneRequest,
  type PlanWorker,
} from "@/lib/floor-plan/render/preprocess";
import { createScene } from "@/lib/floor-plan/render/scene";
import { createSpatialIndex } from "@/lib/floor-plan/render/spatial-index";
import { createStressDocument } from "@/lib/floor-plan/render/stress-document";
import { floorPlanSchema } from "@/lib/floor-plan/schema";
import {
  frameStats,
  startStressAnimation,
} from "@/lib/floor-plan/render/stress-animation";

class FakePlanWorker implements PlanWorker {
  onmessage: PlanWorker["onmessage"] = null;
  onerror: PlanWorker["onerror"] = null;
  onmessageerror: PlanWorker["onmessageerror"] = null;
  postMessage = vi.fn<(request: PlanSceneRequest) => void>();
  terminate = vi.fn();
  ready() {
    this.onmessage?.(new MessageEvent("message", { data: { type: "ready" } }));
  }
  respond(index: number) {
    const request = this.postMessage.mock.calls[index]![0];
    this.onmessage?.(
      new MessageEvent("message", { data: preprocessPlan(request) }),
    );
  }
}

describe("plan preprocessing", () => {
  it("transfers the same numeric scene through structured clone, including openings", () => {
    const document = createStressDocument();
    document.openings.push({
      id: "door-1",
      wallId: "wall-0",
      at: 0.5,
      width: 900,
      kind: "door",
    });
    const result = preprocessPlan({ id: 12, document });
    const clone = structuredClone(result);
    expect(clone).toEqual({ id: 12, scene: createScene(document) });
    expect(
      clone.scene.shapes.find((shape) => shape.kind === "opening"),
    ).toMatchObject({ radius: 900, door: true });
    expect(
      createSpatialIndex(clone.scene.shapes).search({
        minX: 0,
        minY: 0,
        maxX: 90000,
        maxY: 67500,
      }),
    ).toHaveLength(2501);
  });

  it("delivers only the latest request when workers respond out of order", () => {
    const worker = new FakePlanWorker();
    const makeWorker = vi.fn(() => worker);
    const processor = createPlanPreprocessor(makeWorker);
    const first = vi.fn();
    const second = vi.fn();
    processor.process(createStressDocument(1), first);
    worker.ready();
    const last = createStressDocument(2);
    processor.process(last, second);
    worker.respond(1);
    worker.respond(0);
    worker.respond(1);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledExactlyOnceWith(createScene(last));
    expect(makeWorker).toHaveBeenCalledTimes(1);
  });

  it.each(["unavailable", "constructor throws"])(
    "uses the exact synchronous processor if %s",
    (kind) => {
      const processor = createPlanPreprocessor(() => {
        if (kind === "constructor throws") throw new Error("unsupported");
        return null;
      });
      const receive = vi.fn();
      const document = createStressDocument();
      processor.process(document, receive);
      expect(receive).toHaveBeenCalledExactlyOnceWith(
        preprocessPlan({ id: 1, document }).scene,
      );
    },
  );

  it.each(["post", "error", "messageerror"])(
    "falls back and releases the worker on %s failure",
    (kind) => {
      const worker = new FakePlanWorker();
      if (kind === "post")
        worker.postMessage.mockImplementation(() => {
          throw new Error("clone failure");
        });
      const makeWorker = vi.fn(() => worker);
      const processor = createPlanPreprocessor(makeWorker);
      const receive = vi.fn();
      const document = createStressDocument();
      processor.process(document, receive);
      worker.ready();
      if (kind === "error")
        worker.onerror?.({ preventDefault: vi.fn() } as unknown as ErrorEvent);
      if (kind === "messageerror")
        worker.onmessageerror?.(new MessageEvent("messageerror"));
      expect(receive).toHaveBeenCalledExactlyOnceWith(createScene(document));
      expect(worker.terminate).toHaveBeenCalledTimes(1);
      expect(worker.onmessage).toBeNull();
      expect(worker.onerror).toBeNull();
      expect(worker.onmessageerror).toBeNull();
      processor.process(document, receive);
      expect(receive).toHaveBeenCalledTimes(2);
      expect(makeWorker).toHaveBeenCalledTimes(1);
    },
  );

  it("falls back for the newest document only after a late worker failure", () => {
    const worker = new FakePlanWorker();
    const processor = createPlanPreprocessor(() => worker);
    const stale = vi.fn();
    const fresh = vi.fn();
    processor.process(createStressDocument(1), stale);
    const document = createStressDocument(2);
    processor.process(document, fresh);
    worker.onerror?.({ preventDefault: vi.fn() } as unknown as ErrorEvent);
    expect(stale).not.toHaveBeenCalled();
    expect(fresh).toHaveBeenCalledExactlyOnceWith(createScene(document));
  });

  it("waits for the entry module and sends only the latest document after ready", () => {
    const worker = new FakePlanWorker();
    const processor = createPlanPreprocessor(() => worker);
    const stale = vi.fn();
    const fresh = vi.fn();
    processor.process(createStressDocument(1), stale);
    const document = createStressDocument(2);
    processor.process(document, fresh);
    expect(worker.postMessage).not.toHaveBeenCalled();
    worker.ready();
    worker.ready();
    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({
      id: 2,
      document,
    });
    worker.respond(0);
    expect(stale).not.toHaveBeenCalled();
    expect(fresh).toHaveBeenCalledExactlyOnceWith(createScene(document));
  });

  it("disposal rejects queued callbacks and terminates exactly once", () => {
    const worker = new FakePlanWorker();
    const processor = createPlanPreprocessor(() => worker);
    const receive = vi.fn();
    const document = createStressDocument();
    processor.process(document, receive);
    worker.ready();
    const late = worker.onmessage;
    processor.dispose();
    processor.dispose();
    late?.(
      new MessageEvent("message", {
        data: preprocessPlan({ id: 1, document }),
      }),
    );
    processor.process(document, receive);
    expect(receive).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
  });
});

describe("deterministic stress document", () => {
  it("has exactly 300 spaces, 2,000 seats and 200 walls within all planned schema limits", () => {
    const document = createStressDocument();
    expect(floorPlanSchema.parse(document)).toEqual(document);
    expect(document.spaces).toHaveLength(300);
    expect(document.seats).toHaveLength(2000);
    expect(document.walls).toHaveLength(200);
    expect(document.bounds.w).toBeLessThanOrEqual(100000);
    expect(document.bounds.h).toBeLessThanOrEqual(100000);
    expect(
      new TextEncoder().encode(JSON.stringify(document)).length,
    ).toBeLessThanOrEqual(900 * 1024);
    expect(
      new Set(
        [...document.spaces, ...document.seats].map((shape) => shape.spaceId),
      ).size,
    ).toBe(2300);
  });
  it("repeats the same seed without mutations or ambient randomness", () => {
    expect(createStressDocument(73)).toEqual(createStressDocument(73));
    expect(createStressDocument(74)).not.toEqual(createStressDocument(73));
    const first = createStressDocument();
    first.spaces.length = 0;
    expect(createStressDocument().spaces).toHaveLength(300);
  });
});

describe("stress frame measurement", () => {
  it("uses nearest-rank p50/p95 without discarding slow frames", () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1).reverse();
    expect(frameStats(samples, 5000)).toEqual({
      p50: 50,
      p95: 95,
      frames: 100,
      elapsed: 5000,
    });
    expect(samples[0]).toBe(100);
  });
  it("measures actual clock intervals across five seconds of draws", () => {
    let callback: FrameRequestCallback | undefined;
    let time = 10;
    const draw = vi.fn();
    const complete = vi.fn();
    startStressAnimation({
      draw,
      complete,
      now: () => time,
      requestFrame: (next) => {
        callback = next;
        return 1;
      },
      cancelFrame: vi.fn(),
    });
    for (let index = 0; index <= 250; index++) {
      time = 10 + index * 20;
      callback?.(123);
    }
    expect(draw).toHaveBeenCalledTimes(251);
    expect(draw).toHaveBeenLastCalledWith(5000);
    expect(complete).toHaveBeenCalledExactlyOnceWith({
      p50: 20,
      p95: 20,
      frames: 250,
      elapsed: 5000,
    });
    callback?.(123);
    expect(draw).toHaveBeenCalledTimes(251);
  });
  it("cancels the frame and ignores a callback already queued during unmount", () => {
    let callback: FrameRequestCallback | undefined;
    const cancelFrame = vi.fn();
    const draw = vi.fn();
    const complete = vi.fn();
    const stop = startStressAnimation({
      draw,
      complete,
      now: () => 0,
      requestFrame: (next) => {
        callback = next;
        return 7;
      },
      cancelFrame,
    });
    stop();
    callback?.(10);
    expect(cancelFrame).toHaveBeenCalledWith(7);
    expect(draw).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });
});

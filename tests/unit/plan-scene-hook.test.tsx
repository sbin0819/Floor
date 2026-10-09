import { act, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { usePlanScene } from "@/features/floor-plan/components/use-plan-scene";
import {
  preprocessPlan,
  type PlanSceneRequest,
  type PlanWorker,
} from "@/lib/floor-plan/render/preprocess";
import { createStressDocument } from "@/lib/floor-plan/render/stress-document";

function fakeWorker(): PlanWorker & { requests: PlanSceneRequest[] } {
  const requests: PlanSceneRequest[] = [];
  return {
    requests,
    postMessage: (request) => {
      requests.push(request);
    },
    terminate: vi.fn(),
    onmessage: null,
    onerror: null,
    onmessageerror: null,
  };
}
function respond(worker: ReturnType<typeof fakeWorker>, index: number) {
  worker.onmessage?.(
    new MessageEvent("message", {
      data: preprocessPlan(worker.requests[index]!),
    }),
  );
}

describe("usePlanScene", () => {
  it("keeps SSR free of Worker and preprocessing work", () => {
    const makeWorker = vi.fn(() => null);
    function Test() {
      const { scene, pending } = usePlanScene(
        createStressDocument(),
        makeWorker,
      );
      return <output>{pending && scene === null ? "pending" : "ready"}</output>;
    }
    expect(renderToString(<Test />)).toBe("<output>pending</output>");
    expect(makeWorker).not.toHaveBeenCalled();
  });
  it("hides the old scene immediately and only displays the latest document", () => {
    const worker = fakeWorker();
    const makeWorker = () => worker;
    const first = createStressDocument(1);
    const second = createStressDocument(2);
    const third = createStressDocument(3);
    const { result, rerender, unmount } = renderHook(
      ({ document }) => usePlanScene(document, makeWorker),
      { initialProps: { document: first } },
    );
    expect(result.current).toEqual({ scene: null, pending: true });
    act(() =>
      worker.onmessage?.(
        new MessageEvent("message", { data: { type: "ready" } }),
      ),
    );
    act(() => respond(worker, 0));
    expect(result.current.scene).toEqual(
      preprocessPlan({ id: 1, document: first }).scene,
    );
    rerender({ document: second });
    expect(result.current.scene).toBeNull();
    rerender({ document: third });
    act(() => respond(worker, 1));
    expect(result.current.scene).toBeNull();
    act(() => respond(worker, 2));
    expect(result.current.scene).toEqual(
      preprocessPlan({ id: 3, document: third }).scene,
    );
    unmount();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it("uses synchronous fallback and safely resumes after an Activity-like effect cleanup", () => {
    const makeWorker = () => null;
    const document = createStressDocument();
    const first = renderHook(() => usePlanScene(document, makeWorker));
    expect(first.result.current.pending).toBe(false);
    first.unmount();
    const resumed = renderHook(() => usePlanScene(document, makeWorker));
    expect(resumed.result.current.scene).toEqual(
      preprocessPlan({ id: 1, document }).scene,
    );
  });
});

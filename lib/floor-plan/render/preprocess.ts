import type { FloorPlanDocument } from "../types";
import { createScene } from "./scene";
import type { PlanScene } from "./types";

export type PlanSceneRequest = { id: number; document: FloorPlanDocument };
export type PlanSceneResponse = { id: number; scene: PlanScene };
export type PlanWorkerMessage = { type: "ready" } | PlanSceneResponse;

/** 좌표·경계·문 위치만 전송하고 Path2D와 공간 인덱스는 메인에서 만든다. */
export function preprocessPlan(request: PlanSceneRequest): PlanSceneResponse {
  return { id: request.id, scene: createScene(request.document) };
}

export type PlanWorker = {
  postMessage: (request: PlanSceneRequest) => void;
  terminate: () => void;
  onmessage: ((event: MessageEvent<PlanWorkerMessage>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
};

export function createPlanPreprocessor(makeWorker: () => PlanWorker | null) {
  let worker: PlanWorker | null = null;
  let initialized = false;
  let ready = false;
  let disposed = false;
  let sequence = 0;
  let pending: {
    request: PlanSceneRequest;
    receive: (scene: PlanScene) => void;
  } | null = null;

  function stopWorker() {
    if (!worker) return;
    worker.onmessage = worker.onerror = worker.onmessageerror = null;
    worker.terminate();
    worker = null;
    ready = false;
  }
  function fallback() {
    stopWorker();
    const current = pending;
    pending = null;
    if (!disposed && current)
      current.receive(preprocessPlan(current.request).scene);
  }
  function sendPending() {
    if (!worker || !ready || !pending) return;
    try {
      worker.postMessage(pending.request);
    } catch {
      fallback();
    }
  }
  return {
    process(document: FloorPlanDocument, receive: (scene: PlanScene) => void) {
      if (disposed) return;
      pending = { request: { id: ++sequence, document }, receive };
      if (!initialized) {
        initialized = true;
        try {
          worker = makeWorker();
          if (worker) {
            worker.onmessage = ({ data }) => {
              if (disposed) return;
              if ("type" in data) {
                if (!ready) {
                  ready = true;
                  sendPending();
                }
                return;
              }
              if (data.id !== pending?.request.id) return;
              const current = pending;
              pending = null;
              current.receive(data.scene);
            };
            worker.onerror = (event) => {
              event.preventDefault();
              fallback();
            };
            worker.onmessageerror = fallback;
          }
        } catch {
          worker = null;
        }
      }
      if (!worker) return fallback();
      sendPending();
    },
    dispose() {
      disposed = true;
      pending = null;
      stopWorker();
    },
  };
}

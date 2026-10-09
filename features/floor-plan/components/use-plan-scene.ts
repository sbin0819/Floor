"use client";

import { useEffect, useRef, useState } from "react";
import {
  createPlanPreprocessor,
  type PlanWorker,
} from "@/lib/floor-plan/render/preprocess";
import type { PlanScene } from "@/lib/floor-plan/render/types";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";

function makePlanWorker(): PlanWorker | null {
  if (typeof Worker === "undefined") return null;
  return new Worker(
    new URL("../../../lib/floor-plan/render/worker.ts", import.meta.url),
    { type: "module" },
  );
}

export function usePlanScene(
  document: FloorPlanDocument,
  makeWorker: () => PlanWorker | null = makePlanWorker,
) {
  const processor = useRef<ReturnType<typeof createPlanPreprocessor> | null>(
    null,
  );
  const [result, setResult] = useState<{
    document: FloorPlanDocument;
    scene: PlanScene;
  } | null>(null);
  useEffect(() => {
    const current = createPlanPreprocessor(makeWorker);
    processor.current = current;
    return () => {
      current.dispose();
      processor.current = null;
    };
  }, [makeWorker]);
  useEffect(() => {
    processor.current?.process(document, (scene) => {
      setResult({ document, scene });
    });
  }, [document, makeWorker]);
  // 이전 문서의 결과를 새 층의 화면·히트 테스트에 잠깐이라도 쓰지 않는다.
  const scene = result?.document === document ? result.scene : null;
  return { scene, pending: scene === null };
}

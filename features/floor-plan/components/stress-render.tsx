"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { fit, pan, zoomAt } from "@/lib/floor-plan/render/camera";
import { createPlanLayers } from "@/lib/floor-plan/render/layers";
import { createSpatialIndex } from "@/lib/floor-plan/render/spatial-index";
import {
  startStressAnimation,
  type FrameStats,
} from "@/lib/floor-plan/render/stress-animation";
import { createStressDocument } from "@/lib/floor-plan/render/stress-document";
import type { PlanShapeState } from "@/lib/floor-plan/render/types";
import { usePlanColors } from "./use-plan-colors";
import { usePlanScene } from "./use-plan-scene";

export function StressRender() {
  const planDocument = useMemo(() => createStressDocument(), []);
  const { scene } = usePlanScene(planDocument);
  const colors = usePlanColors();
  const host = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const state = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const draw = useRef<((elapsed: number) => void) | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState<FrameStats | null>(null);
  useEffect(() => {
    if (!scene || !colors || !host.current) return;
    const canvases = [base.current, state.current, overlay.current];
    const contexts = canvases.map((canvas) => canvas?.getContext("2d"));
    if (!contexts[0] || !contexts[1] || !contexts[2]) return;
    const layers = createPlanLayers({
      base: contexts[0],
      state: contexts[1],
      overlay: contexts[2],
    });
    const index = createSpatialIndex(scene.shapes);
    const kinds = [
      "free",
      "booked",
      "mine",
      "maintenance",
      "restricted",
    ] as const;
    const states = new Map<string, PlanShapeState>();
    for (const shape of scene.shapes) {
      if (!shape.spaceId) continue;
      states.set(shape.spaceId, {
        kind: kinds[shape.order % kinds.length]!,
        name:
          shape.kind === "seat"
            ? `자리 ${shape.order}`
            : `공간 ${shape.order + 1}`,
        label: "6인 · 14:00까지 비어 있음",
      });
    }
    let disposed = false;
    let width = 0;
    let height = 0;
    const resize = () => {
      const box = host.current?.getBoundingClientRect();
      if (!box || box.width <= 0 || box.height <= 0) return;
      width = box.width;
      height = box.height;
      const dpr = window.devicePixelRatio || 1;
      for (const canvas of canvases) {
        if (!canvas) continue;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      draw.current = (elapsed) => {
        const viewport = { width, height };
        const fitted = fit(scene.bounds, viewport);
        const wave = elapsed / 1000;
        const camera = pan(
          zoomAt(
            fitted,
            [width / 2, height / 2],
            1.75 + 0.75 * Math.sin(wave * 2),
            fitted.scale,
          ),
          Math.sin(wave * 3) * width * 0.16,
          Math.cos(wave * 2) * height * 0.16,
        );
        layers.render(
          { scene, index, viewport, camera, dpr, colors, states },
          {},
          true,
        );
      };
      draw.current(0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
    resize();
    void document.fonts.ready.then(() => {
      if (disposed) return;
      resize();
      setReady(Boolean(draw.current));
    });
    return () => {
      disposed = true;
      observer.disconnect();
      stop.current?.();
      stop.current = null;
      draw.current = null;
      setReady(false);
      setRunning(false);
    };
  }, [scene, colors]);
  return (
    <section className="space-y-4" data-stress-ready={ready}>
      <div className="flex flex-wrap items-center gap-4">
        <Button
          disabled={!ready || running}
          onClick={() => {
            stop.current?.();
            setStats(null);
            setRunning(true);
            stop.current = startStressAnimation({
              draw: (elapsed) => draw.current?.(elapsed),
              complete: (result) => {
                setStats(result);
                setRunning(false);
              },
            });
          }}
        >
          {running ? "5초 동안 측정하고 있어요" : "확대·이동 되풀이"}
        </Button>
        <p className="text-sm text-muted-foreground">
          공간 300개 · 좌석 2,000개 · 벽 200개
        </p>
      </div>
      <div
        ref={host}
        className="rounded-card relative h-[min(68vh,720px)] min-h-80 overflow-hidden border bg-background"
        data-stress-canvas
      >
        <canvas ref={base} aria-hidden className="absolute inset-0 size-full" />
        <canvas
          ref={state}
          aria-hidden
          className="absolute inset-0 size-full"
        />
        <canvas
          ref={overlay}
          aria-hidden
          className="absolute inset-0 size-full"
        />
      </div>
      <output
        aria-live="polite"
        className="block text-sm tabular-nums"
        data-stress-results={stats ? "complete" : "pending"}
        data-p50={stats?.p50}
        data-p95={stats?.p95}
        data-frames={stats?.frames}
        data-elapsed={stats?.elapsed}
      >
        {stats
          ? `p50 ${stats.p50.toFixed(2)}ms · p95 ${stats.p95.toFixed(2)}ms · ${stats.frames}프레임`
          : "준비가 끝나면 버튼을 눌러 측정해 주세요."}
      </output>
      <p className="text-sm text-muted-foreground">
        목표 p95 16ms · 검사 기준 p95 33ms 이하
      </p>
    </section>
  );
}

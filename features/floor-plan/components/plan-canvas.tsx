"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";
import {
  fit,
  pan,
  zoomAt,
  ensureVisible,
} from "@/lib/floor-plan/render/camera";
import { createScene } from "@/lib/floor-plan/render/scene";
import { createSpatialIndex } from "@/lib/floor-plan/render/spatial-index";
import { hitTest } from "@/lib/floor-plan/render/hit-test";
import { createPlanLayers } from "@/lib/floor-plan/render/layers";
import type {
  Camera,
  PlanShape,
  PlanStates,
  Point,
} from "@/lib/floor-plan/render/types";
import { usePlanColors } from "./use-plan-colors";
import { PlanAccessibility } from "./plan-accessibility";

export function PlanCanvas({
  document,
  states,
  selectedSpaceId,
  onSelect,
  onHover,
  onClear,
  timeLabel = "",
}: {
  document: FloorPlanDocument;
  states: PlanStates;
  selectedSpaceId?: string | null;
  onSelect: (shape: PlanShape) => void;
  onHover?: (shape: PlanShape | null) => void;
  onClear?: () => void;
  timeLabel?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const status = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const layers = useRef<ReturnType<typeof createPlanLayers> | null>(null);
  const forceFrame = useRef(true);
  const positionedSelection = useRef<{
    scene: typeof scene;
    id: string | null;
  } | null>(null);
  const [paintEpoch, setPaintEpoch] = useState(0);
  const scene = useMemo(() => createScene(document), [document]);
  const index = useMemo(() => createSpatialIndex(scene.shapes), [scene]);
  const [viewport, setViewport] = useState({ width: 800, height: 520 });
  const fitted = useMemo(() => fit(scene.bounds, viewport), [scene, viewport]);
  const [camera, setCamera] = useState<Camera | null>(null);
  const current = camera ?? fitted;
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [lastFocusedId, setLastFocusedId] = useState<string | null>(null);
  const colors = usePlanColors();
  const gesture = useRef<{
    id: number;
    start: Point;
    last: Point;
    moved: boolean;
  } | null>(null);
  useEffect(() => {
    const element = host.current;
    const canvases = [base.current, status.current, overlay.current];
    if (!element || canvases.some((canvas) => !canvas)) return;
    const contexts = canvases.map((canvas) => canvas!.getContext("2d"));
    if (contexts.some((context) => !context)) return;
    layers.current = createPlanLayers({
      base: contexts[0]!,
      state: contexts[1]!,
      overlay: contexts[2]!,
    });
    let active = true;
    void window.document.fonts?.ready.then(() => {
      if (!active) return;
      forceFrame.current = true;
      setPaintEpoch((value) => value + 1);
    });
    let initialized = false;
    const resize = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      const dpr = window.devicePixelRatio || 1;
      for (const canvas of canvases) {
        canvas!.width = Math.round(width * dpr);
        canvas!.height = Math.round(height * dpr);
      }
      forceFrame.current = true;
      setViewport({ width, height });
      if (!initialized) setCamera(null);
      initialized = true;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    window.addEventListener("resize", resize);
    resize();
    return () => {
      active = false;
      observer.disconnect();
      window.removeEventListener("resize", resize);
      layers.current = null;
    };
  }, [scene]);
  useEffect(() => {
    if (!colors) return;
    const selected = scene.shapes.find(
      (shape) =>
        shape.kind === "space" &&
        shape.spaceId?.toLowerCase() === selectedSpaceId?.toLowerCase(),
    );
    const frame = requestAnimationFrame(() => {
      layers.current?.render(
        {
          scene,
          index,
          camera: current,
          viewport,
          dpr: window.devicePixelRatio || 1,
          colors,
          states,
        },
        { hoveredId, focusedId, selectedId: selected?.id },
        forceFrame.current,
      );
      forceFrame.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [
    scene,
    index,
    current,
    viewport,
    colors,
    states,
    hoveredId,
    focusedId,
    selectedSpaceId,
    paintEpoch,
  ]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const point: Point = [
        event.clientX - rect.left,
        event.clientY - rect.top,
      ];
      setCamera((value) =>
        event.ctrlKey || event.metaKey
          ? zoomAt(
              value ?? fitted,
              point,
              Math.exp(-event.deltaY / 300),
              fitted.scale,
            )
          : pan(value ?? fitted, -event.deltaX, -event.deltaY),
      );
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [fitted]);
  useEffect(() => {
    const id = selectedSpaceId ?? null;
    if (
      positionedSelection.current?.scene === scene &&
      positionedSelection.current.id === id
    )
      return;
    const selected = scene.shapes.find(
      (shape) =>
        shape.kind === "space" &&
        shape.spaceId?.toLowerCase() === selectedSpaceId?.toLowerCase(),
    );
    if (!selected) {
      positionedSelection.current = { scene, id };
      return;
    }
    const frame = requestAnimationFrame(() => {
      positionedSelection.current = { scene, id };
      setCamera((value) =>
        ensureVisible(value ?? fitted, selected.bounds, viewport),
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedSpaceId, scene, fitted, viewport]);
  const position = (event: { clientX: number; clientY: number }): Point => {
    const rect = host.current!.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };
  const candidate = (point: Point) => {
    const shape = hitTest(index, current, point, { kinds: ["space"] });
    return shape?.spaceId &&
      states.has(shape.spaceId.toLowerCase()) &&
      !states.get(shape.spaceId.toLowerCase())?.hidden
      ? shape
      : null;
  };
  const choose = (shape: PlanShape) => {
    if (
      shape.spaceId &&
      states.get(shape.spaceId.toLowerCase())?.kind !== "restricted"
    )
      onSelect(shape);
  };
  return (
    <div className="relative">
      <div
        ref={host}
        data-plan-canvas
        className="relative h-[min(60dvh,640px)] min-h-96 overflow-hidden"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const point = position(event);
          gesture.current = {
            id: event.pointerId,
            start: point,
            last: point,
            moved: false,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const point = position(event);
          const active = gesture.current;
          if (active && active.id === event.pointerId) {
            active.moved ||=
              Math.hypot(
                point[0] - active.start[0],
                point[1] - active.start[1],
              ) > 8;
            if (active.moved) {
              const dx = point[0] - active.last[0];
              const dy = point[1] - active.last[1];
              setCamera((value) => pan(value ?? fitted, dx, dy));
            }
            active.last = point;
            setHoveredId(null);
            onHover?.(null);
          } else if (event.pointerType === "mouse") {
            const shape = candidate(point);
            setHoveredId(shape?.id ?? null);
            onHover?.(shape);
          }
        }}
        onPointerUp={(event) => {
          const active = gesture.current;
          if (!active || active.id !== event.pointerId) return;
          gesture.current = null;
          if (!active.moved) {
            const shape = candidate(position(event));
            if (shape) choose(shape);
          }
        }}
        onPointerCancel={() => {
          gesture.current = null;
        }}
        onPointerLeave={() => {
          setHoveredId(null);
          onHover?.(null);
        }}
      >
        <canvas
          ref={base}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 size-full"
        />
        <canvas
          ref={status}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 size-full"
        />
        <canvas
          ref={overlay}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 size-full"
        />
      </div>
      <PlanAccessibility
        scene={scene}
        states={states}
        lastFocusedId={lastFocusedId}
        selectedSpaceId={selectedSpaceId}
        timeLabel={timeLabel}
        onFocus={(shape) => {
          setFocusedId(shape?.id ?? null);
          if (!shape) return;
          setLastFocusedId(shape.id);
          setCamera((value) =>
            ensureVisible(value ?? fitted, shape.bounds, viewport),
          );
        }}
        onSelect={choose}
        onClear={() => onClear?.()}
      />
      <div className="absolute right-3 bottom-3 flex flex-col rounded-xl border border-border bg-background shadow-sm">
        <Button
          size="icon"
          variant="ghost"
          aria-label="평면도 확대"
          onClick={() =>
            setCamera(
              zoomAt(
                current,
                [viewport.width / 2, viewport.height / 2],
                1.25,
                fitted.scale,
              ),
            )
          }
        >
          <Plus />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="평면도 축소"
          onClick={() =>
            setCamera(
              zoomAt(
                current,
                [viewport.width / 2, viewport.height / 2],
                0.8,
                fitted.scale,
              ),
            )
          }
        >
          <Minus />
        </Button>
        <Button variant="ghost" onClick={() => setCamera(null)}>
          맞춤
        </Button>
        <output
          className="pb-2 text-center text-xs tabular-nums"
          aria-label="평면도 배율"
        >
          {Math.round((current.scale / fitted.scale) * 100)}%
        </output>
      </div>
    </div>
  );
}

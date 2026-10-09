"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
import { isPlanTap, pinchCamera } from "@/lib/floor-plan/render/gestures";

export function PlanCanvas({
  document,
  states,
  selectedSpaceId,
  selectedSeatId,
  activeDeskAreaId,
  flashSpaceIds,
  interactive = true,
  className,
  onSelect,
  onHover,
  onClear,
  timeLabel = "",
}: {
  document: FloorPlanDocument;
  states: PlanStates;
  selectedSpaceId?: string | null;
  selectedSeatId?: string | null;
  activeDeskAreaId?: string | null;
  flashSpaceIds?: readonly string[];
  interactive?: boolean;
  className?: string;
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
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const fitted = useMemo(() => fit(scene.bounds, viewport), [scene, viewport]);
  const [camera, setCamera] = useState<Camera | null>(null);
  const current = camera ?? fitted;
  const areaCamera = useRef<{
    scene: typeof scene;
    id: string;
    previous: Camera;
    width: number;
    height: number;
  } | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [lastFocusedId, setLastFocusedId] = useState<string | null>(null);
  const colors = usePlanColors();
  const pointers = useRef(
    new Map<number, { start: Point; last: Point; moved: boolean }>(),
  );
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
    if (!colors || viewport.width === 0 || viewport.height === 0) return;
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
        {
          hoveredId,
          focusedId,
          selectedId: selected?.id,
          selectedSeatId: activeDeskAreaId ? selectedSeatId : null,
          flashedIds: flashSpaceIds,
        },
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
    selectedSeatId,
    activeDeskAreaId,
    flashSpaceIds,
    paintEpoch,
  ]);
  useEffect(() => {
    const element = host.current;
    if (!element || !interactive) return;
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
  }, [fitted, interactive]);
  useEffect(() => {
    if (viewport.width === 0 || viewport.height === 0) return;
    const id = selectedSpaceId ?? null;
    const area =
      activeDeskAreaId &&
      scene.shapes.find(
        (shape) =>
          shape.kind === "space" &&
          shape.spaceId === activeDeskAreaId.toLowerCase(),
      );
    const previousArea =
      areaCamera.current?.scene === scene ? areaCamera.current : null;
    if (area) {
      if (
        previousArea?.id === area.id &&
        previousArea.width === viewport.width &&
        previousArea.height === viewport.height
      )
        return;
      const frame = requestAnimationFrame(() => {
        positionedSelection.current = { scene, id };
        setCamera((value) => {
          areaCamera.current = {
            scene,
            id: area.id,
            previous: previousArea?.previous ?? value ?? fitted,
            ...viewport,
          };
          const width = Math.max(1, area.bounds.maxX - area.bounds.minX);
          const height = Math.max(1, area.bounds.maxY - area.bounds.minY);
          const scale = Math.max(
            fitted.scale * 0.5,
            Math.min(
              fitted.scale * 8,
              (viewport.width * 0.8) / width,
              (viewport.height * 0.8) / height,
            ),
          );
          return {
            scale,
            x: viewport.width / 2 - (area.bounds.minX + width / 2) * scale,
            y: viewport.height / 2 - (area.bounds.minY + height / 2) * scale,
          };
        });
      });
      return () => cancelAnimationFrame(frame);
    }
    if (previousArea) {
      const frame = requestAnimationFrame(() => {
        areaCamera.current = null;
        positionedSelection.current = { scene, id };
        setCamera(previousArea.previous);
      });
      return () => cancelAnimationFrame(frame);
    }
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
  }, [selectedSpaceId, activeDeskAreaId, scene, fitted, viewport]);
  const position = (event: { clientX: number; clientY: number }): Point => {
    const rect = host.current!.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };
  const candidate = (point: Point) => {
    if (activeDeskAreaId) {
      const seat = hitTest(index, current, point, { kinds: ["seat"] });
      if (
        seat?.spaceId &&
        states.has(seat.spaceId) &&
        !states.get(seat.spaceId)?.hidden
      )
        return seat;
    }
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
      states.has(shape.spaceId.toLowerCase()) &&
      states.get(shape.spaceId.toLowerCase())?.selectable !== false &&
      states.get(shape.spaceId.toLowerCase())?.kind !== "restricted"
    )
      onSelect(shape);
  };
  return (
    <div className="relative" aria-hidden={!interactive || undefined}>
      <div
        ref={host}
        data-plan-canvas
        className={cn(
          "relative overflow-hidden",
          interactive && "h-[min(60dvh,640px)] min-h-96 touch-none",
          className,
        )}
        onPointerDown={(event) => {
          if (!interactive || event.button !== 0) return;
          const point = position(event);
          pointers.current.set(event.pointerId, {
            start: point,
            last: point,
            moved: false,
          });
          if (pointers.current.size > 1)
            for (const pointer of pointers.current.values())
              pointer.moved = true;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!interactive) return;
          const point = position(event);
          const active = pointers.current.get(event.pointerId);
          if (active) {
            const before = [...pointers.current.values()].map(
              ({ last }) => last,
            );
            const previous = active.moved ? active.last : active.start;
            active.moved ||= !isPlanTap(active.start, point);
            active.last = point;
            const after = [...pointers.current.values()].map(
              ({ last }) => last,
            );
            if (before.length > 1) {
              setCamera((value) =>
                pinchCamera(
                  value ?? fitted,
                  [before[0]!, before[1]!],
                  [after[0]!, after[1]!],
                  fitted.scale,
                ),
              );
            } else if (active.moved) {
              setCamera((value) =>
                pan(
                  value ?? fitted,
                  point[0] - previous[0],
                  point[1] - previous[1],
                ),
              );
            }
            setHoveredId(null);
            onHover?.(null);
          } else if (event.pointerType === "mouse") {
            const shape = candidate(point);
            setHoveredId(shape?.id ?? null);
            onHover?.(shape);
          }
        }}
        onPointerUp={(event) => {
          if (!interactive) return;
          const active = pointers.current.get(event.pointerId);
          if (!active) return;
          pointers.current.delete(event.pointerId);
          if (!active.moved && isPlanTap(active.start, position(event))) {
            const shape = candidate(position(event));
            if (shape) choose(shape);
          }
        }}
        onPointerCancel={(event) => {
          pointers.current.delete(event.pointerId);
          for (const pointer of pointers.current.values()) pointer.moved = true;
        }}
        onLostPointerCapture={(event) => {
          pointers.current.delete(event.pointerId);
        }}
        onPointerLeave={() => {
          if (!interactive) return;
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
      {interactive && (
        <PlanAccessibility
          scene={scene}
          states={states}
          lastFocusedId={lastFocusedId}
          selectedSpaceId={selectedSpaceId}
          selectedSeatId={selectedSeatId}
          activeDeskAreaId={activeDeskAreaId}
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
      )}
      {interactive && (
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
      )}
    </div>
  );
}

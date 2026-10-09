"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FloorPlanDocument, PlanPoint } from "@/lib/floor-plan/types";
import type {
  Box,
  Camera,
  PlanStates,
  Point,
} from "@/lib/floor-plan/render/types";
import { hitTest } from "@/lib/floor-plan/render/hit-test";
import { boundsOf } from "@/lib/floor-plan/render/scene";
import {
  ensureVisible,
  pan,
  toScreen,
  toWorld,
  zoomAt,
} from "@/lib/floor-plan/render/camera";
import { useEditorStore, useEditorValue } from "./editor-context";
import { useEditorCanvas } from "./use-editor-canvas";
import { deleteShapesCommand, type Command } from "./commands";
import {
  duplicateFixturesCommand,
  moveShapesCommand,
  resizeShapeCommand,
  snapPoint,
} from "./transforms";
import {
  hitHandle,
  insideSelection,
  rectanglePoints,
  resizedBox,
  selectionBox,
  type Handle,
} from "./canvas-geometry";

type Gesture = {
  id: number;
  start: Point;
  screen: Point;
  document: FloorPlanDocument;
  selectedIds: readonly string[];
  command: Command | null;
} & (
  | { kind: "rectangle" | "marquee" | "move" }
  | { kind: "pan"; camera: Camera }
  | { kind: "resize"; box: Box; handle: Handle }
);

export function EditorCanvas({
  states,
  onPolygon,
  focusIds,
}: {
  states: PlanStates;
  onPolygon: (polygon: PlanPoint[]) => void;
  focusIds?: readonly string[];
}) {
  const store = useEditorStore();
  const document = useEditorValue((state) => state.document);
  const selectedIds = useEditorValue((state) => state.selectedIds);
  const issues = useEditorValue((state) => state.issues);
  const snap = useEditorValue((state) => state.snap);
  const tool = useEditorValue((state) => state.tool);
  const stale = useEditorValue((state) => state.saveState === "stale");
  const gesture = useRef<Gesture | null>(null);
  const spaceHeld = useRef(false);
  const [polygon, setPolygon] = useState<PlanPoint[]>([]);
  const [drawing, setDrawing] = useState<readonly Point[]>([]);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [preview, setPreview] = useState<FloorPlanDocument | null>(null);
  const overlay = useMemo(
    () => ({
      selectedIds,
      issues,
      polygon: drawing.length ? drawing : polygon,
      marquee,
      preview,
      snap,
    }),
    [selectedIds, issues, drawing, polygon, marquee, preview, snap],
  );
  const {
    host,
    base,
    status: stateCanvas,
    overlay: overlayCanvas,
    camera: current,
    fitted,
    scene,
    index,
    viewport,
  } = useEditorCanvas(states, overlay);
  const focusedRequest = useRef<readonly string[] | null>(null);
  useEffect(
    () => () => {
      gesture.current = null;
      setPreview(null);
      setMarquee(null);
      setDrawing([]);
      setPolygon([]);
    },
    [],
  );
  useEffect(() => {
    if (
      !focusIds?.length ||
      focusedRequest.current === focusIds ||
      viewport.width === 0 ||
      viewport.height === 0
    )
      return;
    const box = selectionBox(document, focusIds);
    if (!box) return;
    const frame = requestAnimationFrame(() => {
      focusedRequest.current = focusIds;
      store
        .getState()
        .setCamera(
          ensureVisible(store.getState().camera ?? fitted, box, viewport),
        );
    });
    return () => cancelAnimationFrame(frame);
  }, [focusIds, document, fitted, store, viewport]);
  const position = (event: { clientX: number; clientY: number }): Point => {
    const rect = host.current!.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };
  const worldPoint = (point: Point, alt: boolean): PlanPoint => {
    const value = snapPoint([...toWorld(point, current)], snap && !alt);
    return [
      Math.max(0, Math.min(document.bounds.w, value[0])),
      Math.max(0, Math.min(document.bounds.h, value[1])),
    ];
  };
  useEffect(() => {
    const root = host.current?.closest("main");
    const finishPolygon = () => {
      if (polygon.length >= 3) {
        onPolygon(polygon);
        setPolygon([]);
        setDrawing([]);
      }
    };
    const keydown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        !(target instanceof HTMLElement) ||
        !root?.contains(target) ||
        target.closest(
          "input,textarea,select,[contenteditable=true],[role=combobox]",
        )
      )
        return;
      const state = store.getState();
      if (state.saveState === "stale") return;
      if (event.code === "Space" && target === host.current) {
        event.preventDefault();
        spaceHeld.current = true;
        return;
      }
      if (event.key === "Enter" && polygon.length) {
        event.preventDefault();
        finishPolygon();
        return;
      }
      if (event.key === "Backspace" && polygon.length) {
        event.preventDefault();
        setPolygon((points) => points.slice(0, -1));
        setDrawing([]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        gesture.current = null;
        setPreview(null);
        setMarquee(null);
        setPolygon([]);
        setDrawing([]);
        state.select([]);
        return;
      }
      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (modifier && key === "z") {
        event.preventDefault();
        gesture.current = null;
        setPreview(null);
        setDrawing([]);
        setMarquee(null);
        if (event.shiftKey) state.redo();
        else state.undo();
      } else if (modifier && key === "d") {
        event.preventDefault();
        state.execute(
          duplicateFixturesCommand(
            state.document,
            state.selectedIds,
            new Map(state.selectedIds.map((id) => [id, crypto.randomUUID()])),
          ),
        );
      } else if (
        !modifier &&
        !event.altKey &&
        ["v", "r", "p", "g"].includes(key)
      ) {
        event.preventDefault();
        setPolygon([]);
        setDrawing([]);
        if (key === "g") state.setSnap(!state.snap);
        else
          state.setTool(
            key === "v" ? "select" : key === "r" ? "rectangle" : "polygon",
          );
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        state.execute(deleteShapesCommand(state.document, state.selectedIds));
      } else if (
        !modifier &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      ) {
        event.preventDefault();
        const step = event.shiftKey ? 1000 : 100;
        state.execute(
          moveShapesCommand(
            state.document,
            state.selectedIds,
            [
              event.key === "ArrowLeft"
                ? -step
                : event.key === "ArrowRight"
                  ? step
                  : 0,
              event.key === "ArrowUp"
                ? -step
                : event.key === "ArrowDown"
                  ? step
                  : 0,
            ],
            { snap: false },
          ),
        );
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.code === "Space") spaceHeld.current = false;
    };
    const blur = () => {
      spaceHeld.current = false;
      gesture.current = null;
      setPreview(null);
      setMarquee(null);
      setDrawing([]);
    };
    window.document.addEventListener("keydown", keydown);
    window.document.addEventListener("keyup", keyup);
    window.addEventListener("blur", blur);
    return () => {
      window.document.removeEventListener("keydown", keydown);
      window.document.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
      spaceHeld.current = false;
    };
  }, [store, host, polygon, onPolygon]);
  const clearGesture = () => {
    gesture.current = null;
    setPreview(null);
    setMarquee(null);
    setDrawing([]);
  };
  const advance = (point: Point, alt: boolean) => {
    const active = gesture.current;
    if (!active || active.document !== store.getState().document) {
      clearGesture();
      return;
    }
    const world = worldPoint(point, alt);
    if (
      (active.kind === "move" || active.kind === "resize") &&
      Math.hypot(point[0] - active.screen[0], point[1] - active.screen[1]) < 2
    ) {
      active.command = null;
      setPreview(null);
      return;
    }
    if (active.kind === "pan") {
      store
        .getState()
        .setCamera(
          pan(
            active.camera,
            point[0] - active.screen[0],
            point[1] - active.screen[1],
          ),
        );
    } else if (active.kind === "rectangle")
      setDrawing(rectanglePoints(active.start, world));
    else if (active.kind === "marquee")
      setMarquee(boundsOf([active.start, world]));
    else {
      active.command =
        active.kind === "resize"
          ? resizeShapeCommand(
              active.document,
              active.selectedIds[0]!,
              resizedBox(active.box, active.handle, world),
              { snap: snap && !alt },
            )
          : moveShapesCommand(
              active.document,
              active.selectedIds,
              [world[0] - active.start[0], world[1] - active.start[1]],
              { snap: snap && !alt },
            );
      setPreview(active.command?.apply(active.document) ?? null);
    }
  };
  const box = selectionBox(preview ?? document, selectedIds);
  return (
    <>
      <div
        ref={host}
        data-editor-canvas
        role="application"
        aria-label="평면도 편집 캔버스"
        aria-describedby="editor-canvas-help"
        tabIndex={0}
        className="relative h-full touch-none overflow-hidden focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        onPointerDown={(event) => {
          if (stale || (event.button !== 0 && event.button !== 1)) return;
          event.currentTarget.focus();
          const point = position(event),
            world = worldPoint(point, event.altKey);
          const base = {
            id: event.pointerId,
            start: world,
            screen: point,
            document,
            selectedIds,
            command: null,
          };
          if (spaceHeld.current || event.button === 1)
            gesture.current = { ...base, kind: "pan", camera: current };
          else if (tool === "polygon") {
            const first = polygon[0] && toScreen(polygon[0], current);
            if (
              polygon.length >= 3 &&
              first &&
              Math.hypot(point[0] - first[0], point[1] - first[1]) <= 8
            ) {
              onPolygon(polygon);
              setPolygon([]);
              setDrawing([]);
            } else if (
              polygon.length < 64 &&
              (!polygon.length ||
                world[0] !== polygon.at(-1)![0] ||
                world[1] !== polygon.at(-1)![1])
            ) {
              setPolygon([...polygon, world]);
              setDrawing([]);
            }
            return;
          } else if (tool === "rectangle")
            gesture.current = { ...base, kind: "rectangle" };
          else {
            const selectedBox =
              selectedIds.length === 1
                ? selectionBox(document, selectedIds)
                : null;
            const handle =
              selectedBox && hitHandle(selectedBox, point, current);
            if (handle && selectedBox)
              gesture.current = {
                ...base,
                kind: "resize",
                box: selectedBox,
                handle,
              };
            else {
              const shape = hitTest(index, current, point, {
                kinds: ["space", "fixture"],
              });
              if (shape) {
                const ids = event.shiftKey
                  ? selectedIds.includes(shape.id)
                    ? selectedIds.filter((id) => id !== shape.id)
                    : [...selectedIds, shape.id]
                  : selectedIds.includes(shape.id)
                    ? selectedIds
                    : [shape.id];
                store.getState().select(ids);
                if (ids.includes(shape.id))
                  gesture.current = { ...base, selectedIds: ids, kind: "move" };
              } else {
                gesture.current = {
                  ...base,
                  selectedIds: event.shiftKey ? selectedIds : [],
                  kind: "marquee",
                };
                if (!event.shiftKey) store.getState().select([]);
              }
            }
          }
          if (gesture.current)
            event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (stale) return;
          if (gesture.current?.id === event.pointerId)
            advance(position(event), event.altKey);
          else if (tool === "polygon" && polygon.length)
            setDrawing([...polygon, worldPoint(position(event), event.altKey)]);
        }}
        onPointerUp={(event) => {
          const active = gesture.current;
          if (!active || active.id !== event.pointerId) return;
          if (store.getState().saveState === "stale") {
            clearGesture();
            return;
          }
          if (active.document !== store.getState().document) {
            clearGesture();
            return;
          }
          advance(position(event), event.altKey);
          const world = worldPoint(position(event), event.altKey);
          if (
            active.kind === "rectangle" &&
            world[0] !== active.start[0] &&
            world[1] !== active.start[1]
          )
            onPolygon(rectanglePoints(active.start, world));
          else if (active.kind === "marquee")
            store
              .getState()
              .select([
                ...new Set([
                  ...active.selectedIds,
                  ...scene.shapes
                    .filter((shape) =>
                      insideSelection(boundsOf([active.start, world]), shape),
                    )
                    .map(({ id }) => id),
                ]),
              ]);
          else if (active.command) store.getState().execute(active.command);
          clearGesture();
        }}
        onPointerCancel={clearGesture}
        onLostPointerCapture={clearGesture}
      >
        <canvas
          ref={base}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 size-full"
        />
        <canvas
          ref={stateCanvas}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 size-full"
        />
        <canvas
          ref={overlayCanvas}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 size-full"
        />
      </div>
      <p id="editor-canvas-help" className="sr-only">
        V 선택, R 사각형, P 다각형, G 스냅, 방향키 이동, Shift와 방향키로 크게
        이동, Delete 지우기, Escape 취소, Command 또는 Control Z 실행 취소. 공간
        목록에서 도형을 골라 숫자로도 바꿀 수 있어요.
      </p>
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg border bg-background px-3 py-2 text-xs tabular-nums">
        격자 100mm · 스냅 {snap ? "켜짐" : "꺼짐"} · 층 크기{" "}
        {document.bounds.w.toLocaleString("ko-KR")} ×{" "}
        {document.bounds.h.toLocaleString("ko-KR")} mm
      </div>
      {box && preview && (
        <output
          aria-label="도형 크기"
          className="pointer-events-none absolute top-3 left-3 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground tabular-nums"
        >
          {Math.round(box.maxX - box.minX).toLocaleString("ko-KR")} ×{" "}
          {Math.round(box.maxY - box.minY).toLocaleString("ko-KR")} mm
        </output>
      )}
      <div className="absolute right-3 bottom-3 flex flex-col rounded-xl border bg-background">
        <Button
          variant="ghost"
          size="icon"
          aria-label="평면도 확대"
          onClick={() =>
            store
              .getState()
              .setCamera(
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
          variant="ghost"
          size="icon"
          aria-label="평면도 축소"
          onClick={() =>
            store
              .getState()
              .setCamera(
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
        <Button
          variant="ghost"
          onClick={() => store.getState().setCamera(null)}
        >
          맞춤
        </Button>
        <output
          className="pb-2 text-center text-xs tabular-nums"
          aria-label="평면도 배율"
        >
          {Math.round((current.scale / fitted.scale) * 100)}%
        </output>
      </div>
      <ul
        aria-label="편집할 도형"
        className="sr-only focus-within:not-sr-only focus-within:absolute focus-within:top-3 focus-within:left-3 focus-within:z-10 focus-within:max-h-80 focus-within:overflow-y-auto focus-within:rounded-lg focus-within:border focus-within:bg-background focus-within:p-2"
      >
        {scene.shapes
          .filter((shape) => shape.kind === "space" || shape.kind === "fixture")
          .map((shape) => (
            <li key={shape.id}>
              <button
                type="button"
                className="min-h-11 rounded-md px-3 focus-visible:outline-2 focus-visible:outline-ring"
                aria-pressed={selectedIds.includes(shape.id)}
                onClick={() => {
                  store.getState().select([shape.id]);
                  store
                    .getState()
                    .setCamera(ensureVisible(current, shape.bounds, viewport));
                }}
              >
                {shape.spaceId
                  ? (states.get(shape.spaceId)?.name ?? "연결을 확인할 공간")
                  : shape.kind === "fixture"
                    ? (shape.label ?? "고정물")
                    : "도형"}
              </button>
            </li>
          ))}
      </ul>
      <span className="sr-only" role="status">
        {polygon.length
          ? `다각형 꼭짓점 ${polygon.length}개. Enter로 완성해요`
          : ""}
      </span>
    </>
  );
}

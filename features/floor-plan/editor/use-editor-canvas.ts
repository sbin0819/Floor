"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createScene } from "@/lib/floor-plan/render/scene";
import { createSpatialIndex } from "@/lib/floor-plan/render/spatial-index";
import { createPlanLayers } from "@/lib/floor-plan/render/layers";
import { fit, pan, zoomAt } from "@/lib/floor-plan/render/camera";
import { usePlanColors } from "../components/use-plan-colors";
import type { PlanStates } from "@/lib/floor-plan/render/types";
import { useEditorStore, useEditorValue } from "./editor-context";
import { drawEditorOverlay, type EditorOverlay } from "./canvas-overlay";

export function useEditorCanvas(states: PlanStates, preview: EditorOverlay) {
  const store = useEditorStore();
  const document = useEditorValue((state) => state.document);
  const camera = useEditorValue((state) => state.camera);
  const host = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null),
    status = useRef<HTMLCanvasElement>(null),
    overlay = useRef<HTMLCanvasElement>(null);
  const layers = useRef<ReturnType<typeof createPlanLayers> | null>(null);
  const force = useRef(true);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [fontEpoch, setFontEpoch] = useState(0);
  const scene = useMemo(() => createScene(document), [document]);
  const index = useMemo(() => createSpatialIndex(scene.shapes), [scene]);
  const fitted = useMemo(
    () => fit(document.bounds, viewport),
    [document.bounds, viewport],
  );
  const current = camera ?? fitted;
  const colors = usePlanColors();
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
      if (active) {
        force.current = true;
        setFontEpoch((value) => value + 1);
      }
    });
    const resize = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      const dpr = window.devicePixelRatio || 1;
      for (const canvas of canvases) {
        canvas!.width = Math.round(width * dpr);
        canvas!.height = Math.round(height * dpr);
      }
      force.current = true;
      setViewport({ width, height });
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
  }, []);
  useEffect(() => {
    if (!colors || !viewport.width || !viewport.height) return;
    const frame = requestAnimationFrame(() => {
      const value = {
        scene,
        index,
        camera: current,
        viewport,
        dpr: window.devicePixelRatio || 1,
        colors,
        states,
      };
      layers.current?.render(value, {}, force.current);
      const ctx = overlay.current?.getContext("2d");
      if (ctx) drawEditorOverlay(ctx, value, document, preview);
      force.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [
    scene,
    index,
    current,
    viewport,
    colors,
    states,
    document,
    preview,
    fontEpoch,
  ]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const value = store.getState().camera ?? fitted;
      store
        .getState()
        .setCamera(
          event.ctrlKey || event.metaKey
            ? zoomAt(
                value,
                [event.clientX - rect.left, event.clientY - rect.top],
                Math.exp(-event.deltaY / 300),
                fitted.scale,
              )
            : pan(value, -event.deltaX, -event.deltaY),
        );
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [store, fitted]);
  return {
    host,
    base,
    status,
    overlay,
    scene,
    index,
    viewport,
    camera: current,
    fitted,
  };
}

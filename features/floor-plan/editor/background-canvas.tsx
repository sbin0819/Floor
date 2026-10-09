"use client";

import { useEffect, useEffectEvent, useRef } from "react";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";
import type { Camera, Viewport } from "@/lib/floor-plan/render/types";

export type BackgroundCanvasProps = {
  background?: FloorPlanDocument["background"];
  src: string | null;
  camera: Camera;
  viewport: Viewport;
  onLoadError?: (failed: boolean) => void;
  onImageSize?: (size: { width: number; height: number }) => void;
};

export function BackgroundCanvas({
  background,
  src,
  camera,
  viewport,
  onLoadError,
  onImageSize,
}: BackgroundCanvasProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const loaded = useRef<{ source: string; image: HTMLImageElement } | null>(
    null,
  );
  const frame = useRef<number | null>(null);
  const available = background !== undefined;
  const [a, b, c, d, e, f] = background?.transform ?? [1, 0, 0, 1, 0, 0];
  const opacity = background?.opacity ?? 0;
  const report = useEffectEvent((failed: boolean) => onLoadError?.(failed));
  const reportSize = useEffectEvent((size: { width: number; height: number }) =>
    onImageSize?.(size),
  );
  const draw = useEffectEvent(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(0, Math.round(viewport.width * ratio));
    const height = Math.max(0, Math.round(viewport.height * ratio));
    if (element.width !== width) element.width = width;
    if (element.height !== height) element.height = height;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, width, height);
    const current = loaded.current;
    if (!width || !height || !available || !current || current.source !== src)
      return;
    context.save();
    try {
      const scale = ratio * camera.scale;
      // 배경의 px→mm 행렬 뒤에 카메라의 mm→화면 변환과 DPR을 합성한다.
      context.setTransform(
        scale * a,
        scale * b,
        scale * c,
        scale * d,
        ratio * (camera.scale * e + camera.x),
        ratio * (camera.scale * f + camera.y),
      );
      context.globalAlpha = opacity;
      context.drawImage(current.image, 0, 0);
    } catch {
      loaded.current = null;
      report(true);
    } finally {
      context.restore();
    }
  });
  const schedule = useEffectEvent(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      draw();
    });
  });

  useEffect(() => {
    let active = true;
    let settled = false;
    let image: HTMLImageElement | null = null;
    loaded.current = null;
    report(false);
    if (available && src) {
      image = new Image();
      const pending = image;
      pending.decoding = "async";
      pending.onload = () => {
        if (!active || settled) return;
        settled = true;
        if (pending.naturalWidth < 1 || pending.naturalHeight < 1) {
          report(true);
          return;
        }
        loaded.current = { source: src, image: pending };
        reportSize({
          width: pending.naturalWidth,
          height: pending.naturalHeight,
        });
        report(false);
        schedule();
      };
      pending.onerror = () => {
        if (!active || settled) return;
        settled = true;
        loaded.current = null;
        report(true);
        schedule();
      };
      pending.src = src;
    }
    schedule();
    return () => {
      active = false;
      loaded.current = null;
      if (image) {
        image.onload = image.onerror = null;
        image.removeAttribute("src");
      }
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [src, available]);
  useEffect(() => {
    schedule();
  }, [
    a,
    b,
    c,
    d,
    e,
    f,
    opacity,
    camera.scale,
    camera.x,
    camera.y,
    viewport.width,
    viewport.height,
  ]);
  useEffect(() => {
    const resize = () => schedule();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      data-plan-background
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}

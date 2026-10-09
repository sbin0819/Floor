"use client";

import { useEffect, useState } from "react";
import type { PlanColors } from "@/lib/floor-plan/render/types";

export function readPlanColors(root: HTMLElement): PlanColors {
  const style = getComputedStyle(root);
  const token = (name: string) => style.getPropertyValue(`--${name}`).trim();
  const palette = (fill: string, stroke: string, text: string) => ({
    fill: token(fill),
    stroke: token(stroke),
    text: token(text),
  });
  const tile = document.createElement("canvas");
  tile.width = tile.height = 16;
  const context = tile.getContext("2d");
  let maintenancePattern: CanvasPattern | undefined;
  if (context) {
    context.fillStyle = token("status-maintenance-hatch-a");
    context.fillRect(0, 0, 16, 16);
    context.strokeStyle = token("status-maintenance-hatch-b");
    context.lineWidth = 8;
    for (const offset of [-16, 0, 16]) {
      context.beginPath();
      context.moveTo(offset, 16);
      context.lineTo(offset + 16, 0);
      context.stroke();
    }
    maintenancePattern = context.createPattern(tile, "repeat") ?? undefined;
  }
  return {
    background: token("background"),
    border: token("border"),
    foreground: token("foreground"),
    muted: token("muted-foreground"),
    selection: token("status-mine-strong"),
    focus: token("ring"),
    shadow: token("accent"),
    free: palette(
      "status-free",
      "status-free-border",
      "status-free-foreground",
    ),
    booked: palette("booked", "border", "foreground"),
    seatBooked: palette("booked", "booked-border", "muted-foreground"),
    mine: palette(
      "status-mine-strong",
      "status-mine-strong",
      "primary-foreground",
    ),
    seatMine: palette(
      "status-mine",
      "status-mine-border",
      "status-mine-foreground",
    ),
    heat: [
      palette("heat-1", "border", "status-mine-foreground"),
      palette("heat-2", "border", "status-mine-foreground"),
      palette("heat-3", "border", "status-mine-foreground"),
      palette("heat-4", "border", "primary-foreground"),
    ],
    maintenance: palette(
      "status-maintenance-hatch-a",
      "status-maintenance-border",
      "status-maintenance-foreground",
    ),
    restricted: palette(
      "status-restricted",
      "status-restricted-border",
      "status-restricted-foreground",
    ),
    neutral: palette("background", "border", "foreground"),
    fixture: palette("secondary", "border", "muted-foreground"),
    maintenancePattern,
  };
}

export function usePlanColors() {
  const [colors, setColors] = useState<PlanColors | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setColors(readPlanColors(root));
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    media?.addEventListener("change", read);
    return () => {
      observer.disconnect();
      media?.removeEventListener("change", read);
    };
  }, []);
  return colors;
}

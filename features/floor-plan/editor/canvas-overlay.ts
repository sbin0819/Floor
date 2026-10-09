import type { PlanIssue } from "@/lib/floor-plan/issues";
import { toScreen } from "@/lib/floor-plan/render/camera";
import { handles, selectionBox, vertexPoints } from "./canvas-geometry";
import type { SnapResult } from "./snapping";
import type { Box, PlanFrame, Point } from "@/lib/floor-plan/render/types";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";
import { createScene, seatPolygon } from "@/lib/floor-plan/render/scene";

export type EditorOverlay = {
  selectedIds: readonly string[];
  issues: readonly PlanIssue[];
  polygon: readonly Point[];
  marquee: Box | null;
  preview: FloorPlanDocument | null;
  snap: boolean;
  previewSeats?: readonly FloorPlanDocument["seats"][number][] | null;
  drawingClosed?: boolean;
  vertex?: { shapeId: string; index: number | null } | null;
  snapMark?: SnapResult | null;
  scalePoints?: readonly Point[] | null;
};
export function drawEditorOverlay(
  ctx: CanvasRenderingContext2D,
  frame: PlanFrame,
  document: FloorPlanDocument,
  overlay: EditorOverlay,
) {
  const { camera, colors, viewport, dpr } = frame;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  const outline = (points: readonly Point[], close = true) => {
    if (!points.length) return;
    ctx.beginPath();
    const first = toScreen(points[0]!, camera);
    ctx.moveTo(...first);
    for (const point of points.slice(1)) ctx.lineTo(...toScreen(point, camera));
    if (close) ctx.closePath();
    ctx.stroke();
  };
  if (overlay.snap && camera.scale * 100 >= 4) {
    const step = camera.scale * 100;
    ctx.fillStyle = colors.border;
    for (
      let x = ((camera.x % step) + step) % step;
      x < viewport.width;
      x += step
    )
      for (
        let y = ((camera.y % step) + step) % step;
        y < viewport.height;
        y += step
      )
        ctx.fillRect(x, y, 1, 1);
  }
  ctx.lineWidth = 2;
  ctx.strokeStyle = colors.issue?.stroke ?? colors.maintenance.stroke;
  const issues = new Set(
    overlay.issues.flatMap(({ shapeId }) => (shapeId ? [shapeId] : [])),
  );
  for (const shape of frame.scene.shapes)
    if (issues.has(shape.id)) outline(shape.points);
  ctx.strokeStyle = colors.selection;
  if (overlay.scalePoints?.length) {
    ctx.setLineDash([4, 4]);
    outline(overlay.scalePoints, false);
    ctx.setLineDash([]);
    for (const point of overlay.scalePoints) {
      const [x, y] = toScreen(point, camera);
      ctx.fillStyle = colors.selection;
      ctx.fillRect(x - 4, y - 4, 8, 8);
    }
  }
  if (overlay.preview) {
    ctx.setLineDash([6, 4]);
    for (const shape of createScene(overlay.preview).shapes)
      if (overlay.selectedIds.includes(shape.id))
        outline(
          shape.points,
          shape.kind !== "wall" && shape.kind !== "opening",
        );
    ctx.setLineDash([]);
  }
  if (overlay.previewSeats) {
    ctx.setLineDash([6, 4]);
    for (const seat of overlay.previewSeats) outline(seatPolygon(seat));
    ctx.setLineDash([]);
  }
  if (overlay.polygon.length) {
    ctx.setLineDash([6, 4]);
    outline(
      overlay.polygon,
      overlay.drawingClosed ?? overlay.polygon.length === 4,
    );
    ctx.setLineDash([]);
    ctx.fillStyle = colors.selection;
    for (const point of overlay.polygon) {
      const [x, y] = toScreen(point, camera);
      ctx.fillRect(x - 3, y - 3, 6, 6);
    }
  }
  if (overlay.marquee) {
    const a = toScreen([overlay.marquee.minX, overlay.marquee.minY], camera);
    const b = toScreen([overlay.marquee.maxX, overlay.marquee.maxY], camera);
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    ctx.setLineDash([]);
  }
  const box = selectionBox(overlay.preview ?? document, overlay.selectedIds);
  if (overlay.snapMark?.kind) {
    ctx.strokeStyle = colors.selection;
    const guide = overlay.snapMark.guide;
    if (guide) {
      ctx.setLineDash([4, 4]);
      outline([guide.from, guide.to], false);
      ctx.setLineDash([]);
    }
    const [x, y] = toScreen(overlay.snapMark.point, camera);
    ctx.strokeRect(x - 5, y - 5, 10, 10);
  }
  if (overlay.vertex) {
    vertexPoints(overlay.preview ?? document, overlay.vertex.shapeId).forEach(
      (point, i) => {
        const [x, y] = toScreen(point, camera);
        ctx.fillStyle =
          i === overlay.vertex?.index ? colors.selection : colors.background;
        ctx.fillRect(x - 4, y - 4, 8, 8);
        ctx.strokeRect(x - 4, y - 4, 8, 8);
      },
    );
    return;
  }
  if (!box) return;
  const a = toScreen([box.minX, box.minY], camera),
    b = toScreen([box.maxX, box.maxY], camera);
  ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
  if (
    overlay.selectedIds.length === 1 &&
    [...document.spaces, ...document.fixtures].some(
      ({ id }) => id === overlay.selectedIds[0],
    )
  ) {
    ctx.fillStyle = colors.background;
    for (const { at } of handles(box)) {
      const [x, y] = toScreen(at, camera);
      ctx.fillRect(x - 4, y - 4, 8, 8);
      ctx.strokeRect(x - 4, y - 4, 8, 8);
    }
  }
}

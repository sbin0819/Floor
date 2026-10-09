import { screenBoxToWorld, worldViewport } from "./camera";
import type {
  Box,
  PlanContext,
  PlanDrawOptions,
  PlanFrame,
  PlanOverlay,
  PlanShape,
  PlanShapeState,
  PolygonShape,
} from "./types";

export function shapeState(
  frame: PlanFrame,
  shape: PlanShape,
): PlanShapeState | undefined {
  return shape.spaceId ? frame.states.get(shape.spaceId) : undefined;
}
const polygon = (shape: PlanShape): shape is PolygonShape =>
  shape.kind === "space" || shape.kind === "seat" || shape.kind === "fixture";

/** Path2D와 DOM이 없는 테스트는 createPath: () => null을 주입한다. */
export function createPlanDrawer(options: PlanDrawOptions = {}) {
  const paths = new WeakMap<PlanShape, Path2D>();
  const createPath =
    options.createPath ??
    (() => (typeof Path2D === "undefined" ? null : new Path2D()));
  function trace(
    target: Pick<PlanContext, "moveTo" | "lineTo" | "closePath">,
    shape: PolygonShape,
  ) {
    const first = shape.points[0];
    if (!first) return;
    target.moveTo(first[0], first[1]);
    for (const [x, y] of shape.points.slice(1)) target.lineTo(x, y);
    target.closePath();
  }
  function pathFor(shape: PolygonShape) {
    const existing = paths.get(shape);
    if (existing) return existing;
    const path = createPath();
    if (path) {
      trace(path, shape);
      paths.set(shape, path);
    }
    return path;
  }
  function pathAction(
    ctx: PlanContext,
    shape: PolygonShape,
    action: "fill" | "stroke" | "clip",
  ) {
    const path = pathFor(shape);
    if (path) {
      if (action === "stroke") ctx.stroke(path);
      else ctx[action](path, "evenodd");
    } else {
      ctx.beginPath();
      trace(ctx, shape);
      if (action === "stroke") ctx.stroke();
      else ctx[action]("evenodd");
    }
  }
  function worldTransform(ctx: PlanContext, frame: PlanFrame) {
    const { camera, dpr } = frame;
    ctx.setTransform(
      dpr * camera.scale,
      0,
      0,
      dpr * camera.scale,
      camera.x * dpr,
      camera.y * dpr,
    );
    ctx.lineJoin = "round";
    ctx.lineCap = "butt";
  }
  function begin(ctx: PlanContext, frame: PlanFrame, clip?: Box) {
    ctx.save();
    ctx.setTransform(frame.dpr, 0, 0, frame.dpr, 0, 0);
    const region = clip ?? {
      minX: 0,
      minY: 0,
      maxX: frame.viewport.width,
      maxY: frame.viewport.height,
    };
    ctx.clearRect(
      region.minX,
      region.minY,
      region.maxX - region.minX,
      region.maxY - region.minY,
    );
    if (clip) {
      ctx.beginPath();
      ctx.rect(
        clip.minX,
        clip.minY,
        clip.maxX - clip.minX,
        clip.maxY - clip.minY,
      );
      ctx.clip();
    }
    worldTransform(ctx, frame);
  }
  function visible(frame: PlanFrame, clip?: Box) {
    const bounds = clip
      ? screenBoxToWorld(clip, frame.camera)
      : worldViewport(frame.camera, frame.viewport);
    return frame.index
      .search(bounds)
      .filter((shape) => !shapeState(frame, shape)?.hidden);
  }
  function text(
    ctx: PlanContext,
    value: string,
    x: number,
    y: number,
    width: number,
  ) {
    if (width <= 0) return;
    let content = value;
    if (ctx.measureText(content).width > width) {
      const characters = Array.from(content);
      let low = 0;
      let high = characters.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (
          ctx.measureText(`${characters.slice(0, middle).join("")}…`).width <=
          width
        )
          low = middle;
        else high = middle - 1;
      }
      content = `${characters.slice(0, low).join("")}…`;
      if (ctx.measureText(content).width > width) return;
    }
    ctx.fillText(content, x, y);
  }
  function labels(
    ctx: PlanContext,
    frame: PlanFrame,
    shape: PolygonShape,
    state?: PlanShapeState,
  ) {
    const scale = frame.camera.scale;
    const width = (shape.bounds.maxX - shape.bounds.minX) * scale;
    const height = (shape.bounds.maxY - shape.bounds.minY) * scale;
    const name = shape.kind === "fixture" ? shape.label : state?.name;
    if (!name || width < (shape.kind === "seat" ? 34 : 54)) return;
    ctx.save();
    pathAction(ctx, shape, "clip");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${shape.kind === "space" ? 600 : 400} ${shape.kind === "space" ? 12 / scale : 11 / scale}px Pretendard, system-ui, sans-serif`;
    const detail =
      shape.kind === "space" && height >= 46 ? state?.label : undefined;
    const textWidth = Math.max(
      0,
      Math.min(
        shape.labelAt[0] - shape.bounds.minX,
        shape.bounds.maxX - shape.labelAt[0],
      ) *
        2 -
        8 / scale,
    );
    const nameY = shape.labelAt[1] - (detail ? 8 / scale : 0);
    const locked = state?.kind === "restricted";
    if (locked) {
      const x =
        shape.labelAt[0] -
        Math.min(ctx.measureText(name).width + 14 / scale, textWidth) / 2;
      ctx.strokeStyle = frame.colors.restricted.text;
      ctx.lineWidth = 1 / scale;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.rect(x, nameY - 1 / scale, 6 / scale, 5 / scale);
      ctx.moveTo(x + 1 / scale, nameY - 1 / scale);
      ctx.arc(
        x + 3 / scale,
        nameY - 1 / scale,
        2 / scale,
        Math.PI,
        Math.PI * 2,
      );
      ctx.stroke();
    }
    text(
      ctx,
      name,
      shape.labelAt[0] + (locked ? 5 / scale : 0),
      nameY,
      textWidth - (locked ? 14 / scale : 0),
    );
    if (detail) {
      ctx.font = `400 ${11 / scale}px Pretendard, system-ui, sans-serif`;
      text(
        ctx,
        detail,
        shape.labelAt[0],
        shape.labelAt[1] + 9 / scale,
        textWidth,
      );
    }
    ctx.restore();
  }
  function drawBase(ctx: PlanContext, frame: PlanFrame) {
    begin(ctx, frame);
    for (const shape of visible(frame)) {
      ctx.setLineDash([]);
      ctx.lineWidth = 1 / frame.camera.scale;
      if (polygon(shape)) {
        const state = shapeState(frame, shape);
        const palette =
          shape.kind === "fixture"
            ? frame.colors.fixture
            : frame.colors.neutral;
        ctx.fillStyle = palette.fill;
        ctx.strokeStyle = palette.stroke;
        if (shape.kind === "space" && state?.deskArea)
          ctx.setLineDash([6 / frame.camera.scale, 4 / frame.camera.scale]);
        else pathAction(ctx, shape, "fill");
        pathAction(ctx, shape, "stroke");
        if (shape.kind === "fixture") {
          ctx.fillStyle = palette.text;
          labels(ctx, frame, shape);
        }
      } else if (shape.kind === "wall") {
        ctx.strokeStyle = frame.colors.foreground;
        ctx.lineWidth = shape.thickness;
        ctx.beginPath();
        for (const [start, end] of shape.segments) {
          ctx.moveTo(start[0], start[1]);
          ctx.lineTo(end[0], end[1]);
        }
        ctx.stroke();
      } else if (shape.door && shape.radius > 0) {
        ctx.strokeStyle = frame.colors.muted;
        const angle = shape.angle - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(shape.hinge[0], shape.hinge[1]);
        ctx.lineTo(
          shape.hinge[0] + Math.cos(angle) * shape.radius,
          shape.hinge[1] + Math.sin(angle) * shape.radius,
        );
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(
          shape.hinge[0],
          shape.hinge[1],
          shape.radius,
          angle,
          shape.angle,
        );
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  function drawStates(ctx: PlanContext, frame: PlanFrame, clip?: Box) {
    begin(ctx, frame, clip);
    frame.colors.maintenancePattern?.setTransform({
      a: 1 / frame.camera.scale,
      d: 1 / frame.camera.scale,
      e: -frame.camera.x / frame.camera.scale,
      f: -frame.camera.y / frame.camera.scale,
    });
    for (const shape of visible(frame, clip)) {
      if (!polygon(shape) || shape.kind === "fixture") continue;
      const state = shapeState(frame, shape);
      if (!state) continue;
      const palette =
        shape.kind === "seat" && state.selected
          ? frame.colors.mine
          : shape.kind === "seat" && state.kind === "mine"
            ? (frame.colors.seatMine ?? frame.colors.mine)
            : shape.kind === "seat" && state.kind === "booked"
              ? (frame.colors.seatBooked ?? frame.colors.booked)
              : frame.colors[state.kind];
      ctx.lineWidth = 1 / frame.camera.scale;
      ctx.setLineDash(
        state.deskArea ? [6 / frame.camera.scale, 4 / frame.camera.scale] : [],
      );
      ctx.fillStyle =
        state.kind === "maintenance"
          ? (frame.colors.maintenancePattern ?? palette.fill)
          : palette.fill;
      ctx.strokeStyle = palette.stroke;
      if (!state.deskArea) pathAction(ctx, shape, "fill");
      pathAction(ctx, shape, "stroke");
      ctx.fillStyle = palette.text;
      labels(ctx, frame, shape, state);
    }
    ctx.restore();
  }
  function drawOverlay(
    ctx: PlanContext,
    frame: PlanFrame,
    overlay: PlanOverlay,
  ) {
    begin(ctx, frame);
    for (const [id, kind] of [
      [overlay.hoveredId, "hover"],
      [overlay.selectedId, "selected"],
      [overlay.selectedSeatId, "selected"],
      [overlay.focusedId, "focused"],
      ...(overlay.flashedIds ?? []).map((id) => [id, "flash"] as const),
    ] as const) {
      if (!id) continue;
      const shape = frame.scene.shapes.find(
        (item) => item.id === id || item.spaceId === id.toLowerCase(),
      );
      if (!shape || !polygon(shape) || shapeState(frame, shape)?.hidden)
        continue;
      ctx.save();
      ctx.strokeStyle =
        kind === "focused" ? frame.colors.focus : frame.colors.selection;
      ctx.lineWidth = (kind === "selected" ? 3 : 2) / frame.camera.scale;
      ctx.setLineDash(
        kind === "focused"
          ? [3 / frame.camera.scale, 2 / frame.camera.scale]
          : [],
      );
      if (kind === "selected") {
        ctx.shadowColor = frame.colors.shadow;
        ctx.shadowBlur = 6 * frame.dpr;
      }
      pathAction(ctx, shape, "stroke");
      ctx.restore();
    }
    ctx.restore();
  }
  return { drawBase, drawStates, drawOverlay };
}

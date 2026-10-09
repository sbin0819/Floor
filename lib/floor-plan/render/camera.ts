import type { Box, Camera, Point, Viewport } from "./types";

export function toScreen(point: Point, camera: Camera): Point {
  return [
    point[0] * camera.scale + camera.x,
    point[1] * camera.scale + camera.y,
  ];
}
export function toWorld(point: Point, camera: Camera): Point {
  return [
    (point[0] - camera.x) / camera.scale,
    (point[1] - camera.y) / camera.scale,
  ];
}
export function fit(
  bounds: { w: number; h: number },
  viewport: Viewport,
  padding = 24,
): Camera {
  const scale = Math.min(
    Math.max(1, viewport.width - padding * 2) / bounds.w,
    Math.max(1, viewport.height - padding * 2) / bounds.h,
  );
  return {
    scale,
    x: (viewport.width - bounds.w * scale) / 2,
    y: (viewport.height - bounds.h * scale) / 2,
  };
}
export function zoomAt(
  camera: Camera,
  point: Point,
  factor: number,
  fitScale: number,
): Camera {
  if (
    !Number.isFinite(factor) ||
    factor <= 0 ||
    !Number.isFinite(fitScale) ||
    fitScale <= 0
  )
    return camera;
  const world = toWorld(point, camera);
  const scale = Math.max(
    fitScale * 0.5,
    Math.min(fitScale * 8, camera.scale * factor),
  );
  return {
    scale,
    x: point[0] - world[0] * scale,
    y: point[1] - world[1] * scale,
  };
}
export function pan(camera: Camera, dx: number, dy: number): Camera {
  return { ...camera, x: camera.x + dx, y: camera.y + dy };
}
export function worldViewport(camera: Camera, viewport: Viewport): Box {
  return screenBoxToWorld(
    { minX: 0, minY: 0, maxX: viewport.width, maxY: viewport.height },
    camera,
  );
}
export function screenBoxToWorld(box: Box, camera: Camera): Box {
  const min = toWorld([box.minX, box.minY], camera);
  const max = toWorld([box.maxX, box.maxY], camera);
  return { minX: min[0], minY: min[1], maxX: max[0], maxY: max[1] };
}
export function screenBounds(box: Box, camera: Camera, padding = 0): Box {
  const min = toScreen([box.minX, box.minY], camera);
  const max = toScreen([box.maxX, box.maxY], camera);
  return {
    minX: min[0] - padding,
    minY: min[1] - padding,
    maxX: max[0] + padding,
    maxY: max[1] + padding,
  };
}
export function ensureVisible(
  camera: Camera,
  box: Box,
  viewport: Viewport,
  padding = 24,
): Camera {
  const screen = screenBounds(box, camera);
  if (
    screen.minX >= padding &&
    screen.maxX <= viewport.width - padding &&
    screen.minY >= padding &&
    screen.maxY <= viewport.height - padding
  )
    return camera;
  return {
    ...camera,
    x: viewport.width / 2 - ((box.minX + box.maxX) / 2) * camera.scale,
    y: viewport.height / 2 - ((box.minY + box.maxY) / 2) * camera.scale,
  };
}

import { floorPlanSchema } from "@/lib/floor-plan/schema";
import type { Point } from "@/lib/floor-plan/render/types";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";
import type { Command } from "./commands";

export type PlanBackground = NonNullable<FloorPlanDocument["background"]>;

function sameBackground(
  before: PlanBackground | undefined,
  after: PlanBackground | undefined,
) {
  return (
    before === after ||
    (before !== undefined &&
      after !== undefined &&
      before.opacity === after.opacity &&
      before.transform.every(
        (value, index) => value === after.transform[index],
      ))
  );
}

function withBackground(
  document: FloorPlanDocument,
  background: PlanBackground | undefined,
): FloorPlanDocument {
  if (sameBackground(document.background, background)) return document;
  if (background) return { ...document, background };
  const next = { ...document };
  delete next.background;
  return next;
}

function backgroundCommand(
  document: FloorPlanDocument,
  after: PlanBackground | undefined,
  label: string,
): Command | null {
  const before = document.background;
  if (
    sameBackground(before, after) ||
    !floorPlanSchema.safeParse(withBackground(document, after)).success
  )
    return null;
  return {
    label,
    apply: (value) => withBackground(value, after),
    revert: (value) => withBackground(value, before),
  };
}

export function setBackgroundCommand(
  document: FloorPlanDocument,
  background: PlanBackground | null,
): Command | null {
  return backgroundCommand(
    document,
    background
      ? { opacity: background.opacity, transform: [...background.transform] }
      : undefined,
    background ? "배경 설정" : "배경 지우기",
  );
}

export function moveBackgroundCommand(
  document: FloorPlanDocument,
  delta: Point,
): Command | null {
  const background = document.background;
  if (!background || !delta.every(Number.isFinite)) return null;
  const [a, b, c, d, e, f] = background.transform;
  return backgroundCommand(
    document,
    { ...background, transform: [a, b, c, d, e + delta[0], f + delta[1]] },
    "배경 이동",
  );
}

export function rotateBackgroundCommand(
  document: FloorPlanDocument,
  pivotWorld: Point,
  delta = 90,
): Command | null {
  const background = document.background;
  if (
    !background ||
    !pivotWorld.every(Number.isFinite) ||
    !Number.isFinite(delta) ||
    delta % 90 !== 0
  )
    return null;
  const turns = (((delta / 90) % 4) + 4) % 4;
  const rotate = (x: number, y: number): Point => {
    if (turns === 1) return [-y, x];
    if (turns === 2) return [-x, -y];
    if (turns === 3) return [y, -x];
    return [x, y];
  };
  const [a, b, c, d, e, f] = background.transform;
  const first = rotate(a, b);
  const second = rotate(c, d);
  const position = rotate(e - pivotWorld[0], f - pivotWorld[1]);
  return backgroundCommand(
    document,
    {
      ...background,
      transform: [
        first[0] || 0,
        first[1] || 0,
        second[0] || 0,
        second[1] || 0,
        position[0] + pivotWorld[0],
        position[1] + pivotWorld[1],
      ],
    },
    "배경 회전",
  );
}

export function setBackgroundOpacityCommand(
  document: FloorPlanDocument,
  opacity: number,
): Command | null {
  if (!document.background) return null;
  return backgroundCommand(
    document,
    { ...document.background, opacity },
    "배경 투명도 변경",
  );
}

export function scaleBackgroundCommand(
  document: FloorPlanDocument,
  pointAWorld: Point,
  pointBWorld: Point,
  distanceMm: number,
): Command | null {
  const background = document.background;
  if (
    !background ||
    !pointAWorld.every(Number.isFinite) ||
    !pointBWorld.every(Number.isFinite) ||
    !Number.isFinite(distanceMm) ||
    distanceMm <= 0
  )
    return null;
  const distance = Math.hypot(
    pointBWorld[0] - pointAWorld[0],
    pointBWorld[1] - pointAWorld[1],
  );
  const ratio = distanceMm / distance;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  const [a, b, c, d, e, f] = background.transform;
  // 첫 측정점을 고정한 채 세계 좌표에서 배율을 적용해 기존 회전도 보존해요.
  return backgroundCommand(
    document,
    {
      ...background,
      transform: [
        a * ratio,
        b * ratio,
        c * ratio,
        d * ratio,
        pointAWorld[0] + ratio * (e - pointAWorld[0]),
        pointAWorld[1] + ratio * (f - pointAWorld[1]),
      ],
    },
    "배경 축척 맞추기",
  );
}

import type { PlanShape } from "./types";

type NavigationTarget = Pick<PlanShape, "id" | "labelAt" | "order">;
export type PlanDirection = "left" | "right" | "up" | "down";

function stableOrder(a: NavigationTarget, b: NavigationTarget) {
  return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function readingOrder<T extends NavigationTarget>(
  shapes: readonly T[],
): T[] {
  const byHeight = [...shapes].sort(
    (a, b) => a.labelAt[1] - b.labelAt[1] || stableOrder(a, b),
  );
  const rows: T[][] = [];
  let rowTop = -Infinity;
  for (const shape of byHeight) {
    // 비교할 때마다 행을 정하면 정렬이 비전이적이 되므로 행의 첫 y를 고정한다.
    if (shape.labelAt[1] - rowTop > 2000) {
      rows.push([]);
      rowTop = shape.labelAt[1];
    }
    rows.at(-1)!.push(shape);
  }
  return rows.flatMap((row) =>
    row.sort(
      (a, b) =>
        a.labelAt[0] - b.labelAt[0] ||
        a.labelAt[1] - b.labelAt[1] ||
        stableOrder(a, b),
    ),
  );
}

export function nearestInDirection<T extends NavigationTarget>(
  current: T,
  candidates: readonly T[],
  direction: PlanDirection,
): T | null {
  let nearest: T | null = null;
  let minimum = Infinity;
  for (const candidate of readingOrder(candidates)) {
    if (candidate.id === current.id) continue;
    const dx = candidate.labelAt[0] - current.labelAt[0];
    const dy = candidate.labelAt[1] - current.labelAt[1];
    const axis =
      direction === "left"
        ? -dx
        : direction === "right"
          ? dx
          : direction === "up"
            ? -dy
            : dy;
    if (axis <= 0) continue;
    const perpendicular =
      direction === "left" || direction === "right"
        ? Math.abs(dy)
        : Math.abs(dx);
    const distance = axis + 2 * perpendicular;
    if (distance < minimum) {
      nearest = candidate;
      minimum = distance;
    }
  }
  return nearest;
}

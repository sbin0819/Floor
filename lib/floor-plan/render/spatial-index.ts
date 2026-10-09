import RBush from "rbush";
import type { Box, PlanShape, PlanSpatialIndex } from "./types";

export function createSpatialIndex(
  shapes: readonly PlanShape[],
): PlanSpatialIndex {
  const tree = new RBush<Box & { shape: PlanShape }>();
  tree.load(shapes.map((shape) => ({ ...shape.bounds, shape })));
  return {
    search: (box) =>
      tree
        .search(box)
        .map((item) => item.shape)
        .sort((a, b) => a.order - b.order),
  };
}

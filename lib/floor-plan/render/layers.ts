import { screenBounds } from "./camera";
import { createPlanDrawer } from "./draw";
import type {
  Box,
  PlanContext,
  PlanDrawOptions,
  PlanFrame,
  PlanOverlay,
  PlanShapeState,
} from "./types";

const sameState = (
  a: PlanShapeState | undefined,
  b: PlanShapeState | undefined,
) =>
  a?.kind === b?.kind &&
  a?.name === b?.name &&
  a?.label === b?.label &&
  a?.deskArea === b?.deskArea &&
  a?.selected === b?.selected &&
  a?.hidden === b?.hidden;
const intersects = (a: Box, b: Box) =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
function regions(boxes: Box[]): Box[] {
  const merged: Box[] = [];
  for (let box of boxes) {
    let index = 0;
    while (index < merged.length) {
      const other = merged[index]!;
      if (!intersects(box, other)) {
        index++;
        continue;
      }
      box = {
        minX: Math.min(box.minX, other.minX),
        minY: Math.min(box.minY, other.minY),
        maxX: Math.max(box.maxX, other.maxX),
        maxY: Math.max(box.maxY, other.maxY),
      };
      merged.splice(index, 1);
      index = 0;
    }
    merged.push(box);
  }
  return merged;
}
export function createPlanLayers(
  contexts: { base: PlanContext; state: PlanContext; overlay: PlanContext },
  options: PlanDrawOptions = {},
) {
  const drawer = createPlanDrawer(options);
  let previous: PlanFrame | null = null;
  let previousOverlay: PlanOverlay = {};
  return {
    /** 캔버스 크기를 외부에서 다시 설정해 지워졌을 때는 force로 전체를 복원한다. */
    render(frame: PlanFrame, overlay: PlanOverlay = {}, force = false) {
      const full =
        force ||
        !previous ||
        previous.scene !== frame.scene ||
        previous.index !== frame.index ||
        previous.colors !== frame.colors ||
        previous.camera.scale !== frame.camera.scale ||
        previous.camera.x !== frame.camera.x ||
        previous.camera.y !== frame.camera.y ||
        previous.viewport.width !== frame.viewport.width ||
        previous.viewport.height !== frame.viewport.height ||
        previous.dpr !== frame.dpr;
      const changed = full
        ? []
        : frame.scene.shapes.filter(
            (shape) =>
              shape.spaceId &&
              !sameState(
                previous!.states.get(shape.spaceId),
                frame.states.get(shape.spaceId),
              ),
          );
      const baseChanged = changed.some((shape) => {
        const before = previous!.states.get(shape.spaceId!);
        const after = frame.states.get(shape.spaceId!);
        return (
          before?.hidden !== after?.hidden ||
          before?.deskArea !== after?.deskArea
        );
      });
      const dirty = regions(
        changed.map((shape) => screenBounds(shape.bounds, frame.camera, 2)),
      )
        .map((box) => ({
          minX: Math.max(0, box.minX),
          minY: Math.max(0, box.minY),
          maxX: Math.min(frame.viewport.width, box.maxX),
          maxY: Math.min(frame.viewport.height, box.maxY),
        }))
        .filter((box) => box.minX < box.maxX && box.minY < box.maxY);
      if (full || baseChanged) drawer.drawBase(contexts.base, frame);
      if (full) drawer.drawStates(contexts.state, frame);
      else
        for (const box of dirty) drawer.drawStates(contexts.state, frame, box);
      const overlayChanged =
        full ||
        baseChanged ||
        overlay.hoveredId !== previousOverlay.hoveredId ||
        overlay.selectedId !== previousOverlay.selectedId ||
        overlay.selectedSeatId !== previousOverlay.selectedSeatId ||
        (overlay.flashedIds ?? []).join("|") !==
          (previousOverlay.flashedIds ?? []).join("|") ||
        overlay.focusedId !== previousOverlay.focusedId;
      if (overlayChanged) drawer.drawOverlay(contexts.overlay, frame, overlay);
      // 호출자가 새 Map을 만들지 않더라도 다음 프레임과 비교할 값은 보존한다.
      previous = {
        ...frame,
        camera: { ...frame.camera },
        viewport: { ...frame.viewport },
        states: new Map(
          [...frame.states].map(([key, state]) => [key, { ...state }]),
        ),
      };
      previousOverlay = { ...overlay, flashedIds: overlay.flashedIds?.slice() };
      return {
        base: full || baseChanged,
        state: full || dirty.length > 0,
        overlay: overlayChanged,
        dirty,
      };
    },
  };
}

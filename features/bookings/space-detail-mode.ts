import type { FloorVisibleSpace } from "./types";

export function hasDeskSeats(
  space:
    | Pick<FloorVisibleSpace, "type" | "bookable" | "deskCount">
    | null
    | undefined,
) {
  return space?.type === "desk_area" && !space.bookable && space.deskCount > 0;
}

export function spaceDetailMode({
  wide,
  view,
  detail,
  space,
}: {
  wide: boolean;
  view: "plan" | "list" | "timeline";
  detail: boolean;
  space?: Pick<FloorVisibleSpace, "type" | "bookable" | "deskCount"> | null;
}) {
  const desk = hasDeskSeats(space);
  const mode = !wide
    ? "sheet"
    : view !== "timeline"
      ? "panel"
      : detail || desk
        ? "detail"
        : "strip";
  return { mode, desk, keepSpaceOnClose: mode === "detail" && !desk } as const;
}

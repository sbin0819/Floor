export type FloorView = "plan" | "list" | "timeline";

export function resolveFloorView(
  url: unknown,
  cookie: unknown,
): FloorView | null {
  if (url === "plan" || url === "list" || url === "timeline") return url;
  return cookie === "plan" || cookie === "list" || cookie === "timeline"
    ? cookie
    : null;
}

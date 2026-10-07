export type FloorView = "list" | "timeline";

export function resolveFloorView(
  url: unknown,
  cookie: unknown,
): FloorView | null {
  if (url === "list" || url === "timeline") return url;
  return cookie === "list" || cookie === "timeline" ? cookie : null;
}

export type SpaceDetailTab = "info" | "access" | "photos";
export function spaceDetailTab(value: unknown): SpaceDetailTab {
  return value === "access" || value === "photos" ? value : "info";
}
export function adminSpacePath(
  branchId: string,
  floorId: string,
  spaceId: string,
) {
  return `/admin/branches/${encodeURIComponent(branchId)}/floors/${encodeURIComponent(floorId)}/spaces/${encodeURIComponent(spaceId)}`;
}
export function adminSpaceHref(
  path: string,
  tab: SpaceDetailTab,
  team?: string,
) {
  const query = new URLSearchParams();
  if (tab !== "info") query.set("tab", tab);
  if (tab === "access" && team) query.set("team", team);
  return `${path}${query.size ? `?${query}` : ""}`;
}

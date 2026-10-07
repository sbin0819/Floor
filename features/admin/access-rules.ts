import type { AccessScope } from "@/lib/permissions/types";

export type FloorAccessSetting = {
  access: AccessScope;
  allowedTeamIds: readonly string[];
};
export type SpaceAccessSetting = {
  access: AccessScope | null;
  allowedTeamIds: readonly string[];
};
export type SpaceAccessAdjustment = {
  id: string;
  name: string;
  access: AccessScope | null;
  allowedTeamIds: string[];
};

export function allowedSpaceAccessValues(
  floorAccess: AccessScope,
): (AccessScope | null)[] {
  switch (floorAccess) {
    case "everyone":
      return [null, "everyone", "teams", "closed"];
    case "teams":
      return [null, "teams", "closed"];
    case "closed":
      return [null, "closed"];
  }
}

export function validateSpaceAccess({
  floor,
  space,
}: {
  floor: FloorAccessSetting;
  space: SpaceAccessSetting;
}): string | null {
  if (!allowedSpaceAccessValues(floor.access).includes(space.access))
    return "공간의 이용 대상은 층보다 넓게 정할 수 없어요";
  if (space.access !== "teams")
    return space.allowedTeamIds.length === 0
      ? null
      : "지정한 팀을 선택했을 때만 팀을 정할 수 있어요";
  if (space.allowedTeamIds.length === 0)
    return "이용할 팀을 한 곳 이상 골라 주세요";
  if (
    floor.access === "teams" &&
    space.allowedTeamIds.some((id) => !floor.allowedTeamIds.includes(id))
  )
    return "층을 이용할 수 있는 팀 중에서 골라 주세요";
  return null;
}

export function adjustSpacesForFloor(
  floor: FloorAccessSetting,
  spaces: readonly (SpaceAccessSetting & { id: string; name: string })[],
): SpaceAccessAdjustment[] {
  if (floor.access !== "teams") return [];
  const floorTeams = new Set(floor.allowedTeamIds);
  const changes: SpaceAccessAdjustment[] = [];
  for (const space of spaces) {
    if (space.access === "everyone") {
      changes.push({
        id: space.id,
        name: space.name,
        access: null,
        allowedTeamIds: [],
      });
    } else if (space.access === "teams") {
      const allowedTeamIds = [...new Set(space.allowedTeamIds)].filter((id) =>
        floorTeams.has(id),
      );
      // 교집합이 없을 때 null로 바꾸면 층의 다른 팀에게 공간이 열려요.
      if (
        allowedTeamIds.length === 0 ||
        allowedTeamIds.length !== space.allowedTeamIds.length
      )
        changes.push({
          id: space.id,
          name: space.name,
          access: allowedTeamIds.length === 0 ? "closed" : "teams",
          allowedTeamIds,
        });
    }
  }
  return changes;
}

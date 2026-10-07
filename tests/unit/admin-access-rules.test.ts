import { describe, expect, it } from "vitest";
import {
  adjustSpacesForFloor,
  allowedSpaceAccessValues,
  validateSpaceAccess,
  type FloorAccessSetting,
  type SpaceAccessSetting,
} from "@/features/admin/access-rules";
import { canAccess } from "@/lib/permissions/can-access";
import type { AccessScope, PermissionContext } from "@/lib/permissions/types";

const teamCombinations = [
  [],
  ["A"],
  ["B"],
  ["C"],
  ["A", "B"],
  ["A", "C"],
  ["B", "C"],
  ["A", "B", "C"],
];
const accessValues: (AccessScope | null)[] = [
  null,
  "everyone",
  "teams",
  "closed",
];
const spaces = [
  { id: "everyone", name: "공용", access: "everyone", allowedTeamIds: [] },
  {
    id: "partial",
    name: "일부 남음",
    access: "teams",
    allowedTeamIds: ["A", "C"],
  },
  { id: "removed", name: "팀이 없음", access: "teams", allowedTeamIds: ["C"] },
  { id: "unchanged", name: "그대로", access: "teams", allowedTeamIds: ["A"] },
  { id: "closed", name: "닫힘", access: "closed", allowedTeamIds: [] },
  { id: "inherited", name: "층 설정", access: null, allowedTeamIds: [] },
] satisfies (SpaceAccessSetting & { id: string; name: string })[];

function context(
  teamIds: string[],
  staffBranchIds: string[] = [],
): PermissionContext {
  return {
    userId: "user",
    teams: teamIds.map((teamId) => ({ teamId, role: "member" })),
    staffBranchIds,
    roleSettings: {},
  };
}
function accessible(
  ctx: PermissionContext,
  floor: FloorAccessSetting,
  space: SpaceAccessSetting,
) {
  return canAccess(ctx, {
    floor: {
      ...floor,
      branchId: "branch",
      allowedTeamIds: [...floor.allowedTeamIds],
    },
    ...space,
    allowedTeamIds: [...space.allowedTeamIds],
  });
}

describe("space access validation", () => {
  const matrix: [AccessScope, AccessScope | null, boolean][] = [
    ["everyone", null, true],
    ["everyone", "everyone", true],
    ["everyone", "teams", true],
    ["everyone", "closed", true],
    ["teams", null, true],
    ["teams", "everyone", false],
    ["teams", "teams", true],
    ["teams", "closed", true],
    ["closed", null, true],
    ["closed", "everyone", false],
    ["closed", "teams", false],
    ["closed", "closed", true],
  ];
  it.each(matrix)(
    "floor %s / space %s is allowed: %s",
    (floorAccess, spaceAccess, allowed) => {
      const reason = validateSpaceAccess({
        floor: {
          access: floorAccess,
          allowedTeamIds: floorAccess === "teams" ? ["A", "B"] : [],
        },
        space: {
          access: spaceAccess,
          allowedTeamIds: spaceAccess === "teams" ? ["A"] : [],
        },
      });
      expect(reason === null).toBe(allowed);
      expect(allowedSpaceAccessValues(floorAccess).includes(spaceAccess)).toBe(
        allowed,
      );
      if (!allowed) expect(reason).toEqual(expect.any(String));
    },
  );
  it.each([
    { teams: ["A"], allowed: true },
    { teams: ["A", "B"], allowed: true },
    { teams: ["A", "C"], allowed: false },
    { teams: ["C"], allowed: false },
    { teams: [], allowed: false },
  ])("restricts $teams to the floor's teams", ({ teams, allowed }) => {
    expect(
      validateSpaceAccess({
        floor: { access: "teams", allowedTeamIds: ["A", "B"] },
        space: { access: "teams", allowedTeamIds: teams },
      }) === null,
    ).toBe(allowed);
  });
  it("requires at least one team even when the floor is open to everyone", () => {
    expect(
      validateSpaceAccess({
        floor: { access: "everyone", allowedTeamIds: [] },
        space: { access: "teams", allowedTeamIds: [] },
      }),
    ).not.toBeNull();
  });
  it.each([null, "everyone", "closed"] as const)(
    "rejects grants for non-team space access %s",
    (access) => {
      expect(
        validateSpaceAccess({
          floor: { access: "everyone", allowedTeamIds: [] },
          space: { access, allowedTeamIds: ["A"] },
        }),
      ).not.toBeNull();
    },
  );
  it("returns a fresh UI list and preserves the order of choices", () => {
    const choices = allowedSpaceAccessValues("everyone");
    expect(choices).toEqual([null, "everyone", "teams", "closed"]);
    choices.pop();
    expect(allowedSpaceAccessValues("everyone")).toHaveLength(4);
    expect(allowedSpaceAccessValues("teams")).toEqual([
      null,
      "teams",
      "closed",
    ]);
    expect(allowedSpaceAccessValues("closed")).toEqual([null, "closed"]);
  });
});

describe("floor access adjustments", () => {
  it("returns only changed values, including a grant-only shrink", () => {
    expect(
      adjustSpacesForFloor(
        { access: "teams", allowedTeamIds: ["A", "B"] },
        spaces,
      ),
    ).toEqual([
      { id: "everyone", name: "공용", access: null, allowedTeamIds: [] },
      {
        id: "partial",
        name: "일부 남음",
        access: "teams",
        allowedTeamIds: ["A"],
      },
      {
        id: "removed",
        name: "팀이 없음",
        access: "closed",
        allowedTeamIds: [],
      },
    ]);
  });
  it.each(["everyone", "closed"] as const)(
    "preserves all space settings when the new floor access is %s",
    (access) => {
      expect(
        adjustSpacesForFloor({ access, allowedTeamIds: [] }, spaces),
      ).toEqual([]);
    },
  );
  it("closes a team space with no remaining grant instead of inheriting another team's access", () => {
    const original = {
      id: "private",
      name: "A팀 전용",
      access: "teams",
      allowedTeamIds: ["A"],
    } as const;
    const floor = { access: "teams", allowedTeamIds: ["B"] } as const;
    const [changed] = adjustSpacesForFloor(floor, [original]);
    expect(changed).toEqual({
      id: "private",
      name: "A팀 전용",
      access: "closed",
      allowedTeamIds: [],
    });
    expect(changed && accessible(context(["B"]), floor, changed)).toBe(false);
  });
  it("also closes an already invalid empty-team space", () => {
    expect(
      adjustSpacesForFloor({ access: "teams", allowedTeamIds: ["A"] }, [
        { id: "empty", name: "빈 목록", access: "teams", allowedTeamIds: [] },
      ]),
    ).toEqual([
      { id: "empty", name: "빈 목록", access: "closed", allowedTeamIds: [] },
    ]);
  });
  it("does not mutate the floor or spaces and is idempotent", () => {
    const floor = Object.freeze({
      access: "teams",
      allowedTeamIds: Object.freeze(["A", "B"]),
    } as const);
    const frozenSpaces = Object.freeze(
      spaces.map((space) =>
        Object.freeze({
          ...space,
          allowedTeamIds: Object.freeze([...space.allowedTeamIds]),
        }),
      ),
    );
    const original = structuredClone(spaces);
    const adjusted = adjustSpacesForFloor(floor, frozenSpaces);
    expect(spaces).toEqual(original);
    const resultingSpaces = spaces.map(
      (space) => adjusted.find(({ id }) => id === space.id) ?? space,
    );
    expect(adjustSpacesForFloor(floor, resultingSpaces)).toEqual([]);
  });
  it.each(teamCombinations.map((allowedTeamIds) => ({ allowedTeamIds })))(
    "keeps canAccess equivalent for every membership combination when new floor grants are $allowedTeamIds",
    ({ allowedTeamIds }) => {
      const floor = { access: "teams", allowedTeamIds } as const;
      for (const access of accessValues) {
        for (const spaceTeams of teamCombinations) {
          const original = {
            id: "space",
            name: "검사 공간",
            access,
            allowedTeamIds: spaceTeams,
          };
          const [adjusted] = adjustSpacesForFloor(floor, [original]);
          for (const userTeams of teamCombinations) {
            for (const staffBranches of [[], ["branch"], ["other-branch"]]) {
              const ctx = context(userTeams, staffBranches);
              expect(accessible(ctx, floor, adjusted ?? original)).toBe(
                accessible(ctx, floor, original),
              );
            }
          }
        }
      }
    },
  );
  it.each(["everyone", "teams"] as const)(
    "closing and reopening a %s floor restores every original access decision",
    (access) => {
      const floor = {
        access,
        allowedTeamIds: access === "teams" ? ["A", "B"] : [],
      };
      const closed = { access: "closed", allowedTeamIds: [] } as const;
      expect(adjustSpacesForFloor(closed, spaces)).toEqual([]);
      const reopenedChanges = adjustSpacesForFloor(floor, spaces);
      for (const space of spaces) {
        const reopened =
          reopenedChanges.find(({ id }) => id === space.id) ?? space;
        for (const teams of teamCombinations) {
          expect(accessible(context(teams), closed, space)).toBe(false);
          expect(accessible(context(teams), floor, reopened)).toBe(
            accessible(context(teams), floor, space),
          );
        }
      }
    },
  );
});

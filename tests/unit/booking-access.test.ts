import { describe, expect, it } from "vitest";
import { availableBookingActors, canBookAs } from "@/features/bookings/access";
import type {
  AccessScope,
  PermissionContext,
  SpaceForAccess,
} from "@/lib/permissions/types";

function context(
  teamIds: string[] = [],
  staffBranchIds: string[] = [],
): PermissionContext {
  return {
    userId: "user",
    teams: teamIds.map((teamId) => ({ teamId, role: "member" })),
    staffBranchIds,
    roleSettings: {},
  };
}

function space({
  floor = "everyone",
  floorTeams = [],
  access = null,
  teams = [],
}: {
  floor?: AccessScope;
  floorTeams?: string[];
  access?: AccessScope | null;
  teams?: string[];
} = {}): SpaceForAccess {
  return {
    access,
    allowedTeamIds: teams,
    floor: { branchId: "branch", access: floor, allowedTeamIds: floorTeams },
  };
}

describe("booking actors in common spaces", () => {
  it.each([
    [[], null, true],
    [[], "A", false],
    [["A"], null, true],
    [["A"], "A", true],
    [["A"], "B", false],
    [["A", "B"], null, true],
    [["A", "B"], "A", true],
    [["A", "B"], "B", true],
  ] as [string[], string | null, boolean][])(
    "checks memberships %j as %s",
    (teams, actor, expected) => {
      expect(canBookAs(context(teams), space(), actor)).toBe(expected);
    },
  );

  it("lists personal first, then every allowed membership once", () => {
    expect(availableBookingActors(context(), space())).toEqual([null]);
    expect(availableBookingActors(context(["A", "B", "A"]), space())).toEqual([
      null,
      "A",
      "B",
    ]);
  });
});

describe("booking actors in restricted spaces", () => {
  const onlyA = space({ access: "teams", teams: ["A"] });
  it.each([
    [[], null, false],
    [[], "A", false],
    [["A"], null, false],
    [["A"], "A", true],
    [["A"], "B", false],
    [["A", "B"], "A", true],
    [["A", "B"], "B", false],
  ] as [string[], string | null, boolean][])(
    "restricts memberships %j as %s to the chosen allowed team",
    (teams, actor, expected) => {
      expect(canBookAs(context(teams), onlyA, actor)).toBe(expected);
    },
  );

  it.each([null, "everyone", "teams", "closed"] as const)(
    "intersects a teams floor with space access %s",
    (access) => {
      const target = space({
        floor: "teams",
        floorTeams: ["A", "B"],
        access,
        teams: ["A"],
      });
      const current = context(["A", "B", "C"]);
      expect(canBookAs(current, target, null)).toBe(false);
      expect(canBookAs(current, target, "A")).toBe(access !== "closed");
      expect(canBookAs(current, target, "B")).toBe(
        access === null || access === "everyone",
      );
      expect(canBookAs(current, target, "C")).toBe(false);
    },
  );

  it("does not combine separate memberships across disjoint floor and space grants", () => {
    const target = space({
      floor: "teams",
      floorTeams: ["A"],
      access: "teams",
      teams: ["B"],
    });
    expect(availableBookingActors(context(["A", "B"]), target)).toEqual([]);
  });

  it.each([space({ floor: "closed" }), space({ access: "closed" })])(
    "does not expose actors in a closed target",
    (target) => {
      expect(availableBookingActors(context(["A", "B"]), target)).toEqual([]);
    },
  );
});

describe("operator scope and configurable permissions", () => {
  it("allows personal bookings in its own closed or team-only spaces", () => {
    const operator = context(["A", "B"], ["branch"]);
    expect(canBookAs(operator, space({ floor: "closed" }), null)).toBe(true);
    expect(canBookAs(operator, space({ access: "closed" }), null)).toBe(true);
    expect(
      availableBookingActors(
        operator,
        space({ access: "teams", teams: ["A"] }),
      ),
    ).toEqual([null, "A"]);
  });

  it("does not extend operator bypass to team actors or another branch", () => {
    const operator = context(["A", "B"], ["branch"]);
    expect(canBookAs(operator, space({ floor: "closed" }), "A")).toBe(false);
    expect(
      canBookAs(operator, space({ access: "teams", teams: ["A"] }), "B"),
    ).toBe(false);
    expect(
      canBookAs(
        context(["A"], ["other-branch"]),
        space({ floor: "closed" }),
        null,
      ),
    ).toBe(false);
  });

  it("requires floor.view and the selected actor's booking permission", () => {
    const current = context(["A"], ["branch"]);
    current.roleSettings.branch = { user: [] };
    expect(availableBookingActors(current, space())).toEqual([]);
    current.roleSettings.branch = { user: ["floor.view"], team_member: [] };
    expect(availableBookingActors(current, space())).toEqual([]);
    current.roleSettings.branch = {
      user: ["floor.view", "booking.own"],
      team_member: [],
    };
    expect(availableBookingActors(current, space())).toEqual([null]);
    current.roleSettings.branch = {
      user: ["floor.view"],
      team_member: ["booking.team"],
    };
    expect(availableBookingActors(current, space())).toEqual(["A"]);
  });

  it("still requires team membership when user settings grant booking.team", () => {
    const current = context();
    current.roleSettings.branch = { user: ["floor.view", "booking.team"] };
    expect(canBookAs(current, space(), "A")).toBe(false);
  });
});

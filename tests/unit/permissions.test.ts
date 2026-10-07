import { describe, expect, it } from "vitest";

import { can, heldRoles } from "@/lib/permissions/can";
import { canAccess, canAccessFloor } from "@/lib/permissions/can-access";
import { defaultLimits, defaultPermissions } from "@/lib/permissions/defaults";
import {
  isPermissionKey,
  permissionKeys,
  roles,
  type PermissionKey,
  type Role,
} from "@/lib/permissions/keys";
import type {
  PermissionContext,
  SpaceForAccess,
} from "@/lib/permissions/types";

const branchId = "branch-a";
const target = { branchId, teamId: "team-a" };

function context(patch: Partial<PermissionContext> = {}): PermissionContext {
  return {
    userId: "user-a",
    teams: [],
    staffBranchIds: [],
    roleSettings: {},
    ...patch,
  };
}

const grants: [PermissionKey, Role][] = [
  ["floor.view", "user"],
  ["booking.own", "user"],
  ["chat.lounge", "user"],
  ["booking.team", "team_member"],
  ["chat.team", "team_member"],
  ["booking.manage_team", "team_admin"],
  ["chat.team.moderate", "team_admin"],
  ["team.manage_members", "team_admin"],
  ["booking.manage_all", "operator"],
  ["branch.announce", "operator"],
  ["space.manage", "operator"],
  ["plan.edit", "operator"],
  ["stats.view", "operator"],
  ["roles.manage", "operator"],
];

describe("role defaults", () => {
  it("defines exactly the documented 14 permission keys and four roles", () => {
    expect(permissionKeys).toEqual(grants.map(([permission]) => permission));
    expect(roles).toEqual(["user", "team_member", "team_admin", "operator"]);
    expect(isPermissionKey("booking.own")).toBe(true);
    expect(isPermissionKey("booking.destroy")).toBe(false);
  });

  for (const role of roles) {
    it.each(grants)(
      `${role} adds %s only if the documented role is %s`,
      (permission, expectedRole) => {
        expect(defaultPermissions[role].includes(permission)).toBe(
          role === expectedRole,
        );
      },
    );
  }

  it("defines defaults, unlimited operator values, and no separate admin limits", () => {
    expect(defaultLimits).toEqual({
      user: {
        maxMinutesPerBooking: 120,
        maxMinutesPerDay: 120,
        maxDaysAhead: 7,
      },
      team_member: {
        maxMinutesPerBooking: 240,
        maxMinutesPerDay: 480,
        maxDaysAhead: 14,
      },
      team_admin: {},
      operator: {
        maxMinutesPerBooking: null,
        maxMinutesPerDay: null,
        maxDaysAhead: null,
      },
    });
  });
});

const profiles = [
  {
    name: "user",
    ctx: context(),
    expectedRoles: ["user"],
    enabled: [
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ],
  },
  {
    name: "member",
    ctx: context({ teams: [{ teamId: "team-a", role: "member" }] }),
    expectedRoles: ["user", "team_member"],
    enabled: [
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ],
  },
  {
    name: "admin",
    ctx: context({ teams: [{ teamId: "team-a", role: "admin" }] }),
    expectedRoles: ["user", "team_member", "team_admin"],
    enabled: [
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ],
  },
  {
    name: "operator",
    ctx: context({ staffBranchIds: [branchId] }),
    expectedRoles: ["user", "operator"],
    enabled: [
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      true,
      true,
      true,
      true,
      true,
      true,
    ],
  },
];

describe("can", () => {
  for (const profile of profiles) {
    it(`${profile.name} holds the roles for this target`, () => {
      expect(heldRoles(profile.ctx, target)).toEqual(profile.expectedRoles);
    });
    permissionKeys.forEach((permission, index) => {
      it(`${profile.name} checks ${permission} against the union of held roles`, () => {
        expect(can(profile.ctx, permission, target)).toBe(
          profile.enabled[index],
        );
      });
    });
  }

  it("overrides only the stored role, retaining defaults for the other held roles", () => {
    const ctx = context({
      teams: [{ teamId: "team-a", role: "admin" }],
      roleSettings: { [branchId]: { user: ["stats.view"] } },
    });
    expect(can(ctx, "floor.view", target)).toBe(false);
    expect(can(ctx, "stats.view", target)).toBe(true);
    expect(can(ctx, "booking.team", target)).toBe(true);
    expect(can(ctx, "team.manage_members", target)).toBe(true);
  });

  it("treats a stored empty list as an override and preserves roles.manage for operators", () => {
    const ctx = context({
      staffBranchIds: [branchId],
      roleSettings: { [branchId]: { operator: [] } },
    });
    expect(can(ctx, "plan.edit", target)).toBe(false);
    expect(can(ctx, "roles.manage", target)).toBe(true);
    expect(can(ctx, "floor.view", target)).toBe(true);
  });

  it("uses defaults for targets with no branch and for branches with no settings", () => {
    const ctx = context({
      teams: [{ teamId: "team-a", role: "member" }],
      roleSettings: { [branchId]: { user: [], team_member: [] } },
    });
    expect(can(ctx, "chat.team", target)).toBe(false);
    expect(can(ctx, "chat.team", { teamId: "team-a" })).toBe(true);
    expect(can(ctx, "floor.view", {})).toBe(true);
    expect(
      can(ctx, "chat.team", { branchId: "branch-b", teamId: "team-a" }),
    ).toBe(true);
  });

  it("resolves admin, member, and operator roles only for their own team and branch", () => {
    const ctx = context({
      teams: [
        { teamId: "team-a", role: "admin" },
        { teamId: "team-b", role: "member" },
      ],
      staffBranchIds: [branchId],
    });
    expect(heldRoles(ctx, target)).toEqual([
      "user",
      "team_member",
      "team_admin",
      "operator",
    ]);
    expect(can(ctx, "team.manage_members", { teamId: "team-a" })).toBe(true);
    expect(can(ctx, "team.manage_members", { teamId: "team-b" })).toBe(false);
    expect(can(ctx, "booking.team", { teamId: "team-b" })).toBe(true);
    expect(can(ctx, "chat.team", { teamId: "team-c" })).toBe(false);
    expect(can(ctx, "space.manage", { branchId: "branch-b" })).toBe(false);
    expect(can(ctx, "space.manage", {})).toBe(false);
  });
});

const accessCases: {
  name: string;
  space: SpaceForAccess;
  expected: boolean[];
}[] = [
  {
    name: "everyone / inherit",
    space: {
      floor: { branchId, access: "everyone", allowedTeamIds: [] },
      access: null,
      allowedTeamIds: [],
    },
    expected: [true, true, true, true],
  },
  {
    name: "everyone / team A",
    space: {
      floor: { branchId, access: "everyone", allowedTeamIds: [] },
      access: "teams",
      allowedTeamIds: ["team-a"],
    },
    expected: [false, true, false, true],
  },
  {
    name: "everyone / closed",
    space: {
      floor: { branchId, access: "everyone", allowedTeamIds: [] },
      access: "closed",
      allowedTeamIds: [],
    },
    expected: [false, false, false, false],
  },
  {
    name: "teams A B / inherit",
    space: {
      floor: {
        branchId,
        access: "teams",
        allowedTeamIds: ["team-a", "team-b"],
      },
      access: null,
      allowedTeamIds: [],
    },
    expected: [false, true, true, true],
  },
  {
    name: "teams A B / team A",
    space: {
      floor: {
        branchId,
        access: "teams",
        allowedTeamIds: ["team-a", "team-b"],
      },
      access: "teams",
      allowedTeamIds: ["team-a"],
    },
    expected: [false, true, false, true],
  },
  {
    name: "team A / team B",
    space: {
      floor: { branchId, access: "teams", allowedTeamIds: ["team-a"] },
      access: "teams",
      allowedTeamIds: ["team-b"],
    },
    expected: [false, false, false, false],
  },
  {
    name: "team A / invalid everyone override",
    space: {
      floor: { branchId, access: "teams", allowedTeamIds: ["team-a"] },
      access: "everyone",
      allowedTeamIds: [],
    },
    expected: [false, true, false, true],
  },
  {
    name: "closed / inherit",
    space: {
      floor: { branchId, access: "closed", allowedTeamIds: [] },
      access: null,
      allowedTeamIds: [],
    },
    expected: [false, false, false, false],
  },
  {
    name: "closed / invalid everyone override",
    space: {
      floor: { branchId, access: "closed", allowedTeamIds: [] },
      access: "everyone",
      allowedTeamIds: [],
    },
    expected: [false, false, false, false],
  },
];

const memberships = [[], ["team-a"], ["team-b"], ["team-a", "team-b"]];

describe("canAccess", () => {
  for (const { name, space, expected } of accessCases) {
    memberships.forEach((teamIds, index) => {
      const teams = teamIds.map((teamId) => ({
        teamId,
        role: "member" as const,
      }));
      const membershipName = teamIds.join(", ") || "no teams";
      it(`${name}: ${membershipName}`, () => {
        expect(canAccess(context({ teams }), space)).toBe(expected[index]);
      });
      it(`${name}: local operator with ${membershipName}`, () => {
        expect(
          canAccess(context({ teams, staffBranchIds: [branchId] }), space),
        ).toBe(true);
      });
      it(`${name}: other branch operator with ${membershipName}`, () => {
        expect(
          canAccess(context({ teams, staffBranchIds: ["branch-b"] }), space),
        ).toBe(expected[index]);
      });
    });
  }

  it("denies a teams scope with no grants even to team members", () => {
    const ctx = context({ teams: [{ teamId: "team-a", role: "admin" }] });
    expect(
      canAccess(ctx, {
        floor: { branchId, access: "teams", allowedTeamIds: [] },
        access: null,
        allowedTeamIds: [],
      }),
    ).toBe(false);
    expect(
      canAccess(ctx, {
        floor: { branchId, access: "everyone", allowedTeamIds: [] },
        access: "teams",
        allowedTeamIds: [],
      }),
    ).toBe(false);
  });
});

describe("canAccessFloor", () => {
  it.each([
    {
      access: "everyone",
      allowedTeamIds: [],
      expected: [true, true, true, true],
    },
    {
      access: "teams",
      allowedTeamIds: ["team-a"],
      expected: [false, true, false, true],
    },
    {
      access: "teams",
      allowedTeamIds: [],
      expected: [false, false, false, false],
    },
    {
      access: "closed",
      allowedTeamIds: ["team-a"],
      expected: [false, false, false, false],
    },
  ] as const)(
    "checks $access with $allowedTeamIds",
    ({ access, allowedTeamIds, expected }) => {
      memberships.forEach((teamIds, index) => {
        const floor = { branchId, access, allowedTeamIds: [...allowedTeamIds] };
        const teams = teamIds.map((teamId) => ({
          teamId,
          role: "member" as const,
        }));
        expect(canAccessFloor(context({ teams }), floor)).toBe(expected[index]);
        expect(
          canAccessFloor(context({ teams, staffBranchIds: [branchId] }), floor),
        ).toBe(true);
        expect(
          canAccessFloor(
            context({ teams, staffBranchIds: ["branch-b"] }),
            floor,
          ),
        ).toBe(expected[index]);
      });
    },
  );
});

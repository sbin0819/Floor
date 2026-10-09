import { describe, expect, it } from "vitest";
import {
  applyRoleSettingsChanges,
  changedRoleSettings,
  countRoleSettingsChanges,
  effectiveRoleLimits,
  lostPermissions,
  normalizeRoleSetting,
  permissionCell,
  permissionLabels,
  permissionsEqual,
  roleLabels,
} from "@/features/admin/role-settings-editor";
import {
  resetRoleSettingsSchema,
  roleSettingSchema,
  updateRoleSettingsSchema,
} from "@/features/admin/role-settings-schema";
import type {
  RoleSettingInput,
  RoleSettingsValues,
} from "@/features/admin/role-settings-types";
import { resolveBookingLimits } from "@/features/bookings/limits";
import { defaultLimits, defaultPermissions } from "@/lib/permissions/defaults";
import {
  permissionKeys,
  roles,
  type PermissionKey,
  type Role,
} from "@/lib/permissions/keys";

const branchId = "a1000000-0000-4000-8000-000000000001";
const context = { branchId, isOperator: true };
const before = (): RoleSettingsValues => ({
  user: { permissions: [...defaultPermissions.user], limits: {} },
  team_member: { permissions: [...defaultPermissions.team_member], limits: {} },
  team_admin: { permissions: [...defaultPermissions.team_admin], limits: {} },
  operator: { permissions: [...defaultPermissions.operator], limits: {} },
});
const setting = (role: Role = "user"): RoleSettingInput => ({
  role,
  permissions: [...defaultPermissions[role]],
  limits: {},
});
const input = () => ({
  branchId,
  roles: [setting()],
  expectedUpdatedAt: null as string | null,
});

describe("role settings strict input", () => {
  it("normalizes branch UUID and revision to the database millisecond contract", () => {
    expect(
      updateRoleSettingsSchema.parse({
        ...input(),
        branchId: branchId.toUpperCase(),
        expectedUpdatedAt: "2026-10-09T13:30:10.123456+09:00",
      }),
    ).toEqual({
      ...input(),
      expectedUpdatedAt: "2026-10-09T04:30:10.123Z",
    });
    expect(
      resetRoleSettingsSchema.parse({ branchId, expectedUpdatedAt: null }),
    ).toEqual({
      branchId,
      expectedUpdatedAt: null,
    });
  });

  it.each([
    { branchId: "no-id" },
    { branchId: "" },
    { branchId: 3 },
    { expectedUpdatedAt: undefined },
    { expectedUpdatedAt: "2026-10-09T13:30:00" },
    { expectedUpdatedAt: "2026-02-30T13:30:00Z" },
    { expectedUpdatedAt: new Date("2026-10-09T00:00:00Z") },
    { roles: [] },
    { roles: [...roles.map(setting), setting()] },
    { roles: [setting(), setting()] },
    { roles: [{ ...setting(), role: "owner" }] },
    { roles: [{ ...setting(), permissions: ["users.destroy"] }] },
    { roles: [{ ...setting(), permissions: "floor.view" }] },
    { roles: [{ role: "user", permissions: [] }] },
    { roles: [{ ...setting(), limits: null }] },
    { roles: [{ ...setting(), limits: { unknown: 30 } }] },
    { roles: [{ ...setting(), stored: true }] },
    { roles: [{ ...setting(), updatedBy: branchId }] },
    { updatedBy: branchId },
  ])("rejects malformed or unexpected public action input %j", (patch) => {
    expect(
      updateRoleSettingsSchema.safeParse({ ...input(), ...patch }).success,
    ).toBe(false);
  });

  it("accepts at most one of each role, including empty permissions and partial limits", () => {
    const values = roles.map((role) => ({ ...setting(role), permissions: [] }));
    expect(
      updateRoleSettingsSchema.parse({ ...input(), roles: values }).roles,
    ).toEqual(values);
    expect(
      roleSettingSchema.parse({
        ...setting(),
        limits: { maxMinutesPerDay: null },
      }).limits,
    ).toEqual({
      maxMinutesPerDay: null,
    });
  });

  it.each(["maxMinutesPerBooking", "maxMinutesPerDay"] as const)(
    "accepts each valid %s value and rejects non-slot values",
    (key) => {
      for (const value of [30, 60, 1440, null]) {
        expect(
          roleSettingSchema.safeParse({
            ...setting(),
            limits: { [key]: value },
          }).success,
        ).toBe(true);
      }
      for (const value of [
        0,
        -30,
        29,
        31,
        30.5,
        1441,
        1470,
        "60",
        true,
        NaN,
        Infinity,
      ]) {
        expect(
          roleSettingSchema.safeParse({
            ...setting(),
            limits: { [key]: value },
          }).success,
        ).toBe(false);
      }
    },
  );

  it("accepts day bounds or null without adding a per-day/per-booking ordering rule", () => {
    for (const value of [1, 7, 90, null]) {
      expect(
        roleSettingSchema.safeParse({
          ...setting(),
          limits: { maxDaysAhead: value },
        }).success,
      ).toBe(true);
    }
    for (const value of [0, -1, 1.5, 91, "7", NaN, Infinity]) {
      expect(
        roleSettingSchema.safeParse({
          ...setting(),
          limits: { maxDaysAhead: value },
        }).success,
      ).toBe(false);
    }
    expect(
      roleSettingSchema.safeParse({
        ...setting(),
        limits: { maxMinutesPerBooking: 240, maxMinutesPerDay: 60 },
      }).success,
    ).toBe(true);
  });

  it("allows team administrators only an actually empty limits object", () => {
    expect(roleSettingSchema.parse(setting("team_admin")).limits).toEqual({});
    for (const limits of [
      { maxDaysAhead: 1 },
      { maxDaysAhead: null },
      { maxDaysAhead: undefined },
    ]) {
      const parsed = roleSettingSchema.safeParse({
        ...setting("team_admin"),
        limits,
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success)
        expect(parsed.error.issues[0]?.path).toEqual(["limits"]);
    }
  });

  it("does not allow update fields or caller identity through reset", () => {
    expect(resetRoleSettingsSchema.safeParse(input()).success).toBe(false);
    expect(
      resetRoleSettingsSchema.safeParse({
        branchId,
        expectedUpdatedAt: null,
        userId: branchId,
      }).success,
    ).toBe(false);
  });
});

describe("role settings permission cells and normalization", () => {
  const operatorOnly: PermissionKey[] = [
    "booking.manage_all",
    "branch.announce",
    "space.manage",
    "plan.edit",
    "stats.view",
    "roles.manage",
  ];
  const teamScoped: PermissionKey[] = [
    "chat.team",
    "chat.team.moderate",
    "team.manage_members",
  ];
  const teamDefaults: Record<Role, PermissionKey[]> = {
    user: [],
    team_member: ["chat.team"],
    team_admin: ["chat.team.moderate", "team.manage_members"],
    operator: [],
  };

  it.each(
    roles.flatMap((role) => permissionKeys.map((key) => [role, key] as const)),
  )(
    "defines the documented %s / %s cell in both incoming states",
    (role, key) => {
      for (const checked of [false, true]) {
        const value = permissionCell(role, key, checked ? [key] : []);
        if (role === "operator" && key === "roles.manage") {
          expect(value).toEqual({
            checked: true,
            disabled: true,
            reason: "operator_required",
          });
        } else if (role !== "operator" && operatorOnly.includes(key)) {
          expect(value).toEqual({
            checked: false,
            disabled: true,
            reason: "operator_only",
          });
        } else if (teamScoped.includes(key)) {
          expect(value).toEqual({
            checked: teamDefaults[role].includes(key),
            disabled: true,
            reason: "team_scoped",
          });
        } else {
          expect(value).toEqual({ checked, disabled: false, reason: null });
        }
      }
    },
  );

  it("exports every specification label in stable permission and role order", () => {
    expect(Object.keys(permissionLabels)).toEqual(permissionKeys);
    expect(Object.keys(roleLabels)).toEqual(roles);
    expect(permissionLabels["space.manage"]).toBe("공간·점검 관리");
    expect(permissionLabels["branch.announce"]).toBe(
      "공지 보내기, 라운지·신고 관리",
    );
    expect(roleLabels.team_member).toBe("팀원");
  });

  it.each(roles)(
    "normalizes %s idempotently without retaining duplicate or unordered keys",
    (role) => {
      const input: RoleSettingInput = {
        role,
        permissions: [...permissionKeys].reverse().concat([...permissionKeys]),
        limits: role === "team_admin" ? {} : { maxMinutesPerDay: null },
      };
      const original = structuredClone(input);
      const normalized = normalizeRoleSetting(input);
      expect(normalizeRoleSetting(normalized)).toEqual(normalized);
      expect(normalized.permissions).toEqual(
        permissionKeys.filter((key) => {
          if (teamScoped.includes(key)) return teamDefaults[role].includes(key);
          return role === "operator" || !operatorOnly.includes(key);
        }),
      );
      expect(input).toEqual(original);
      expect(normalized.limits).toEqual(input.limits);
      expect(normalized.limits).not.toBe(input.limits);
    },
  );

  it("forces protected and team keys despite forged false cells", () => {
    expect(
      normalizeRoleSetting({ role: "operator", permissions: [], limits: {} })
        .permissions,
    ).toEqual(["roles.manage"]);
    expect(
      normalizeRoleSetting({
        role: "team_admin",
        permissions: ["branch.announce"],
        limits: {},
      }).permissions,
    ).toEqual(["chat.team.moderate", "team.manage_members"]);
    expect(
      normalizeRoleSetting({
        role: "user",
        permissions: ["branch.announce"],
        limits: {},
      }).permissions,
    ).toEqual([]);
  });

  it("compares permission sets independently of array order or repeated entries", () => {
    expect(
      permissionsEqual(
        ["booking.own", "floor.view"],
        ["floor.view", "booking.own"],
      ),
    ).toBe(true);
    expect(permissionsEqual(["floor.view", "floor.view"], ["floor.view"])).toBe(
      true,
    );
    expect(permissionsEqual(["floor.view"], ["booking.own"])).toBe(false);
    expect(permissionsEqual([], ["floor.view"])).toBe(false);
  });
});

describe("role editor partial limits and visible dirty cells", () => {
  it("resolves each missing key but preserves explicit null and existing reader semantics", () => {
    expect(
      effectiveRoleLimits("user", {
        maxMinutesPerBooking: 60,
        maxMinutesPerDay: null,
      }),
    ).toEqual({
      maxMinutesPerBooking: 60,
      maxMinutesPerDay: null,
      maxDaysAhead: 7,
    });
    expect(effectiveRoleLimits("team_member", {})).toEqual(
      defaultLimits.team_member,
    );
    expect(effectiveRoleLimits("operator", { maxMinutesPerDay: 60 })).toEqual({
      maxMinutesPerBooking: null,
      maxMinutesPerDay: 60,
      maxDaysAhead: null,
    });
    expect(effectiveRoleLimits("team_admin", {})).toEqual({});
    expect(resolveBookingLimits("user", { maxDaysAhead: 0 }).maxDaysAhead).toBe(
      0,
    );
  });

  it("does not count array reordering, inherited defaults or protected cells as edits", () => {
    const original = before();
    const draft = before();
    for (const role of roles) draft[role].permissions.reverse();
    draft.user.limits = { ...defaultLimits.user };
    draft.operator.limits = { ...defaultLimits.operator };
    draft.user.permissions.push("branch.announce", "chat.team");
    draft.operator.permissions = draft.operator.permissions.filter(
      (key) => key !== "roles.manage",
    );
    expect(countRoleSettingsChanges(original, draft)).toBe(0);
    expect(changedRoleSettings(original, draft)).toEqual([]);
  });

  it("counts individual editable permission and limit cells rather than changed roles", () => {
    const original = before();
    const draft = before();
    draft.user.permissions = draft.user.permissions.filter(
      (key) => key !== "floor.view",
    );
    draft.user.limits = { maxMinutesPerBooking: 60, maxDaysAhead: null };
    draft.operator.permissions = draft.operator.permissions.filter(
      (key) => key !== "space.manage",
    );
    draft.operator.limits = { maxMinutesPerDay: 480 };
    expect(countRoleSettingsChanges(original, draft)).toBe(5);
    expect(changedRoleSettings(original, draft)).toEqual([
      { role: "user", ...draft.user },
      { role: "operator", ...draft.operator },
    ]);
  });

  it("distinguishes inherited finite limits from explicit unlimited and allows exact undo", () => {
    const original = before();
    const draft = before();
    draft.user.limits.maxMinutesPerDay = null;
    expect(countRoleSettingsChanges(original, draft)).toBe(1);
    expect(changedRoleSettings(original, draft)[0]?.limits).toEqual({
      maxMinutesPerDay: null,
    });
    delete draft.user.limits.maxMinutesPerDay;
    expect(changedRoleSettings(original, draft)).toEqual([]);
    original.user.limits.maxMinutesPerDay = 60;
    expect(countRoleSettingsChanges(original, draft)).toBe(1);
  });

  it("patches only selected roles, replaces rather than merges limits, and returns independent values", () => {
    const original = before();
    original.user.limits = { maxMinutesPerBooking: 60, maxMinutesPerDay: null };
    original.team_member.permissions.push("branch.announce");
    const snapshot = structuredClone(original);
    const result = applyRoleSettingsChanges(original, [
      { ...setting(), limits: { maxDaysAhead: 14 } },
    ]);
    expect(result.user.limits).toEqual({ maxDaysAhead: 14 });
    expect(result.team_member).toEqual(original.team_member);
    expect(result.team_member.permissions).toContain("branch.announce");
    result.user.permissions.push("booking.team");
    result.team_member.limits.maxDaysAhead = 90;
    expect(original).toEqual(snapshot);
  });

  it("does not mutate code defaults through any returned value", () => {
    const permissions = structuredClone(defaultPermissions);
    const limits = structuredClone(defaultLimits);
    const values = before();
    for (const role of roles) {
      const normalized = normalizeRoleSetting({ role, ...values[role] });
      normalized.permissions.length = 0;
      normalized.limits.maxDaysAhead = 30;
      effectiveRoleLimits(role, values[role].limits).maxDaysAhead = 60;
    }
    expect(defaultPermissions).toEqual(permissions);
    expect(defaultLimits).toEqual(limits);
  });
});

describe("lost permissions use actual can unions at the target branch", () => {
  it("includes both operator-only and inherited user permission loss", () => {
    const original = before();
    const draft = before();
    draft.user.permissions = [];
    draft.operator.permissions = ["roles.manage"];
    expect(
      lostPermissions(
        original,
        applyRoleSettingsChanges(
          original,
          changedRoleSettings(original, draft),
        ),
        context,
      ),
    ).toEqual([
      "floor.view",
      "booking.own",
      "chat.lounge",
      "booking.manage_all",
      "branch.announce",
      "space.manage",
      "plan.edit",
      "stats.view",
    ]);
  });

  it("does not claim a lost permission still supplied by another held role", () => {
    const original = before();
    original.operator.permissions.push("floor.view", "booking.own");
    const draft = structuredClone(original);
    draft.user.permissions = ["chat.lounge"];
    expect(
      lostPermissions(
        original,
        applyRoleSettingsChanges(
          original,
          changedRoleSettings(original, draft),
        ),
        context,
      ),
    ).toEqual([]);
  });

  it("does not treat a team membership as held for a branch-only comparison", () => {
    const original = before();
    original.team_member.permissions.push("floor.view");
    const draft = structuredClone(original);
    draft.user.permissions = draft.user.permissions.filter(
      (key) => key !== "floor.view",
    );
    expect(
      lostPermissions(
        original,
        applyRoleSettingsChanges(
          original,
          changedRoleSettings(original, draft),
        ),
        context,
      ),
    ).toEqual(["floor.view"]);
    const teamDraft = structuredClone(original);
    teamDraft.team_member.permissions = [];
    expect(lostPermissions(original, teamDraft, context)).toEqual([]);
  });

  it("never loses operator roles.manage, including an old stored empty permissions row", () => {
    const original = before();
    const draft = before();
    original.operator.permissions = [];
    draft.operator.permissions = [];
    expect(lostPermissions(original, draft, context)).toEqual([]);
    expect(lostPermissions(before(), draft, context)).not.toContain(
      "roles.manage",
    );
  });

  it("does not normalize the raw before snapshot and miss legacy granted permission loss", () => {
    const original = before();
    original.user.permissions.push("branch.announce");
    original.operator.permissions = original.operator.permissions.filter(
      (key) => key !== "branch.announce",
    );
    const draft = structuredClone(original);
    draft.user.permissions = draft.user.permissions.filter(
      (key) => key !== "floor.view",
    );
    const patches = changedRoleSettings(original, draft);
    expect(patches).toHaveLength(1);
    expect(patches[0]?.permissions).not.toContain("branch.announce");
    expect(
      lostPermissions(
        original,
        applyRoleSettingsChanges(original, patches),
        context,
      ),
    ).toEqual(["floor.view", "branch.announce"]);
    expect(original.user.permissions).toContain("branch.announce");
  });

  it("does not normalize untouched legacy roles or invent a loss not performed by the save", () => {
    const original = before();
    original.user.permissions.push("branch.announce");
    original.operator.permissions = original.operator.permissions.filter(
      (key) => key !== "branch.announce",
    );
    const draft = structuredClone(original);
    draft.operator.permissions = draft.operator.permissions.filter(
      (key) => key !== "stats.view",
    );
    const patches = changedRoleSettings(original, draft);
    expect(patches.map(({ role }) => role)).toEqual(["operator"]);
    expect(
      lostPermissions(
        original,
        applyRoleSettingsChanges(original, patches),
        context,
      ),
    ).toEqual(["stats.view"]);
  });

  it("uses actual role membership, returns stable key order and leaves both arguments unchanged", () => {
    const original = before();
    const draft = before();
    draft.user.permissions = [];
    draft.operator.permissions = [];
    const snapshot = structuredClone({ original, draft });
    expect(
      lostPermissions(original, draft, { branchId, isOperator: false }),
    ).toEqual(["floor.view", "booking.own", "chat.lounge"]);
    expect({ original, draft }).toEqual(snapshot);
    expect(lostPermissions(original, original, context)).toEqual([]);
  });
});

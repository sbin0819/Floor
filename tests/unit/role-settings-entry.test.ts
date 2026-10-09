import { beforeEach, expect, it, vi } from "vitest";
import {
  resetRoleSettings,
  updateRoleSettings,
} from "@/features/admin/role-settings-actions";
import { getRoleSettingsEditor } from "@/features/admin/queries";
import { createRoleSettingsActions } from "@/features/admin/role-settings-action-factory";
import { createRoleSettingsQueries } from "@/features/admin/role-settings-query-factory";

const calls = vi.hoisted(() => ({
  resetRoleSettings: vi.fn(),
  updateRoleSettings: vi.fn(),
  getRoleSettingsEditor: vi.fn(),
}));
vi.mock("@/features/admin/role-settings-action-factory", () => ({
  createRoleSettingsActions: vi.fn(() => calls),
}));
vi.mock("@/features/admin/role-settings-query-factory", () => ({
  createRoleSettingsQueries: vi.fn(() => calls),
}));
beforeEach(() => vi.clearAllMocks());
it.each([
  ["updateRoleSettings", updateRoleSettings],
  ["resetRoleSettings", resetRoleSettings],
] as const)(
  "%s forwards only untrusted input through the authenticated action factory",
  async (name, action) => {
    const input = { branchId: "untrusted", userId: "untrusted" };
    const result = { ok: false, code: "STALE" };
    calls[name].mockResolvedValue(result);
    expect(await action(input)).toEqual(result);
    expect(createRoleSettingsActions).toHaveBeenCalledExactlyOnceWith();
    expect(calls[name]).toHaveBeenCalledExactlyOnceWith(input);
  },
);
it("the server query entry delegates its branch to the guarded query factory", async () => {
  const result = { updatedAt: null };
  calls.getRoleSettingsEditor.mockResolvedValue(result);
  expect(await getRoleSettingsEditor("branch")).toEqual(result);
  expect(createRoleSettingsQueries).toHaveBeenCalledExactlyOnceWith();
  expect(calls.getRoleSettingsEditor).toHaveBeenCalledExactlyOnceWith("branch");
});

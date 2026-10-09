import { beforeEach, expect, it, vi } from "vitest";
import {
  createMaintenance,
  updateMaintenance,
  endMaintenance,
  deleteMaintenance,
} from "@/features/admin/maintenance-actions";
import { createMaintenanceActionFactory } from "@/features/admin/maintenance-action-factory";

const factory = vi.hoisted(() => ({
  createMaintenance: vi.fn(),
  updateMaintenance: vi.fn(),
  endMaintenance: vi.fn(),
  deleteMaintenance: vi.fn(),
}));
vi.mock("@/features/admin/maintenance-action-factory", () => ({
  createMaintenanceActionFactory: vi.fn(() => factory),
}));
beforeEach(() => vi.clearAllMocks());
it.each([
  ["createMaintenance", createMaintenance],
  ["updateMaintenance", updateMaintenance],
  ["endMaintenance", endMaintenance],
  ["deleteMaintenance", deleteMaintenance],
] as const)(
  "%s passes only the untrusted argument through the guarded factory",
  async (name, action) => {
    const input = { blockId: "untrusted", userId: "untrusted" };
    const result = { ok: false, code: "STALE" };
    factory[name].mockResolvedValue(result);
    expect(await action(input)).toEqual(result);
    expect(createMaintenanceActionFactory).toHaveBeenCalledExactlyOnceWith();
    expect(factory[name]).toHaveBeenCalledExactlyOnceWith(input);
  },
);

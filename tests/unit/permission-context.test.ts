import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadPermissionContext } from "@/lib/permissions/context";

const mocks = vi.hoisted(() => ({
  getMemberships: vi.fn(),
  getRoleSettings: vi.fn(),
}));
vi.mock("@/lib/dal", () => mocks);

const session = {
  userId: crypto.randomUUID(),
  name: "멤버",
  email: "member@example.test",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getMemberships.mockResolvedValue({
    teams: [{ teamId: "team-a", role: "admin" }],
    staffBranchIds: ["branch-a"],
  });
  mocks.getRoleSettings.mockResolvedValue({
    user: { permissions: ["floor.view"], limits: { maxDaysAhead: 3 } },
    operator: { permissions: [], limits: {} },
  });
});

describe("loadPermissionContext", () => {
  it("loads memberships using the server session and settings for the requested branch", async () => {
    await expect(loadPermissionContext(session, "branch-a")).resolves.toEqual({
      userId: session.userId,
      teams: [{ teamId: "team-a", role: "admin" }],
      staffBranchIds: ["branch-a"],
      roleSettings: { "branch-a": { user: ["floor.view"], operator: [] } },
    });
    expect(mocks.getMemberships).toHaveBeenCalledExactlyOnceWith(
      session.userId,
      undefined,
    );
    expect(mocks.getRoleSettings).toHaveBeenCalledExactlyOnceWith(
      "branch-a",
      undefined,
    );
  });

  it("uses defaults for branch-independent operations without querying branch settings", async () => {
    expect((await loadPermissionContext(session)).roleSettings).toEqual({});
    expect(mocks.getRoleSettings).not.toHaveBeenCalled();
  });

  it("leaves absent roles absent so can() can apply per-role defaults", async () => {
    mocks.getRoleSettings.mockResolvedValue({});
    expect(
      (await loadPermissionContext(session, "branch-a")).roleSettings,
    ).toEqual({ "branch-a": {} });
  });
});

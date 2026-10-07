import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadPermissionContext,
  loadPermissionData,
} from "@/lib/permissions/context";

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

  it("reads again with equal results outside a React server render", async () => {
    const first = await loadPermissionContext(session, "branch-a");
    expect(await loadPermissionContext({ ...session }, "branch-a")).toEqual(
      first,
    );
    expect(mocks.getMemberships).toHaveBeenCalledTimes(2);
    expect(mocks.getRoleSettings).toHaveBeenCalledTimes(2);
  });

  it("returns the already-read role limits alongside the unchanged context", async () => {
    const data = await loadPermissionData(session, "branch-a");
    expect(data.context).toEqual({
      userId: session.userId,
      teams: [{ teamId: "team-a", role: "admin" }],
      staffBranchIds: ["branch-a"],
      roleSettings: { "branch-a": { user: ["floor.view"], operator: [] } },
    });
    expect(data.settings).toEqual({
      user: { permissions: ["floor.view"], limits: { maxDaysAhead: 3 } },
      operator: { permissions: [], limits: {} },
    });
    expect(mocks.getMemberships).toHaveBeenCalledTimes(1);
    expect(mocks.getRoleSettings).toHaveBeenCalledTimes(1);
  });

  it("returns no settings for branch-independent permission data", async () => {
    expect((await loadPermissionData(session)).settings).toEqual({});
    expect(mocks.getRoleSettings).not.toHaveBeenCalled();
  });

  it("can retry a failed read outside a React server render", async () => {
    const error = new Error("membership unavailable");
    mocks.getMemberships.mockRejectedValueOnce(error);
    await expect(loadPermissionContext(session, "branch-a")).rejects.toBe(
      error,
    );
    await expect(
      loadPermissionContext(session, "branch-a"),
    ).resolves.toMatchObject({ userId: session.userId });
    expect(mocks.getMemberships).toHaveBeenCalledTimes(2);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAccountMenuData } from "@/features/auth/queries";
import { ActionError } from "@/lib/actions/result";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getOperatorBranches: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/dal", () => ({
  getOperatorBranches: mocks.getOperatorBranches,
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireSession.mockResolvedValue({
    userId: "member",
    name: "회원",
    email: "member@example.test",
  });
  mocks.getOperatorBranches.mockResolvedValue([]);
});

describe("account menu server data", () => {
  it("checks the session independently before querying staff membership", async () => {
    mocks.requireSession.mockRejectedValue(new ActionError("UNAUTHENTICATED"));
    await expect(getAccountMenuData()).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(mocks.getOperatorBranches).not.toHaveBeenCalled();
  });

  it("returns only the profile and derived operator boolean", async () => {
    expect(await getAccountMenuData()).toEqual({
      name: "회원",
      email: "member@example.test",
      isOperator: false,
    });
    expect(mocks.getOperatorBranches).toHaveBeenCalledExactlyOnceWith("member");
  });

  it("does not expose operator branch rows", async () => {
    mocks.getOperatorBranches.mockResolvedValue([
      { id: "branch-secret-id", name: "가상 지점" },
    ]);
    expect(await getAccountMenuData()).toEqual({
      name: "회원",
      email: "member@example.test",
      isOperator: true,
    });
  });

  it("lets membership failures reach the error boundary instead of hiding them", async () => {
    const failure = new Error("membership failed");
    mocks.getOperatorBranches.mockRejectedValue(failure);
    await expect(getAccountMenuData()).rejects.toBe(failure);
  });
});

import { beforeEach, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/actions/result";
import { getOperatorHome } from "@/features/admin/queries";
import { requireSession } from "@/lib/auth/session";
import { getOperatorBranches } from "@/lib/dal";

vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/dal", () => ({ getOperatorBranches: vi.fn() }));
const session = {
  userId: "operator",
  email: "operator@example.test",
  name: "운영자",
};
beforeEach(() => vi.clearAllMocks());
it("rejects anonymous queries before touching branch data", async () => {
  vi.mocked(requireSession).mockRejectedValue(
    new ActionError("UNAUTHENTICATED"),
  );
  await expect(getOperatorHome()).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
  expect(getOperatorBranches).not.toHaveBeenCalled();
});
it("rejects members without an operator membership", async () => {
  vi.mocked(requireSession).mockResolvedValue(session);
  vi.mocked(getOperatorBranches).mockResolvedValue([]);
  await expect(getOperatorHome()).rejects.toMatchObject({ code: "FORBIDDEN" });
});
it("loads only the current operator's assigned branches", async () => {
  vi.mocked(requireSession).mockResolvedValue(session);
  vi.mocked(getOperatorBranches).mockResolvedValue([
    { id: "branch", name: "가상점" },
  ]);
  await expect(getOperatorHome()).resolves.toEqual({
    session,
    branches: [{ id: "branch", name: "가상점" }],
  });
  expect(getOperatorBranches).toHaveBeenCalledWith("operator");
});

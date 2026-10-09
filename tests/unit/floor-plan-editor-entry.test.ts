import { beforeEach, expect, it, vi } from "vitest";
import { saveFloorPlanDraft } from "@/features/floor-plan/actions";
import { getPlanEditor } from "@/features/floor-plan/queries";
import { getAdminPlans } from "@/features/admin/queries";
import { createPlanEditorActions } from "@/features/floor-plan/editor-action-factory";
import { createPlanEditorQueries } from "@/features/floor-plan/editor-query-factory";

const calls = vi.hoisted(() => ({
  saveFloorPlanDraft: vi.fn(),
  getPlanEditor: vi.fn(),
  getAdminPlans: vi.fn(),
}));
vi.mock("@/features/floor-plan/editor-action-factory", () => ({
  createPlanEditorActions: vi.fn(() => calls),
}));
vi.mock("@/features/floor-plan/editor-query-factory", () => ({
  createPlanEditorQueries: vi.fn(() => calls),
}));
beforeEach(() => vi.clearAllMocks());

it("forwards only untrusted draft input through the authenticated action factory", async () => {
  const input = { floorId: "untrusted", userId: "untrusted", document: null };
  const result = { ok: false, code: "STALE" };
  calls.saveFloorPlanDraft.mockResolvedValue(result);
  expect(await saveFloorPlanDraft(input)).toEqual(result);
  expect(createPlanEditorActions).toHaveBeenCalledExactlyOnceWith();
  expect(calls.saveFloorPlanDraft).toHaveBeenCalledExactlyOnceWith(input);
});

it("passes both primitive route identifiers to the guarded editor query", async () => {
  const result = { draft: null, published: null };
  calls.getPlanEditor.mockResolvedValue(result);
  expect(await getPlanEditor({ branchId: "branch", floorId: "floor" })).toEqual(
    result,
  );
  expect(createPlanEditorQueries).toHaveBeenCalledExactlyOnceWith();
  expect(calls.getPlanEditor).toHaveBeenCalledExactlyOnceWith({
    branchId: "branch",
    floorId: "floor",
  });
});

it("passes the branch identifier to the guarded plan list query", async () => {
  const result = { floors: [] };
  calls.getAdminPlans.mockResolvedValue(result);
  expect(await getAdminPlans("branch")).toEqual(result);
  expect(createPlanEditorQueries).toHaveBeenCalledExactlyOnceWith();
  expect(calls.getAdminPlans).toHaveBeenCalledExactlyOnceWith("branch");
});

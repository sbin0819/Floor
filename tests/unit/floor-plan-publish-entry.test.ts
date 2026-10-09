import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  publishFloorPlan,
  restorePlanVersion,
} from "@/features/floor-plan/actions";
import {
  getPlanVersions,
  previewPublishFloorPlan,
} from "@/features/floor-plan/queries";
import { createAction } from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import {
  publishFloorPlanSchema,
  previewPublishFloorPlanSchema,
  restorePlanVersionSchema,
} from "@/features/floor-plan/publish-schema";

const calls = vi.hoisted(() => ({
  publishFloorPlan: vi.fn(),
  restorePlanVersion: vi.fn(),
  previewPublishFloorPlan: vi.fn(),
  getPlanVersions: vi.fn(),
}));
vi.mock("@/features/floor-plan/publish-action-factory", () => ({
  createPlanPublishActions: () => calls,
}));
vi.mock("@/features/floor-plan/publish-query-factory", () => ({
  createPlanPublishQueries: () => calls,
}));
beforeEach(() => vi.clearAllMocks());
const floorId = "A9000000-0000-4000-8000-000000000001";
const branchId = "A9000000-0000-4000-8000-000000000002";
const expectedDraftId = "A9000000-0000-4000-8000-000000000003";

it("forwards write input unchanged through each action factory", async () => {
  const input = { untrusted: true };
  const result = { ok: false, code: "STALE" };
  calls.publishFloorPlan.mockResolvedValue(result);
  calls.restorePlanVersion.mockResolvedValue(result);
  expect(await publishFloorPlan(input)).toBe(result);
  expect(calls.publishFloorPlan).toHaveBeenCalledExactlyOnceWith(input);
  expect(await restorePlanVersion(input)).toBe(result);
  expect(calls.restorePlanVersion).toHaveBeenCalledExactlyOnceWith(input);
});
it("keeps preview and version reads on query exports with primitive cache keys", async () => {
  const input = { floorId, branchId, expectedDraftId, revision: 1 };
  calls.previewPublishFloorPlan.mockResolvedValue({ ok: false, code: "STALE" });
  calls.getPlanVersions.mockResolvedValue([]);
  expect(await previewPublishFloorPlan(input)).toEqual({
    ok: false,
    code: "STALE",
  });
  expect(calls.previewPublishFloorPlan).toHaveBeenCalledExactlyOnceWith(input);
  expect(await getPlanVersions({ floorId, branchId })).toEqual([]);
  expect(calls.getPlanVersions).toHaveBeenCalledExactlyOnceWith({
    floorId,
    branchId,
  });
});
describe("publication input contracts", () => {
  it("normalizes IDs and rejects missing generation keys or extra client authority", () => {
    expect(
      publishFloorPlanSchema.parse({ floorId, expectedDraftId, revision: 1 }),
    ).toEqual({
      floorId: floorId.toLowerCase(),
      expectedDraftId: expectedDraftId.toLowerCase(),
      revision: 1,
    });
    expect(
      publishFloorPlanSchema.safeParse({ floorId, revision: 1 }).success,
    ).toBe(false);
    expect(
      publishFloorPlanSchema.safeParse({
        floorId,
        expectedDraftId,
        revision: 1,
        userId: floorId,
      }).success,
    ).toBe(false);
    expect(
      previewPublishFloorPlanSchema.safeParse({
        floorId,
        expectedDraftId,
        revision: 1,
      }).success,
    ).toBe(false);
  });
  it.each([-1, 0.5, NaN, Infinity, 2147483647])(
    "rejects invalid revision %s",
    (revision) => {
      expect(
        publishFloorPlanSchema.safeParse({ floorId, expectedDraftId, revision })
          .success,
      ).toBe(false);
    },
  );
  it.each([
    [null, 1],
    [expectedDraftId, null],
  ])(
    "requires consistent restoration draft identity and revision",
    (id, revision) => {
      expect(
        restorePlanVersionSchema.safeParse({
          floorId,
          version: 1,
          expectedDraftId: id,
          revision,
          basePlanId: null,
        }).success,
      ).toBe(false);
    },
  );
  it("allows a no-draft restore only with explicit nullable generation fields", () => {
    expect(
      restorePlanVersionSchema.safeParse({
        floorId,
        version: 1,
        expectedDraftId: null,
        revision: null,
        basePlanId: null,
      }).success,
    ).toBe(true);
    expect(
      restorePlanVersionSchema.safeParse({ floorId, version: 1 }).success,
    ).toBe(false);
  });
});
describe("PLAN_INVALID wrapper issues", () => {
  const issues = [
    {
      code: "SEAT_LABEL_DUPLICATE" as const,
      shapeId: "seat-a",
      message: "좌석 이름이 겹쳐요.",
    },
  ];
  const dependencies = {
    getSession: async () => ({
      userId: floorId,
      name: "운영자",
      email: "fake@example.test",
    }),
    logError: vi.fn(),
  };
  it("passes only PLAN_INVALID structured issues and never raw error text", async () => {
    const action = createAction(
      {
        input: z.strictObject({}),
        authorize: "none",
        handler: () => {
          throw new ActionError("PLAN_INVALID", {
            issues,
            fieldErrors: { secret: ["hidden"] },
          });
        },
      },
      dependencies,
    );
    expect(await action({})).toEqual({
      ok: false,
      code: "PLAN_INVALID",
      issues,
    });
  });
  it.each(["FORBIDDEN", "STALE", "INVALID_INPUT"] as const)(
    "does not leak issues on %s",
    async (code) => {
      const action = createAction(
        {
          input: z.strictObject({}),
          authorize: "none",
          handler: () => {
            throw new ActionError(code, { issues });
          },
        },
        dependencies,
      );
      expect(await action({})).toEqual({ ok: false, code });
    },
  );
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GET } from "@/app/api/plan-backgrounds/[planId]/route";
import {
  createPlanBackgroundUpload,
  confirmPlanBackgroundUpload,
} from "@/features/floor-plan/actions";
import { getPlanBackground } from "@/features/floor-plan/queries";
import {
  confirmPlanBackgroundUploadSchema,
  createPlanBackgroundUploadSchema,
} from "@/features/floor-plan/background-schema";
import { createAction } from "@/lib/actions/create-action";
import { ActionError, type ActionErrorCode } from "@/lib/actions/result";

const calls = vi.hoisted(() => ({
  connection: vi.fn(),
  createPlanBackgroundUpload: vi.fn(),
  confirmPlanBackgroundUpload: vi.fn(),
  getPlanBackground: vi.fn(),
}));
vi.mock("next/server", () => ({ connection: calls.connection }));
vi.mock("@/features/floor-plan/background-action-factory", () => ({
  createPlanBackgroundActions: () => calls,
}));
vi.mock("@/features/floor-plan/background-query-factory", () => ({
  createPlanBackgroundQueries: () => calls,
}));
const floorId = "A9000000-0000-4000-8000-000000000001";
const expectedDraftId = "A9000000-0000-4000-8000-000000000002";
beforeEach(() => vi.resetAllMocks());

it("keeps the two public upload entries async and forwards only the original input", async () => {
  const input = { untrusted: true };
  const result = { ok: false, code: "STALE" };
  calls.createPlanBackgroundUpload.mockResolvedValue(result);
  calls.confirmPlanBackgroundUpload.mockResolvedValue(result);
  expect(await createPlanBackgroundUpload(input)).toBe(result);
  expect(await confirmPlanBackgroundUpload(input)).toBe(result);
  expect(calls.createPlanBackgroundUpload).toHaveBeenCalledExactlyOnceWith(
    input,
  );
  expect(calls.confirmPlanBackgroundUpload).toHaveBeenCalledExactlyOnceWith(
    input,
  );
});
it("awaits connection and asynchronous params before the single query delegation", async () => {
  let connected: (() => void) | undefined;
  calls.connection.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        connected = resolve;
      }),
  );
  const response = new Response("image", {
    headers: { "Cache-Control": "private, no-store" },
  });
  calls.getPlanBackground.mockResolvedValue(response);
  const result = GET(
    new Request("https://floor.test/api/plan-backgrounds/example"),
    { params: Promise.resolve({ planId: expectedDraftId }) },
  );
  expect(calls.getPlanBackground).not.toHaveBeenCalled();
  connected?.();
  expect(await result).toBe(response);
  expect(calls.getPlanBackground).toHaveBeenCalledExactlyOnceWith(
    expectedDraftId,
  );
});
it("never memoizes a consumable background Response stream", async () => {
  calls.getPlanBackground.mockImplementation(async () => new Response("image"));
  const first = await getPlanBackground(expectedDraftId);
  const second = await getPlanBackground(expectedDraftId);
  expect(first).not.toBe(second);
  expect(await first.text()).toBe("image");
  expect(await second.text()).toBe("image");
  expect(calls.getPlanBackground).toHaveBeenCalledTimes(2);
});
describe("background input and disabled error contracts", () => {
  it("normalizes UUIDs and requires the explicit draft generation", () => {
    expect(
      createPlanBackgroundUploadSchema.parse({
        floorId,
        expectedDraftId,
        size: 1,
      }),
    ).toEqual({
      floorId: floorId.toLowerCase(),
      expectedDraftId: expectedDraftId.toLowerCase(),
      size: 1,
    });
    expect(
      createPlanBackgroundUploadSchema.safeParse({ floorId, size: 1 }).success,
    ).toBe(false);
    expect(
      createPlanBackgroundUploadSchema.safeParse({
        floorId,
        expectedDraftId,
        size: 3 * 1024 * 1024,
      }).success,
    ).toBe(true);
    expect(
      confirmPlanBackgroundUploadSchema.parse({
        floorId,
        uploadId: expectedDraftId,
      }),
    ).toEqual({
      floorId: floorId.toLowerCase(),
      uploadId: expectedDraftId.toLowerCase(),
    });
  });
  it.each(["key", "url", "userId", "contentType", "revision"])(
    "rejects unexpected %s instead of treating it as authority",
    (key) => {
      expect(
        createPlanBackgroundUploadSchema.safeParse({
          floorId,
          expectedDraftId,
          size: 1,
          [key]: "forged",
        }).success,
      ).toBe(false);
      expect(
        confirmPlanBackgroundUploadSchema.safeParse({
          floorId,
          uploadId: expectedDraftId,
          [key]: "forged",
        }).success,
      ).toBe(false);
    },
  );
  it.each<ActionErrorCode>([
    "FORBIDDEN",
    "INVALID_INPUT",
    "NOT_FOUND",
    "STALE",
    "LIMIT_EXCEEDED",
  ])("exposes files_disabled only for FORBIDDEN, not %s", async (code) => {
    const action = createAction(
      {
        input: z.strictObject({}),
        authorize: "none",
        handler: () => {
          throw new ActionError(code, { message: "files_disabled" });
        },
      },
      {
        getSession: async () => ({
          userId: floorId,
          name: "운영자",
          email: "fake@example.test",
        }),
      },
    );
    expect(await action({})).toEqual({
      ok: false,
      code,
      ...(code === "FORBIDDEN" ? { message: "files_disabled" } : {}),
    });
  });
});

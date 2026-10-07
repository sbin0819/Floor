import { describe, expect, it } from "vitest";
import { withAdminConstraintErrors } from "@/features/admin/action-factory";

describe("safe admin constraint classification", () => {
  it.each([
    ["floors_branch_id_level_unique", "level", "이미 있는 층이에요"],
    ["spaces_floor_name_unique", "name", "이 층에 같은 이름의 공간이 있어요"],
  ])(
    "classifies nested constraint %s without forwarding database text",
    async (constraint, field, message) => {
      const error = {
        message: "sensitive SQL parameters",
        cause: { cause: { code: "23505", constraint } },
      };
      await expect(
        withAdminConstraintErrors(async () => {
          throw error;
        }),
      ).rejects.toMatchObject({
        code: "INVALID_INPUT",
        details: { fieldErrors: { [field]: [message] } },
      });
    },
  );
  it("does not parse messages or misclassify unknown constraint violations", async () => {
    const error = {
      message: "spaces_floor_name_unique",
      cause: { code: "23505", constraint: "unrelated" },
    };
    await expect(
      withAdminConstraintErrors(async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });
  it("does not loop on a cyclic cause", async () => {
    const error: { cause?: unknown } = {};
    error.cause = error;
    await expect(
      withAdminConstraintErrors(async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });
});

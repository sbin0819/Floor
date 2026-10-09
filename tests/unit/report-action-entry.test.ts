import { beforeEach, expect, it, vi } from "vitest";
import { resolveReports } from "@/features/admin/report-actions";
import { createReportActions } from "@/features/admin/report-action-factory";

const calls = vi.hoisted(() => ({ resolveReports: vi.fn() }));
vi.mock("@/features/admin/report-action-factory", () => ({
  createReportActions: vi.fn(() => calls),
}));
beforeEach(() => vi.clearAllMocks());
it("forwards unknown input through the authenticated report factory", async () => {
  const input = { messageId: "untrusted", operatorId: "untrusted" };
  const result = { ok: false, code: "UNAUTHENTICATED" };
  calls.resolveReports.mockResolvedValue(result);
  expect(await resolveReports(input)).toEqual(result);
  expect(createReportActions).toHaveBeenCalledExactlyOnceWith();
  expect(calls.resolveReports).toHaveBeenCalledExactlyOnceWith(input);
});

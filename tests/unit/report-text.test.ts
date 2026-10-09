import { describe, expect, it } from "vitest";
import {
  reportBodyText,
  reportExcerpt,
  serializeReportSummary,
} from "@/features/admin/report-text";
import { getBranchReportsSchema } from "@/features/admin/reports-schema";

const known = "00000000-0000-4000-8000-000000000001";
const unknown = "00000000-0000-4000-8000-000000000002";
describe("privacy-safe report text", () => {
  it("replaces valid mention identifiers even inside code without changing markdown or line breaks", () => {
    expect(
      reportBodyText(`**<@${known}>**\n\`<@${unknown}>\` <@everyone>`, {
        [known]: "김하은",
      }),
    ).toBe("**@김하은**\n`@알 수 없는 사용자` @모두");
  });
  it("handles upper-case mention UUIDs and leaves ordinary user text alone", () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(
      reportBodyText(`<@${id.toUpperCase()}> email@example.test`, {
        [id]: "친구",
      }),
    ).toBe("@친구 email@example.test");
  });
  it("limits a plain excerpt to 40 Unicode characters without splitting emoji", () => {
    expect(reportExcerpt(`**${"😀".repeat(50)}**`, {})).toBe(
      `**${"😀".repeat(38)}`,
    );
    expect(reportExcerpt(`<@${known}>\n다음 줄`, { [known]: "김하은" })).toBe(
      "@김하은 다음 줄",
    );
  });
  it("normalizes nullable database summary timestamps", () => {
    expect(serializeReportSummary(null)).toBeNull();
    expect(serializeReportSummary({ count: 0, oldestAt: null })).toEqual({
      count: 0,
      oldestAt: null,
    });
    expect(
      serializeReportSummary({
        count: 2,
        oldestAt: "2026-10-07T12:00:00+09:00",
      }),
    ).toEqual({ count: 2, oldestAt: "2026-10-07T03:00:00.000Z" });
  });
  it("uses a strict normalized branch and two tabs only", () => {
    expect(getBranchReportsSchema.parse({ branchId: known })).toEqual({
      branchId: known,
      tab: "open",
    });
    for (const value of [
      { branchId: "bad" },
      { branchId: known, tab: "all" },
      { branchId: known, reporterId: known },
    ])
      expect(getBranchReportsSchema.safeParse(value).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  maintenanceCloseHref,
  maintenanceDraftWindow,
  maintenanceHref,
  maintenanceInitialDraft,
  maintenancePreviewHref,
  maintenancePreviewKey,
  maintenancePreviewRequest,
  maintenanceRoute,
} from "@/features/admin/maintenance-navigation";
import {
  maintenanceBranchId,
  maintenanceFixture,
  maintenanceRequest,
} from "@/tests/helpers/maintenance";

describe("maintenance URL and branch-local inputs", () => {
  it("supports create deep links and preserves only recognized nonsensitive values", () => {
    expect(maintenanceRoute({ create: "1" }).dialog).toBe("create");
    expect(maintenanceRoute({ dialog: ["create"], tab: "secret" })).toEqual({
      dialog: null,
      blockId: null,
      tab: "active",
    });
    expect(
      maintenanceHref(maintenanceBranchId, {
        dialog: "create",
        reason: "비공개 이유",
        title: "private",
      }),
    ).not.toContain("private");
    const href = maintenancePreviewHref(
      maintenanceBranchId,
      new URLSearchParams({ create: "1", reason: "비공개 이유", tab: "past" }),
      maintenanceRequest(),
    );
    expect(href).toContain("dialog=create");
    expect(href).not.toContain("reason");
    expect(href).toContain("tab=past");
    expect(
      maintenanceCloseHref(
        maintenanceBranchId,
        new URLSearchParams(href.split("?")[1]),
      ),
    ).toBe(`/admin/branches/${maintenanceBranchId}/maintenance?tab=past`);
  });
  it("parses complete windows and rejects array, malformed nonce and incomplete inputs", () => {
    const request = maintenanceRequest();
    const href = maintenancePreviewHref(
      maintenanceBranchId,
      new URLSearchParams(),
      request,
    );
    const search = Object.fromEntries(new URLSearchParams(href.split("?")[1]));
    expect(maintenancePreviewRequest(search)).toEqual(request);
    for (const invalid of [
      { ...search, space: [search.space!] },
      { ...search, start: "2026-no" },
      { ...search, preview: "../secret" },
      { ...search, end: undefined },
    ])
      expect(maintenancePreviewRequest(invalid)).toBeNull();
  });
  it("uses branch local time, not the test process timezone, and rounds the initial end forward", () => {
    const data = maintenanceFixture();
    const draft = maintenanceInitialDraft(
      data.now,
      data.branch.timezone,
      undefined,
      maintenanceRequest(),
    );
    expect(draft.end).toBe("2026-10-14T14:00");
    expect(maintenanceDraftWindow(draft, data.branch.timezone)).toEqual(
      maintenanceRequest().input,
    );
    expect(
      maintenanceInitialDraft("2026-10-14T14:59:00Z", "Asia/Seoul").end,
    ).toBe("2026-10-15T00:00");
  });
  it("rejects non-half-hour, reversed and missing local times instead of inventing a preview", () => {
    const draft = maintenanceInitialDraft(
      maintenanceFixture().now,
      "Asia/Seoul",
      undefined,
      maintenanceRequest(),
    );
    for (const change of [
      { end: "2026-10-14T14:15" },
      { spaceId: "" },
      { startKind: "at" as const, startAt: "2026-10-14T14:00" },
    ])
      expect(
        maintenanceDraftWindow({ ...draft, ...change }, "Asia/Seoul"),
      ).toBeNull();
    expect(
      maintenanceDraftWindow(
        {
          ...draft,
          startKind: "at",
          startAt: "2026-03-08T02:30",
          end: "2026-03-08T04:00",
        },
        "America/Los_Angeles",
      ),
    ).toBeNull();
  });
  it("keys now independently of browser clocks and ignores reasons", () => {
    const input = maintenanceRequest().input;
    expect(maintenancePreviewKey({ ...input })).toBe(
      maintenancePreviewKey(input),
    );
    expect(
      maintenancePreviewKey({
        ...input,
        start: { kind: "at", at: "2026-10-14T03:00:00.000Z" },
      }),
    ).not.toBe(maintenancePreviewKey(input));
  });
});

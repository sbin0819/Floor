import { describe, expect, it } from "vitest";
import { requestedDetail } from "@/features/bookings/floor-selection";
import { floorHref } from "@/features/bookings/format";

describe("floor detail location", () => {
  it.each([undefined, null, "", "0", "true", 1, ["1"], ["1", "1"]])(
    "ignores detail value %j",
    (value) => expect(requestedDetail(value)).toBe(false),
  );
  it("accepts only the single string 1", () => {
    expect(requestedDetail("1")).toBe(true);
  });
  it("keeps query order date, space, detail, view", () => {
    expect(
      floorHref("branch", "floor", "2026-10-08", "space", "timeline", true),
    ).toBe(
      "/branches/branch/floors/floor?date=2026-10-08&space=space&detail=1&view=timeline",
    );
  });
  it("drops detail without a space and preserves existing callers", () => {
    expect(
      floorHref("branch", "floor", undefined, undefined, "list", true),
    ).toBe("/branches/branch/floors/floor?view=list");
    expect(
      floorHref("branch", "floor", "2026-10-08", "space", "timeline"),
    ).toBe(
      "/branches/branch/floors/floor?date=2026-10-08&space=space&view=timeline",
    );
  });
});

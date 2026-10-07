import { describe, expect, it } from "vitest";
import { parseTimeRange, serializeTimeRange } from "@/lib/db/range";

describe("tstzrange conversion", () => {
  const range = {
    start: new Date("2026-10-07T10:00:00.000Z"),
    end: new Date("2026-10-07T11:00:00.000Z"),
  };

  it("serializes finite ranges with [) boundaries and round-trips UTC instants", () => {
    const serialized = serializeTimeRange(range);
    expect(serialized).toBe(
      '["2026-10-07T10:00:00.000Z","2026-10-07T11:00:00.000Z")',
    );
    expect(parseTimeRange(serialized)).toEqual(range);
  });

  it("reads PostgreSQL timestamp formatting with explicit offsets", () => {
    expect(
      parseTimeRange('["2026-10-07 19:00:00+09","2026-10-07 20:00:00+09")'),
    ).toEqual(range);
  });

  it.each([
    "empty",
    "(,)",
    "[,2026-10-07)",
    "[2026-10-07,infinity)",
    "[2026-10-07,2026-10-08]",
    "[invalid,invalid)",
    "[2026-10-08,2026-10-07)",
  ])("rejects invalid driver value %s", (value) => {
    expect(() => parseTimeRange(value)).toThrow();
  });

  it.each([
    { start: new Date("invalid"), end: range.end },
    { start: range.start, end: range.start },
    { start: range.end, end: range.start },
  ])("rejects invalid application range $start to $end", (value) => {
    expect(() => serializeTimeRange(value)).toThrow();
  });
});

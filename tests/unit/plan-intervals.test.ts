import { describe, expect, it } from "vitest";
import {
  buildAvailabilityIntervals,
  buildPlanIntervals,
  type AvailabilityInput,
} from "@/features/bookings/availability";

const input: AvailabilityInput = {
  window: {
    start: "2026-10-07T00:00:00.000Z",
    end: "2026-10-07T12:00:00.000Z",
  },
  userId: "me",
  teamIds: ["my-team"],
  bookings: [
    {
      start: new Date("2026-10-07T01:00Z"),
      end: new Date("2026-10-07T02:00Z"),
      userId: "me",
      teamId: null,
    },
    {
      start: new Date("2026-10-07T02:00Z"),
      end: new Date("2026-10-07T03:00Z"),
      userId: "other",
      teamId: "my-team",
    },
    {
      start: new Date("2026-10-07T04:00Z"),
      end: new Date("2026-10-07T05:00Z"),
      userId: "other",
      teamId: null,
    },
  ],
  blocks: [
    {
      start: new Date("2026-10-07T11:00Z"),
      end: new Date("2026-10-08T03:00Z"),
    },
  ],
};

describe("minimal unclipped floor-plan intervals", () => {
  it("preserves the original maintenance end without changing the clipped schedule", () => {
    expect(buildAvailabilityIntervals(input).at(-1)?.end).toBe(
      input.window?.end,
    );
    expect(buildPlanIntervals(input).at(-1)).toEqual({
      start: "2026-10-07T11:00:00.000Z",
      end: "2026-10-08T03:00:00.000Z",
      kind: "maintenance",
    });
  });
  it("merges adjacent own/team intervals and never returns user or team identity", () => {
    const intervals = buildPlanIntervals(input);
    expect(intervals[0]).toEqual({
      start: "2026-10-07T01:00:00.000Z",
      end: "2026-10-07T03:00:00.000Z",
      kind: "mine",
    });
    expect(intervals[1]?.kind).toBe("other");
    for (const interval of intervals)
      expect(Object.keys(interval).sort()).toEqual(["end", "kind", "start"]);
  });
  it("does not mutate inputs or require an operating window to describe source ranges", () => {
    const before = structuredClone(input);
    expect(buildPlanIntervals({ ...input, window: null })).toEqual(
      buildPlanIntervals(input),
    );
    expect(input).toEqual(before);
    expect(buildPlanIntervals({ ...input, bookings: [], blocks: [] })).toEqual(
      [],
    );
  });
});

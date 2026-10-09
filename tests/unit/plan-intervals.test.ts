import { describe, expect, it } from "vitest";
import {
  buildAvailabilityIntervals,
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

describe("shared minimal floor-plan intervals", () => {
  it("uses the existing operating-hours-clipped maintenance schedule", () => {
    expect(buildAvailabilityIntervals(input).at(-1)).toEqual({
      start: "2026-10-07T11:00:00.000Z",
      end: "2026-10-07T12:00:00.000Z",
      kind: "maintenance",
    });
  });
  it("merges adjacent own/team intervals and never returns user or team identity", () => {
    const intervals = buildAvailabilityIntervals(input);
    expect(intervals[0]).toEqual({
      start: "2026-10-07T01:00:00.000Z",
      end: "2026-10-07T03:00:00.000Z",
      kind: "mine",
    });
    expect(intervals[1]?.kind).toBe("other");
    for (const interval of intervals)
      expect(Object.keys(interval).sort()).toEqual(["end", "kind", "start"]);
  });
  it("does not mutate inputs or expose schedule intervals on closed days", () => {
    const before = structuredClone(input);
    expect(buildAvailabilityIntervals({ ...input, window: null })).toEqual([]);
    expect(input).toEqual(before);
    expect(
      buildAvailabilityIntervals({ ...input, bookings: [], blocks: [] }),
    ).toEqual([]);
  });
});

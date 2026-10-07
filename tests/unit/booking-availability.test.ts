import { describe, expect, it } from "vitest";
import {
  availabilityCurrentPosition,
  availabilityLabel,
  availabilityTicks,
  buildAvailabilityIntervals,
  getAvailabilitySummary,
  intervalPosition,
  type AvailabilityInput,
} from "@/features/bookings/availability";
import { getOperatingWindow } from "@/features/bookings/operating-state";
import { zonedDateTime } from "@/lib/time/zoned";

const date = "2026-10-07";
const timeZone = "Asia/Seoul";
const at = (time: string, day = date) => zonedDateTime(day, time, timeZone);
const range = (start: string, end: string) => ({
  start: at(start),
  end: at(end),
});
const booking = (
  start: string,
  end: string,
  userId = "other",
  teamId: string | null = null,
) => ({ ...range(start, end), userId, teamId });
const window = getOperatingWindow(date, timeZone, {
  wed: { open: "08:00", close: "22:00" },
})!;
const input = (
  overrides: Partial<AvailabilityInput> = {},
): AvailabilityInput => ({
  window,
  bookings: [],
  blocks: [],
  userId: "me",
  teamIds: ["my-team"],
  ...overrides,
});

describe("day availability intervals", () => {
  it("returns an empty day without reading a clock", () => {
    expect(buildAvailabilityIntervals(input())).toEqual([]);
    expect(availabilityLabel([], timeZone)).toBe("예약된 시간이 없어요");
  });

  it("classifies my bookings and my team's bookings without exposing identity or title", () => {
    const intervals = buildAvailabilityIntervals(
      input({
        bookings: [
          booking("10:00", "11:00"),
          booking("12:00", "13:00", "me"),
          booking("14:00", "15:00", "teammate", "my-team"),
          booking("16:00", "17:00", "other", "another-team"),
        ],
      }),
    );
    expect(intervals.map(({ kind }) => kind)).toEqual([
      "other",
      "mine",
      "mine",
      "other",
    ]);
    for (const interval of intervals)
      expect(Object.keys(interval).sort()).toEqual(["end", "kind", "start"]);
  });

  it("merges same-kind overlap and touching ranges but keeps gaps and different kinds", () => {
    const intervals = buildAvailabilityIntervals(
      input({
        bookings: [
          booking("12:00", "13:00"),
          booking("10:00", "11:00"),
          booking("10:30", "12:00"),
          booking("13:00", "14:00", "me"),
          booking("15:00", "16:00"),
        ],
      }),
    );
    expect(intervals).toEqual([
      {
        start: at("10:00").toISOString(),
        end: at("13:00").toISOString(),
        kind: "other",
      },
      {
        start: at("13:00").toISOString(),
        end: at("14:00").toISOString(),
        kind: "mine",
      },
      {
        start: at("15:00").toISOString(),
        end: at("16:00").toISOString(),
        kind: "other",
      },
    ]);
  });

  it("clips both ends, drops outside ranges, and retains overlapping maintenance as its own kind", () => {
    const intervals = buildAvailabilityIntervals(
      input({
        bookings: [
          booking("06:00", "08:00"),
          booking("07:00", "10:00"),
          booking("21:00", "23:00", "me"),
          booking("22:00", "24:00"),
        ],
        blocks: [range("09:00", "12:00"), range("11:00", "13:00")],
      }),
    );
    expect(intervals).toEqual([
      { start: window.start, end: at("10:00").toISOString(), kind: "other" },
      {
        start: at("09:00").toISOString(),
        end: at("13:00").toISOString(),
        kind: "maintenance",
      },
      { start: at("21:00").toISOString(), end: window.end, kind: "mine" },
    ]);
  });

  it("does not mutate source arrays or dates", () => {
    const source = input({
      bookings: [booking("12:00", "13:00"), booking("10:00", "12:00")],
      blocks: [range("15:00", "16:00")],
    });
    const before = JSON.stringify(source);
    buildAvailabilityIntervals(source);
    getAvailabilitySummary({ ...source, now: at("10:30") });
    expect(JSON.stringify(source)).toBe(before);
  });

  it("does not produce intervals on a closed day", () => {
    expect(
      buildAvailabilityIntervals(
        input({ window: null, blocks: [range("10:00", "12:00")] }),
      ),
    ).toEqual([]);
  });

  it("names all interval kinds and formats a midnight end as 24:00", () => {
    expect(
      availabilityLabel(
        [
          {
            start: at("10:00").toISOString(),
            end: at("11:30").toISOString(),
            kind: "other",
          },
          {
            start: at("13:00").toISOString(),
            end: at("14:00").toISOString(),
            kind: "mine",
          },
          {
            start: at("15:00").toISOString(),
            end: at("24:00").toISOString(),
            kind: "maintenance",
          },
        ],
        timeZone,
      ),
    ).toBe("예약 10:00–11:30, 내 예약 13:00–14:00, 점검 15:00–24:00");
  });
});

describe("current availability summary", () => {
  it("is free until closing on an empty day", () => {
    expect(getAvailabilitySummary({ ...input(), now: at("08:00") })).toEqual({
      status: "free",
      until: window.end,
    });
  });

  it.each(["07:59", "22:00", "23:00"])(
    "does not count %s as free outside operating hours",
    (time) => {
      expect(getAvailabilitySummary({ ...input(), now: at(time) })).toEqual({
        status: "outside_hours",
      });
    },
  );

  it("is outside hours on a closed day", () => {
    expect(
      getAvailabilitySummary({ ...input({ window: null }), now: at("12:00") }),
    ).toEqual({ status: "outside_hours" });
  });

  it("ends a free period at the earlier next booking or maintenance", () => {
    expect(
      getAvailabilitySummary({
        ...input({
          bookings: [booking("11:00", "12:00")],
          blocks: [range("10:00", "11:00")],
        }),
        now: at("09:00"),
      }),
    ).toEqual({ status: "free", until: at("10:00").toISOString() });
  });

  it("unions touching reservations of every owner and maintenance before reporting the next free instant", () => {
    expect(
      getAvailabilitySummary({
        ...input({
          bookings: [
            booking("10:00", "11:00"),
            booking("11:00", "12:00", "me"),
            booking("13:00", "14:00"),
          ],
          blocks: [range("12:00", "13:00")],
        }),
        now: at("10:30"),
      }),
    ).toEqual({ status: "busy", availableAt: at("14:00").toISOString() });
  });

  it("has no next free period when continuous occupancy reaches closing", () => {
    expect(
      getAvailabilitySummary({
        ...input({
          bookings: [booking("10:00", "11:00")],
          blocks: [range("11:00", "24:00")],
        }),
        now: at("10:30"),
      }),
    ).toEqual({ status: "busy", availableAt: null });
  });

  it.each([
    booking("10:00", "11:00", "me"),
    booking("10:00", "11:00", "teammate", "my-team"),
  ])("recognizes my own or team reservation", (row) => {
    expect(
      getAvailabilitySummary({
        ...input({ bookings: [row] }),
        now: at("10:30"),
      }),
    ).toEqual({ status: "mine", until: at("11:00").toISOString() });
  });

  it("prioritizes maintenance and keeps the original next-day end instead of the clipped bar end", () => {
    const source = input({
      bookings: [booking("10:00", "12:00", "me")],
      blocks: [{ start: at("09:00"), end: at("12:00", "2026-10-08") }],
    });
    expect(getAvailabilitySummary({ ...source, now: at("10:30") })).toEqual({
      status: "maintenance",
      until: at("12:00", "2026-10-08").toISOString(),
    });
    expect(
      buildAvailabilityIntervals(source).find(
        ({ kind }) => kind === "maintenance",
      )?.end,
    ).toBe(window.end);
  });

  it("preserves a multi-day maintenance range beginning yesterday", () => {
    expect(
      getAvailabilitySummary({
        ...input({
          blocks: [
            {
              start: at("20:00", "2026-10-06"),
              end: at("12:00", "2026-10-09"),
            },
          ],
        }),
        now: at("10:30"),
      }),
    ).toEqual({
      status: "maintenance",
      until: at("12:00", "2026-10-09").toISOString(),
    });
  });

  it("uses half-open boundaries without treating an ended booking as busy", () => {
    const source = input({ bookings: [booking("10:00", "11:00")] });
    expect(getAvailabilitySummary({ ...source, now: at("10:00") }).status).toBe(
      "busy",
    );
    expect(getAvailabilitySummary({ ...source, now: at("11:00") })).toEqual({
      status: "free",
      until: window.end,
    });
  });
});

describe("availability coordinates", () => {
  it("clips a segment and omits an interval that only touches the operating boundary", () => {
    const position = intervalPosition(
      { start: at("06:00").toISOString(), end: at("09:00").toISOString() },
      window,
    );
    expect(position?.left).toBe(0);
    expect(position?.width).toBeCloseTo(100 / 14);
    expect(
      intervalPosition(
        { start: window.end, end: at("24:00").toISOString() },
        window,
      ),
    ).toBeNull();
  });

  it.each([
    ["07:00", 0, null],
    ["08:00", 0, 0],
    ["15:00", 50, 50],
    ["22:00", 100, null],
    ["23:00", 100, null],
  ])(
    "clamps the past overlay but hides an out-of-hours line at %s",
    (time, pastWidth, line) => {
      expect(
        availabilityCurrentPosition(at(time as string).toISOString(), window),
      ).toEqual({ pastWidth, line });
    },
  );

  it("includes operating endpoints and local four-hour ticks", () => {
    expect(
      availabilityTicks(window, timeZone).map(({ label }) => label),
    ).toEqual(["08", "12", "16", "20", "22"]);
    const shorter = {
      start: at("09:30").toISOString(),
      end: at("13:30").toISOString(),
    };
    expect(
      availabilityTicks(shorter, timeZone).map(({ label }) => label),
    ).toEqual(["09:30", "12", "13:30"]);
  });

  it("uses actual elapsed time for repeated DST wall clocks", () => {
    const zone = "America/New_York";
    const repeated = getOperatingWindow("2026-11-01", zone, {
      sun: { open: "00:00", close: "04:00" },
    })!;
    const first = {
      start: "2026-11-01T05:00:00Z",
      end: "2026-11-01T05:30:00Z",
    };
    const second = {
      start: "2026-11-01T06:00:00Z",
      end: "2026-11-01T06:30:00Z",
    };
    expect(intervalPosition(first, repeated)).toEqual({ left: 20, width: 10 });
    expect(intervalPosition(second, repeated)).toEqual({ left: 40, width: 10 });
    expect(
      availabilityCurrentPosition("2026-11-01T06:30:00Z", repeated),
    ).toEqual({ pastWidth: 50, line: 50 });
  });

  it("keeps endpoint labels and actual geometry across a DST gap", () => {
    const gap = getOperatingWindow("2026-03-08", "America/New_York", {
      sun: { open: "00:00", close: "24:00" },
    })!;
    const ticks = availabilityTicks(gap, "America/New_York");
    expect(ticks.at(-1)).toMatchObject({ label: "24", position: 100 });
    expect(ticks.find(({ label }) => label === "04")?.position).toBeCloseTo(
      (3 / 23) * 100,
    );
  });
});

import { describe, expect, it } from "vitest";
import { amenityKeys, amenityLabels } from "@/lib/spaces/amenities";
import {
  dayOpenHoursSchema,
  dayKeys,
  getOpenHours,
  getOperatingDate,
  openHoursSchema,
} from "@/lib/time/open-hours";
import {
  addDays,
  isValidTimeZone,
  localDate,
  localTime,
  SLOT_MINUTES,
  timeToMinutes,
  weekday,
  zonedDateTime,
} from "@/lib/time/zoned";

describe("branch-local dates", () => {
  it.each([
    ["2026-10-07T14:59:59.999Z", "2026-10-07", "23:59"],
    ["2026-10-07T15:00:00.000Z", "2026-10-08", "00:00"],
  ])(
    "formats %s in Seoul independently of the host time zone",
    (instant, date, time) => {
      expect(localDate(new Date(instant), "Asia/Seoul")).toBe(date);
      expect(localTime(new Date(instant), "Asia/Seoul")).toBe(time);
    },
  );

  it.each([
    ["2026-12-31", 1, "2027-01-01"],
    ["2026-03-01", -1, "2026-02-28"],
    ["2024-02-28", 1, "2024-02-29"],
    ["2026-03-08", 1, "2026-03-09"],
  ])("adds calendar days to %s", (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected);
  });

  it("reports all weekdays without interpreting dates in the host zone", () => {
    for (let index = 0; index < dayKeys.length; index += 1)
      expect(weekday(addDays("2026-10-05", index))).toBe(dayKeys[index]);
  });

  it.each([
    "2026-02-29",
    "2026-13-01",
    "2026-00-01",
    "2026-10-00",
    "2026-1-01",
    "0000-01-01",
    "invalid",
  ])("rejects invalid calendar date %s", (date) =>
    expect(() => addDays(date, 0)).toThrow(RangeError),
  );

  it("rejects fractional offsets and invalid instants", () => {
    expect(() => addDays("2026-10-07", 0.5)).toThrow(RangeError);
    expect(() => localDate(new Date("invalid"), "Asia/Seoul")).toThrow(
      RangeError,
    );
  });
});

describe("zonedDateTime", () => {
  it("resolves Seoul midnight and 24:00 on the following day", () => {
    expect(
      zonedDateTime("2026-10-07", "00:00", "Asia/Seoul").toISOString(),
    ).toBe("2026-10-06T15:00:00.000Z");
    expect(
      zonedDateTime("2026-12-31", "24:00", "Asia/Seoul").toISOString(),
    ).toBe("2026-12-31T15:00:00.000Z");
  });

  it.each([
    ["2026-03-08", "2026-03-08T05:00:00.000Z", "2026-03-08T16:00:00.000Z", 23],
    ["2026-11-01", "2026-11-01T04:00:00.000Z", "2026-11-01T17:00:00.000Z", 25],
  ])(
    "resolves midnight and noon on DST transition day %s",
    (date, midnight, noon, hours) => {
      const start = zonedDateTime(date, "00:00", "America/New_York");
      const end = zonedDateTime(date, "24:00", "America/New_York");
      expect(start.toISOString()).toBe(midnight);
      expect(
        zonedDateTime(date, "12:00", "America/New_York").toISOString(),
      ).toBe(noon);
      expect((end.getTime() - start.getTime()) / 3_600_000).toBe(hours);
    },
  );

  it.each(["02:00", "02:30", "02:59"])(
    "moves nonexistent %s to the first instant after the gap",
    (time) => {
      expect(
        zonedDateTime("2026-03-08", time, "America/New_York").toISOString(),
      ).toBe("2026-03-08T07:00:00.000Z");
    },
  );

  it("chooses the earlier occurrence of a duplicated local time", () => {
    expect(
      zonedDateTime("2026-11-01", "01:30", "America/New_York").toISOString(),
    ).toBe("2026-11-01T05:30:00.000Z");
    expect(
      localTime(new Date("2026-11-01T06:30:00Z"), "America/New_York"),
    ).toBe("01:30");
  });

  it("handles a half-hour DST transition and a quarter-hour base offset", () => {
    const gap = zonedDateTime("2026-10-04", "02:15", "Australia/Lord_Howe");
    expect(gap.toISOString()).toBe("2026-10-03T15:30:00.000Z");
    expect(localTime(gap, "Australia/Lord_Howe")).toBe("02:30");
    expect(
      zonedDateTime("2026-10-07", "09:00", "Asia/Kathmandu").toISOString(),
    ).toBe("2026-10-07T03:15:00.000Z");
  });

  it.each(["UTC", "Asia/Seoul", "America/New_York"])(
    "accepts IANA zone %s",
    (zone) => {
      expect(isValidTimeZone(zone)).toBe(true);
    },
  );

  it.each(["", "not-a-zone", "+09:00"])(
    "rejects invalid IANA zone %s",
    (zone) => {
      expect(isValidTimeZone(zone)).toBe(false);
      expect(() => zonedDateTime("2026-10-07", "09:00", zone)).toThrow(
        RangeError,
      );
    },
  );

  it.each(["9:00", "24:30", "25:00", "09:60", "09:00:00", "-1:00"])(
    "rejects invalid local clock time %s",
    (time) => {
      expect(() => timeToMinutes(time)).toThrow(RangeError);
    },
  );
});

describe("operating hours", () => {
  it("uses the shared 30-minute slot size", () => {
    expect(SLOT_MINUTES).toBe(30);
    expect(timeToMinutes("24:00")).toBe(1_440);
  });

  it("preserves closed days, defaults missing days, and supports 24:00", () => {
    const hours = { wed: null, thu: { open: "00:00", close: "24:00" } };
    expect(openHoursSchema.parse(hours)).toEqual(hours);
    expect(getOpenHours(hours, "2026-10-07")).toBeNull();
    expect(getOpenHours(hours, "2026-10-08")).toEqual(hours.thu);
    expect(getOpenHours(hours, "2026-10-09")).toEqual({
      open: "09:00",
      close: "22:00",
    });
  });

  it.each([null, [], "invalid", { wed: { open: "09:00", close: "bad" } }])(
    "falls back for invalid stored value %j",
    (hours) => {
      expect(getOpenHours(hours, "2026-10-07")).toEqual({
        open: "09:00",
        close: "22:00",
      });
    },
  );

  it.each([
    { open: "09:15", close: "22:00" },
    { open: "09:00", close: "22:15" },
    { open: "22:00", close: "09:00" },
    { open: "09:00", close: "09:00" },
    { open: "24:00", close: "24:00" },
    { open: "09:00", close: "24:30" },
    { open: "09:00", close: "22:00", extra: true },
  ])("rejects invalid or unknown day fields %j", (hours) => {
    expect(dayOpenHoursSchema.safeParse(hours).success).toBe(false);
  });

  it("rejects unknown weekday keys", () => {
    expect(openHoursSchema.safeParse({ monday: null }).success).toBe(false);
  });

  it.each([
    ["2026-10-07T03:00:00Z", 0, "2026-10-07"],
    ["2026-10-10T03:00:00Z", 0, "2026-10-10"],
    ["2026-10-10T03:00:00Z", 1, "2026-10-12"],
    ["2026-10-11T03:00:00Z", 0, "2026-10-12"],
    ["2026-10-11T03:00:00Z", 1, "2026-10-13"],
  ])("counts operating days from %s by %i", (now, offset, expected) => {
    expect(
      getOperatingDate(new Date(now), "Asia/Seoul", { sun: null }, offset),
    ).toBe(expected);
  });

  it("skips both weekend days when the branch closes on both", () => {
    const hours = { sat: null, sun: null };
    expect(
      getOperatingDate(new Date("2026-10-10T03:00:00Z"), "Asia/Seoul", hours),
    ).toBe("2026-10-12");
    expect(
      getOperatingDate(
        new Date("2026-10-09T03:00:00Z"),
        "Asia/Seoul",
        hours,
        1,
      ),
    ).toBe("2026-10-12");
  });

  it("stops when every weekday is closed rather than looping indefinitely", () => {
    const closed = Object.fromEntries(dayKeys.map((day) => [day, null]));
    expect(() =>
      getOperatingDate(new Date("2026-10-07T03:00:00Z"), "Asia/Seoul", closed),
    ).toThrow("no operating days");
  });

  it.each([-1, 0.5, Infinity])(
    "rejects invalid operating day offset %s",
    (offset) => {
      expect(() =>
        getOperatingDate(
          new Date("2026-10-07T03:00:00Z"),
          "Asia/Seoul",
          {},
          offset,
        ),
      ).toThrow(RangeError);
    },
  );
});

describe("amenities", () => {
  it("provides exactly the six documented Korean labels", () => {
    expect(amenityKeys).toEqual([
      "monitor",
      "whiteboard",
      "video_conf",
      "projector",
      "phone",
      "power",
    ]);
    expect(amenityKeys.map((key) => amenityLabels[key])).toEqual([
      "모니터",
      "화이트보드",
      "화상회의",
      "프로젝터",
      "전화",
      "전원",
    ]);
  });
});

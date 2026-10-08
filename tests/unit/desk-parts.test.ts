import { describe, expect, it } from "vitest";
import {
  classifyDeskPart,
  createDeskParts,
  DESK_SPLIT,
  isDeskPartSelectable,
} from "@/features/bookings/desk-parts";
import { localDate, localTime } from "@/lib/time/zoned";

const options = {
  date: "2026-10-08",
  timeZone: "Asia/Seoul",
  openHours: {
    thu: { open: "08:00", close: "22:00" },
    sat: { open: "09:00", close: "18:00" },
    sun: null,
  },
};
describe("desk booking parts", () => {
  it("splits weekday and Saturday operating hours at the single 13:00 boundary", () => {
    expect(DESK_SPLIT).toBe("13:00");
    for (const [date, open, close] of [
      ["2026-10-08", "08:00", "22:00"],
      ["2026-10-10", "09:00", "18:00"],
    ]) {
      const parts = createDeskParts({ ...options, date: date! });
      expect(
        parts.map(({ part, start, end }) => [
          part,
          localTime(new Date(start), options.timeZone),
          localTime(new Date(end), options.timeZone),
        ]),
      ).toEqual([
        ["am", open, "13:00"],
        ["pm", "13:00", close],
        ["day", open, close],
      ]);
    }
  });
  it("has no parts on a closed day", () => {
    expect(createDeskParts({ ...options, date: "2026-10-11" })).toEqual([]);
  });
  it.each([
    ["14:00", "20:00", "pm"],
    ["08:00", "12:00", "am"],
    ["08:00", "13:00", "am"],
    ["13:00", "20:00", "pm"],
  ])("has only one part for %s–%s", (open, close, part) => {
    expect(
      createDeskParts({ ...options, openHours: { thu: { open, close } } }).map(
        (range) => range.part,
      ),
    ).toEqual([part]);
  });
  it("resolves 24:00 to the next local midnight", () => {
    const parts = createDeskParts({
      ...options,
      openHours: { thu: { open: "08:00", close: "24:00" } },
    });
    expect(parts.at(-1)?.end).toBe("2026-10-08T15:00:00.000Z");
    expect(localDate(new Date(parts.at(-1)!.end), options.timeZone)).toBe(
      "2026-10-09",
    );
  });
  it.each([
    ["12:59", true, true],
    ["13:00", false, false],
    ["13:01", false, false],
  ])("selection at %s uses exact end boundaries", (time, am, day) => {
    const parts = createDeskParts(options);
    const now = new Date(`2026-10-08T${time}:00+09:00`);
    expect(isDeskPartSelectable("am", parts, now)).toBe(am);
    expect(isDeskPartSelectable("day", parts, now)).toBe(day);
    expect(isDeskPartSelectable("pm", parts, now)).toBe(true);
  });
  it("allows an already started part but not an ended or absent part", () => {
    const parts = createDeskParts(options);
    expect(
      isDeskPartSelectable("am", parts, new Date("2026-10-08T11:00:00+09:00")),
    ).toBe(true);
    expect(
      isDeskPartSelectable("pm", parts, new Date("2026-10-08T22:00:00+09:00")),
    ).toBe(false);
    expect(
      isDeskPartSelectable("day", [], new Date("2026-10-08T11:00:00+09:00")),
    ).toBe(false);
  });
  it.each([
    ["2026-03-08", 12],
    ["2026-11-01", 14],
  ])("uses actual timestamps across DST on %s", (date, hours) => {
    const parts = createDeskParts({
      date,
      timeZone: "America/Los_Angeles",
      openHours: { sun: { open: "00:00", close: "18:00" } },
    });
    const am = parts[0]!;
    expect(
      (new Date(am.end).getTime() - new Date(am.start).getTime()) / 3600000,
    ).toBe(hours);
    expect(classifyDeskPart(am, parts)).toBe("am");
  });
  it("classifies exact old ranges only and never relabels a changed operating-hour booking", () => {
    const parts = createDeskParts(options);
    for (const part of parts)
      expect(classifyDeskPart(part, parts)).toBe(part.part);
    const changed = createDeskParts({
      ...options,
      openHours: { thu: { open: "09:00", close: "20:00" } },
    });
    expect(classifyDeskPart(parts[2]!, changed)).toBeNull();
  });
});

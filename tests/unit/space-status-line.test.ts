import { describe, expect, it } from "vitest";
import { getAvailabilitySummary } from "@/features/bookings/availability";
import {
  getOperatingState,
  getOperatingWindow,
} from "@/features/bookings/operating-state";
import {
  getFloorSpaceStatusLine,
  getSpaceDayStatusLine,
  type SpaceStatusLine,
} from "@/features/bookings/space-status-line";
import type { OpenHours } from "@/lib/time/open-hours";
import { localDate, zonedDateTime } from "@/lib/time/zoned";

const date = "2026-10-07";
const timezone = "Asia/Seoul";
const at = (time: string, day = date, zone = timezone) =>
  zonedDateTime(day, time, zone).toISOString();
const booking = (start: string, end: string, isMine = false) => ({
  start: at(start),
  end: at(end),
  isMine,
});
type Detail = Parameters<typeof getSpaceDayStatusLine>[0];
type Overrides = Partial<Detail>;

function sources(overrides: Overrides = {}) {
  const detail: Detail = {
    date,
    now: at("15:25"),
    branch: { timezone, openHours: { wed: { open: "08:00", close: "22:00" } } },
    space: { bookable: true, deskCount: 0, bookingCount: 0 },
    bookings: [],
    blocks: [],
    ...overrides,
  };
  const now = new Date(detail.now);
  const zone = detail.branch.timezone;
  const isToday = detail.date === localDate(now, zone);
  const floor = {
    branch: detail.branch,
    date: detail.date,
    isToday,
    operatingState: getOperatingState(now, zone, detail.branch.openHours),
  };
  const space = {
    ...detail.space,
    summary:
      isToday && detail.space.bookable
        ? getAvailabilitySummary({
            now,
            window: getOperatingWindow(
              detail.date,
              zone,
              detail.branch.openHours,
            ),
            userId: "member",
            teamIds: ["team"],
            bookings: detail.bookings.map((row) => ({
              start: new Date(row.start),
              end: new Date(row.end),
              userId: "teammate",
              teamId: row.isMine ? "team" : null,
            })),
            blocks: detail.blocks.map((row) => ({
              start: new Date(row.start),
              end: new Date(row.end),
            })),
          })
        : null,
  };
  return { detail, floor, space };
}

function expectBoth(overrides: Overrides, expected: SpaceStatusLine) {
  const source = sources(overrides);
  expect(getFloorSpaceStatusLine(source.floor, source.space)).toEqual(expected);
  expect(getSpaceDayStatusLine(source.detail)).toEqual(expected);
}

describe("space status line for the list and detail", () => {
  it("shows the next occupied instant while free during opening hours", () => {
    expectBoth(
      { bookings: [booking("17:30", "18:00")] },
      { kind: "free", label: "17:30까지 비어 있음" },
    );
  });

  it("shows the next free instant while someone else uses the space", () => {
    expectBoth(
      { bookings: [booking("15:00", "16:30")] },
      { kind: "busy", label: "16:30부터 비어 있음" },
    );
  });

  it("does not call a touching maintenance interval free", () => {
    expectBoth(
      {
        bookings: [booking("15:00", "16:30")],
        blocks: [{ start: at("16:30"), end: at("17:30") }],
      },
      { kind: "busy", label: "17:30부터 비어 있음" },
    );
  });

  it("says there is no free time if the reservation lasts until closing", () => {
    expectBoth(
      { bookings: [booking("15:00", "22:00")] },
      { kind: "busy", label: "오늘은 빈 시간이 없어요" },
    );
  });

  it("labels a running personal or team reservation as mine", () => {
    expectBoth(
      { bookings: [booking("15:00", "16:00", true)] },
      { kind: "mine", label: "내 예약 · 16:00까지" },
    );
  });

  it("prioritizes maintenance and keeps its original next-day ending", () => {
    expectBoth(
      {
        bookings: [booking("15:00", "16:00", true)],
        blocks: [{ start: at("15:00"), end: at("12:00", "2026-10-08") }],
      },
      { kind: "maintenance", label: "점검 중 · 내일 12:00까지" },
    );
  });

  it("shows the opening time before today's opening", () => {
    expectBoth({ now: at("07:59") }, { kind: "none", label: "08:00에 열어요" });
  });

  it.each(["22:00", "23:30"])(
    "does not say the space is free at or after closing (%s)",
    (time) => {
      expectBoth(
        { now: at(time) },
        { kind: "none", label: "오늘 영업이 끝났어요" },
      );
    },
  );

  it.each([
    [0, "예약 없음"],
    [2, "예약 2건"],
  ])(
    "shows the selected future day's reservation count (%i)",
    (count, label) => {
      expectBoth(
        {
          date: "2026-10-08",
          space: { bookable: true, deskCount: 0, bookingCount: count },
        },
        { kind: "none", label },
      );
    },
  );

  it("does not classify a holiday as free", () => {
    expectBoth(
      { branch: { timezone, openHours: { wed: null } } },
      { kind: "none", label: "쉬는 날" },
    );
  });

  it.each([
    [0, "예약 없이 이용해요"],
    [12, "좌석 12석"],
  ])(
    "preserves the non-bookable space explanation (%i desks)",
    (deskCount, label) => {
      for (const now of [at("07:00"), at("15:25"), at("23:00")])
        expectBoth(
          {
            now,
            space: { bookable: false, deskCount, bookingCount: 0 },
          },
          { kind: "none", label },
        );
    },
  );

  it("never trusts an old free summary over a non-open operating state", () => {
    for (const overrides of [
      { now: at("07:00") },
      { now: at("23:00") },
      { branch: { timezone, openHours: { wed: null } } },
    ]) {
      const source = sources(overrides);
      const line = getFloorSpaceStatusLine(source.floor, {
        ...source.space,
        summary: { status: "free", until: at("22:00") },
      });
      expect(line.kind).toBe("none");
      expect(line.label).not.toContain("비어 있음");
    }
  });

  it("does not infer free status when the summary is unavailable", () => {
    const source = sources();
    expect(
      getFloorSpaceStatusLine(source.floor, { ...source.space, summary: null }),
    ).toEqual({ kind: "none", label: "예약 없음" });
    expect(
      getFloorSpaceStatusLine(source.floor, {
        ...source.space,
        summary: { status: "outside_hours" },
      }),
    ).toEqual({ kind: "none", label: "예약 없음" });
  });

  it("treats opening as inclusive and a finished reservation as free", () => {
    expectBoth(
      { now: at("08:00"), bookings: [booking("07:00", "08:00")] },
      { kind: "free", label: "22:00까지 비어 있음" },
    );
  });

  it("formats a midnight operating end as 24:00", () => {
    const branch = {
      timezone,
      openHours: { wed: { open: "08:00", close: "24:00" } },
    };
    expectBoth({ branch }, { kind: "free", label: "24:00까지 비어 있음" });
    expectBoth(
      { branch, bookings: [booking("15:00", "24:00", true)] },
      { kind: "mine", label: "내 예약 · 24:00까지" },
    );
  });

  it("keeps tomorrow rather than 24:00 for a midnight maintenance end", () => {
    expectBoth(
      { blocks: [{ start: at("15:00"), end: at("24:00") }] },
      { kind: "maintenance", label: "점검 중 · 내일 00:00까지" },
    );
  });

  it("uses the branch-local day and time instead of the host date", () => {
    const zone = "America/Los_Angeles";
    expectBoth(
      {
        now: "2026-10-08T00:30:00.000Z",
        branch: { timezone: zone, openHours: {} },
        bookings: [
          {
            start: at("18:00", date, zone),
            end: at("19:00", date, zone),
            isMine: false,
          },
        ],
      },
      { kind: "free", label: "18:00까지 비어 있음" },
    );
  });

  it("shows the actual opening instant after the DST skipped hour", () => {
    const zone = "America/New_York";
    const day = "2026-03-08";
    const openHours: OpenHours = { sun: { open: "02:30", close: "04:00" } };
    expectBoth(
      {
        date: day,
        now: at("01:59", day, zone),
        branch: { timezone: zone, openHours },
      },
      { kind: "none", label: "03:00에 열어요" },
    );
  });

  it("does not mutate a source DTO or read the current clock", () => {
    const source = sources({ bookings: [booking("15:00", "16:00", true)] });
    const before = JSON.stringify(source);
    expect(getFloorSpaceStatusLine(source.floor, source.space)).toEqual(
      getSpaceDayStatusLine(source.detail),
    );
    expect(JSON.stringify(source)).toBe(before);
  });
});

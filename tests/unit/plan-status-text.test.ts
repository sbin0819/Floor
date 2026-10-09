import { describe, expect, it } from "vitest";
import type {
  AvailabilityInterval,
  AvailabilityKind,
} from "@/features/bookings/availability";
import type { FloorVisibleSpace } from "@/features/bookings/types";
import {
  planStatesAt,
  planStatusText,
  planSummary,
  planTooltipText,
} from "@/features/floor-plan/states";
import { zonedDateTime } from "@/lib/time/zoned";
import { floorDayFixture } from "./booking-ui-fixtures";

const at = (time: string) => zonedDateTime("2026-10-07", time, "Asia/Seoul");
const day = {
  date: "2026-10-07",
  timezone: "Asia/Seoul",
  openHours: { wed: { open: "09:00", close: "14:00" } },
};
function room(intervals: AvailabilityInterval[] = []): FloorVisibleSpace {
  const space = floorDayFixture().spaces[0]!;
  if (space.kind !== "accessible")
    throw new Error("Expected visible room fixture");
  return { ...space, intervals };
}
const interval = (
  kind: AvailabilityKind,
  start: string,
  end: string,
): AvailabilityInterval => ({
  kind,
  start: at(start).toISOString(),
  end: at(end).toISOString(),
});

describe("floor-plan-specific status sentences", () => {
  it.each<{
    description: string;
    intervals: AvailabilityInterval[];
    current: string;
    expected: string;
  }>([
    {
      description: "next booking",
      intervals: [interval("other", "11:00", "12:00")],
      current: "10:00",
      expected: "6인 · 11:00까지 비어 있음",
    },
    {
      description: "next maintenance",
      intervals: [
        interval("maintenance", "10:30", "11:00"),
        interval("other", "11:00", "12:00"),
      ],
      current: "10:00",
      expected: "6인 · 10:30까지 비어 있음",
    },
    {
      description: "no more events",
      intervals: [],
      current: "10:00",
      expected: "6인 · 운영 종료까지 비어 있음",
    },
    {
      description: "other booking",
      intervals: [interval("other", "09:30", "10:30")],
      current: "10:00",
      expected: "6인 · 10:30까지 예약됨",
    },
    {
      description: "own booking",
      intervals: [interval("mine", "09:30", "10:30")],
      current: "10:00",
      expected: "내 예약 · 10:30까지",
    },
    {
      description: "maintenance",
      intervals: [interval("maintenance", "09:30", "10:30")],
      current: "10:00",
      expected: "점검 중 · 10:30까지",
    },
    {
      description: "maintenance through closing",
      intervals: [interval("maintenance", "09:30", "14:00")],
      current: "10:00",
      expected: "점검 중 · 운영 종료까지",
    },
    {
      description: "before opening",
      intervals: [],
      current: "08:59",
      expected: "운영 시간이 아니에요",
    },
    {
      description: "at opening",
      intervals: [],
      current: "09:00",
      expected: "6인 · 운영 종료까지 비어 있음",
    },
    {
      description: "at closing",
      intervals: [interval("mine", "13:00", "14:00")],
      current: "14:00",
      expected: "운영 시간이 아니에요",
    },
    {
      description: "after closing",
      intervals: [],
      current: "14:30",
      expected: "운영 시간이 아니에요",
    },
  ])("formats $description", ({ intervals, current, expected }) => {
    expect(planStatusText(room(intervals), at(current), day)).toBe(expected);
  });

  it.each(["other", "mine", "maintenance"] as const)(
    "merges touching %s ranges without mutating them",
    (kind) => {
      const space = room([
        interval(kind, "11:00", "12:00"),
        interval(kind, "09:30", "10:30"),
        interval(kind, "10:30", "11:00"),
      ]);
      const before = structuredClone(space);
      expect(planStatusText(space, at("10:00"), day)).toBe(
        kind === "other"
          ? "6인 · 12:00까지 예약됨"
          : kind === "mine"
            ? "내 예약 · 12:00까지"
            : "점검 중 · 12:00까지",
      );
      expect(space).toEqual(before);
    },
  );

  it("does not join different kinds or a gap in the same kind", () => {
    const space = room([
      interval("other", "09:30", "10:30"),
      interval("mine", "10:30", "11:00"),
      interval("other", "11:00", "12:00"),
    ]);
    expect(planStatusText(space, at("10:00"), day)).toBe(
      "6인 · 10:30까지 예약됨",
    );
    space.intervals = [
      interval("other", "09:30", "10:30"),
      interval("other", "11:00", "12:00"),
    ];
    expect(planStatusText(space, at("10:30"), day)).toBe(
      "6인 · 11:00까지 비어 있음",
    );
  });

  it("uses maintenance, mine, booked, free priority independent of input order and current summary", () => {
    const data = floorDayFixture();
    const space = room([
      interval("other", "09:00", "12:00"),
      interval("mine", "09:00", "11:00"),
      interval("maintenance", "09:00", "10:00"),
    ]);
    space.summary = { status: "busy", availableAt: null };
    data.isToday = false;
    data.spaces = [space];
    expect(planStatesAt(data, at("09:30")).get(space.id)).toMatchObject({
      kind: "maintenance",
      label: "점검 중 · 10:00까지",
    });
    expect(planStatesAt(data, at("10:00")).get(space.id)).toMatchObject({
      kind: "mine",
      label: "내 예약 · 11:00까지",
    });
    expect(planStatesAt(data, at("11:00")).get(space.id)).toMatchObject({
      kind: "booked",
      label: "6인 · 12:00까지 예약됨",
    });
    expect(planStatesAt(data, at("12:00")).get(space.id)).toMatchObject({
      kind: "free",
      label: "6인 · 운영 종료까지 비어 있음",
    });
  });

  it("does not manufacture a capacity when it is unknown", () => {
    const space = { ...room(), capacity: null };
    expect(planStatusText(space, at("10:00"), day)).toBe(
      "운영 종료까지 비어 있음",
    );
  });

  it("keeps lounges neutral, and closed bookable rooms do not claim free capacity", () => {
    const data = floorDayFixture();
    data.branch.openHours = { wed: null };
    data.spaces = [
      room(),
      { ...room(), id: "lounge", bookable: false, type: "lounge" },
    ];
    const states = planStatesAt(data, at("10:00"));
    expect(states.get("space")).toMatchObject({
      kind: "neutral",
      label: "쉬는 날이에요",
    });
    expect(states.get("lounge")).toMatchObject({
      kind: "neutral",
      label: "예약 없이 쓰는 곳",
    });
    expect(planSummary(data, states)).toBe("빈 공간 0 · 예약됨 0 · 점검 0");
  });

  it("uses branch local time across a repeated DST hour without browser timezone assumptions", () => {
    const space = room([
      {
        kind: "other",
        start: "2026-11-01T08:00:00.000Z",
        end: "2026-11-01T10:00:00.000Z",
      },
    ]);
    const la = {
      date: "2026-11-01",
      timezone: "America/Los_Angeles",
      openHours: { sun: { open: "00:00", close: "04:00" } },
    };
    for (const instant of [
      "2026-11-01T08:30:00.000Z",
      "2026-11-01T09:30:00.000Z",
    ])
      expect(planStatusText(space, new Date(instant), la)).toBe(
        "6인 · 02:00까지 예약됨",
      );
    expect(
      planStatusText(space, new Date("2026-11-01T10:00:00.000Z"), la),
    ).toBe("6인 · 운영 종료까지 비어 있음");
  });

  it("does not add states for unpublished or archived-space shapes missing from the authorized floor DTO", () => {
    const states = planStatesAt(floorDayFixture(), at("10:00"));
    expect(states.has("missing-space")).toBe(false);
    expect([...states.keys()].sort()).toEqual(["restricted", "space"]);
  });
});

describe("safe floor-plan tooltip text", () => {
  it("uses only safe visible name, capacity and selected-time status", () => {
    const data = floorDayFixture();
    const space = {
      ...room([interval("other", "09:00", "11:00")]),
      title: "비밀 예약 제목",
      teamName: "비밀 팀",
      bookerName: "비밀 사용자",
    };
    data.spaces = [space];
    const state = planStatesAt(data, at("10:00")).get(space.id)!;
    const tooltip = planTooltipText(state, space.capacity);
    expect(tooltip).toEqual({
      title: "회의실 C · 6인",
      description: "6인 · 11:00까지 예약됨",
    });
    expect(JSON.stringify({ state, tooltip })).not.toMatch(
      /비밀|title.*예약 제목|teamName|bookerName/,
    );
  });

  it("ignores even accidentally supplied restricted-space name, capacity and label", () => {
    expect(
      planTooltipText(
        { kind: "restricted", name: "비밀 공간", label: "비밀 예약" },
        6,
      ),
    ).toEqual({ title: "전용 공간", description: "다른 팀 전용이에요" });
  });

  it("does not add undefined metadata to neutral tooltips", () => {
    expect(
      planTooltipText({
        kind: "neutral",
        name: "라운지",
        label: "예약 없이 쓰는 곳",
      }),
    ).toEqual({ title: "라운지", description: "예약 없이 쓰는 곳" });
  });
});

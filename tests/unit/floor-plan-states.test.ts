import { describe, expect, it } from "vitest";
import { floorDayFixture } from "./booking-ui-fixtures";
import { planStatesAt, planSummary } from "@/features/floor-plan/states";
import {
  initialPlanTime,
  planTimeSlots,
  planTimeValueText,
} from "@/features/floor-plan/time";
import { zonedDateTime } from "@/lib/time/zoned";

const at = (time: string) => zonedDateTime("2026-10-07", time, "Asia/Seoul");
describe("floor plan display states", () => {
  it("never reveals a restricted name or marks a lounge as bookable", () => {
    const data = floorDayFixture();
    const room = data.spaces[0]!;
    if (room.kind !== "accessible") throw new Error("fixture");
    data.spaces.push({
      ...room,
      id: "lounge",
      type: "lounge",
      bookable: false,
    });
    const states = planStatesAt(data, at("10:00"));
    expect(states.get("restricted")).toEqual({
      kind: "restricted",
      name: "전용 공간",
      label: "다른 팀 전용",
    });
    expect(states.get("lounge")).toMatchObject({
      kind: "neutral",
      label: "예약 없이 이용해요",
    });
    expect(planSummary(data, states)).toBe("빈 공간 1 · 예약됨 0 · 점검 0");
  });
  it("uses half-open boundaries and prioritizes maintenance, mine, other, free", () => {
    const data = floorDayFixture();
    const room = data.spaces[0]!;
    if (room.kind !== "accessible") throw new Error("fixture");
    room.intervals = [
      {
        start: at("10:00").toISOString(),
        end: at("11:00").toISOString(),
        kind: "other",
      },
      {
        start: at("10:00").toISOString(),
        end: at("10:30").toISOString(),
        kind: "mine",
      },
      {
        start: at("10:00").toISOString(),
        end: at("10:15").toISOString(),
        kind: "maintenance",
      },
    ];
    expect(planStatesAt(data, at("10:00")).get(room.id)?.kind).toBe(
      "maintenance",
    );
    expect(planStatesAt(data, at("10:15")).get(room.id)?.kind).toBe("mine");
    expect(planStatesAt(data, at("10:30")).get(room.id)).toMatchObject({
      kind: "booked",
      label: "6인 · 11:00까지 예약됨",
    });
    expect(planStatesAt(data, at("11:00")).get(room.id)?.kind).toBe("free");
  });
  it("uses the original maintenance ending and contains no identity fields", () => {
    const data = floorDayFixture();
    const room = data.spaces[0]!;
    if (room.kind !== "accessible") throw new Error("fixture");
    room.planIntervals = [
      {
        start: at("12:00").toISOString(),
        end: zonedDateTime("2026-10-08", "12:00", "Asia/Seoul").toISOString(),
        kind: "maintenance",
      },
    ];
    expect(planStatesAt(data, at("13:00")).get(room.id)?.label).toBe(
      "6인 · 점검 중 · 내일 12:00까지",
    );
  });
  it("shows the selected desk part summary, and no free space claim on holidays", () => {
    const data = floorDayFixture();
    const room = data.spaces[0]!;
    if (room.kind !== "accessible") throw new Error("fixture");
    Object.assign(room, {
      type: "desk_area",
      bookable: false,
      deskCount: 24,
      deskParts: [
        {
          part: "morning",
          start: at("09:00").toISOString(),
          end: at("13:00").toISOString(),
          selectable: true,
          freeCount: 17,
          myDeskName: null,
        },
      ],
    });
    expect(planStatesAt(data, at("10:00")).get(room.id)).toMatchObject({
      deskArea: true,
      label: "빈 자리 17석",
    });
    data.branch.openHours = { wed: null };
    data.openHours = null;
    expect(planStatesAt(data, at("10:00")).get(room.id)?.label).toBe(
      "쉬는 날이에요",
    );
  });
});

describe("floor plan time bar", () => {
  it.each([
    ["08:29", "09:00"],
    ["09:00", "09:00"],
    ["10:29", "10:00"],
    ["14:00", "13:30"],
    ["23:59", "13:30"],
  ])("clamps %s to %s", (now, expected) => {
    expect(initialPlanTime(floorDayFixture(), at(now))).toBe(
      at(expected).getTime(),
    );
  });
  it("starts another date at opening, and omits a closed day", () => {
    const data = floorDayFixture();
    expect(initialPlanTime(data, new Date("2026-10-08T01:00:00Z"))).toBe(
      at("09:00").getTime(),
    );
    data.branch.openHours = { wed: null };
    expect(initialPlanTime(data)).toBeNull();
  });
  it("uses actual timestamps across DST and Korean accessible value text", () => {
    const data = floorDayFixture();
    data.date = "2026-11-01";
    data.branch.timezone = "America/Los_Angeles";
    data.branch.openHours = { sun: { open: "00:00", close: "04:00" } };
    const slots = planTimeSlots(data);
    expect(slots).toHaveLength(10);
    expect(
      slots.every(
        (value, index) =>
          index === 0 || value - slots[index - 1]! === 1_800_000,
      ),
    ).toBe(true);
    expect(planTimeValueText(at("11:30").getTime(), "Asia/Seoul")).toBe(
      "11시 30분",
    );
  });
});

import { describe, expect, it } from "vitest";
import { dayGridLayout } from "@/features/bookings/day-grid";
import { selectableSlots } from "@/features/bookings/selection";
import { spaceDayFixture } from "./booking-ui-fixtures";
import type { SpaceDayData } from "@/features/bookings/types";

function layout(data = spaceDayFixture(), showPast = false) {
  return dayGridLayout({
    ...data,
    timeZone: data.branch.timezone,
    slots: selectableSlots(data),
    showPast,
  });
}

describe("timestamp-based day grid", () => {
  it("starts at the current half-hour and counts each intersecting past booking once", () => {
    const data = spaceDayFixture();
    data.bookings.push({
      ...data.bookings[0]!,
      id: "past",
      start: "2026-10-07T00:00:00Z",
      end: "2026-10-07T01:30:00Z",
    });
    const value = layout(data);
    expect(value.hiddenSlots.map((slot) => slot.label)).toEqual([
      "09:00",
      "09:30",
    ]);
    expect(value.hiddenBookingCount).toBe(1);
    expect(value.slots[0]?.label).toBe("10:00");
    expect(value.currentPosition).toBeCloseTo(1 / 3);
    expect(
      value.blocks.find((block) => block.item.id === "past"),
    ).toMatchObject({ offset: 0, size: 1 });
    expect(
      layout(data, true).blocks.find((block) => block.item.id === "past"),
    ).toMatchObject({ offset: 0, size: 3 });
  });

  it("places one block per full interval and keeps all overlapping maintenance in distinct lanes", () => {
    const data = spaceDayFixture();
    data.blocks = [
      {
        id: "maintenance-1",
        start: "2026-10-07T02:30:00Z",
        end: "2026-10-07T03:30:00Z",
        reason: null,
      },
      {
        id: "maintenance-2",
        start: "2026-10-07T02:45:00Z",
        end: "2026-10-07T03:15:00Z",
        reason: null,
      },
    ];
    const value = layout(data);
    expect(value.blocks).toHaveLength(3);
    expect(
      value.blocks.map(({ offset, size, lane, lanes }) => ({
        offset,
        size,
        lane,
        lanes,
      })),
    ).toEqual([
      { offset: 2, size: 2, lane: 0, lanes: 3 },
      { offset: 3, size: 2, lane: 1, lanes: 3 },
      { offset: 3.5, size: 1, lane: 2, lanes: 3 },
    ]);
  });

  it("does not split touching intervals into lanes and clips blocks at opening/closing", () => {
    const data = spaceDayFixture();
    data.blocks = [
      {
        id: "before",
        start: "2026-10-06T10:00:00Z",
        end: "2026-10-07T01:00:00Z",
        reason: null,
      },
      {
        id: "after",
        start: "2026-10-07T03:00:00Z",
        end: "2026-10-08T10:00:00Z",
        reason: null,
      },
    ];
    const value = layout(data, true);
    expect(
      value.blocks.map(({ size, lane, lanes }) => ({ size, lane, lanes })),
    ).toEqual([
      { size: 2, lane: 0, lanes: 1 },
      { size: 2, lane: 0, lanes: 1 },
      { size: 4, lane: 0, lanes: 1 },
    ]);
  });

  it("shows all slots on another date and collapses all slots after closing", () => {
    const data = spaceDayFixture();
    expect(
      layout({ ...data, now: "2026-10-06T01:10:00Z" }).hiddenSlots,
    ).toEqual([]);
    const closed = layout({ ...data, now: "2026-10-07T06:00:00Z" });
    expect(closed.slots).toEqual([]);
    expect(closed.blocks).toEqual([]);
    expect(closed.hiddenBookingCount).toBe(1);
    expect(closed.currentPosition).toBeNull();
    expect(
      layout({
        ...data,
        openHours: null,
        branch: { ...data.branch, openHours: { wed: null } },
      }).slots,
    ).toEqual([]);
  });

  function dstDay(date: string, now: string): SpaceDayData {
    const data = spaceDayFixture();
    return {
      ...data,
      date,
      now,
      bookings: [],
      blocks: [],
      branch: {
        ...data.branch,
        timezone: "America/New_York",
        openHours: { sun: { open: "00:00", close: "04:00" } },
      },
    };
  }
  it("keeps the second repeated hour, position, and clipped block on DST fall-back", () => {
    const data = dstDay("2026-11-01", "2026-11-01T06:15:00Z");
    data.bookings = [
      {
        id: "repeated-hour",
        start: "2026-11-01T05:30:00Z",
        end: "2026-11-01T06:30:00Z",
        bookerName: "회원",
        isMine: false,
        canCancel: false,
      },
    ];
    const value = layout(data);
    expect(value.hiddenSlots).toHaveLength(4);
    expect(value.slots[0]).toMatchObject({
      start: "2026-11-01T06:00:00.000Z",
      label: "01:00",
    });
    expect(value.currentPosition).toBe(0.5);
    expect(value.blocks[0]).toMatchObject({ offset: 0, size: 1 });
    expect(layout(data, true).slots).toHaveLength(10);
  });
  it("does not create a missing spring-forward hour", () => {
    const value = layout(dstDay("2026-03-08", "2026-03-08T06:45:00Z"), true);
    expect(value.slots).toHaveLength(6);
    expect(value.slots.map((slot) => slot.label)).not.toContain("02:00");
    expect(value.currentPosition).toBe(3.5);
  });
});

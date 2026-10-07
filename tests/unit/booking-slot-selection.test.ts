import { describe, expect, it } from "vitest";
import { createBookingSlots } from "@/features/bookings/rules";
import {
  selectBookingSlot,
  type SelectableSlot,
} from "@/features/bookings/selection";

const slots: SelectableSlot[] = createBookingSlots({
  date: "2026-10-07",
  timeZone: "Asia/Seoul",
  openHours: { wed: { open: "09:00", close: "18:00" } },
}).map((slot) => ({ ...slot, state: "free" }));

describe("click-to-select booking slots", () => {
  it("starts with one hour", () => {
    expect(selectBookingSlot(slots, null, slots[0]!.start)).toEqual({
      start: slots[0]!.start,
      end: slots[1]!.end,
    });
  });

  it.each(["reserved", "maintenance"] as const)(
    "shortens the initial hour before %s",
    (state) => {
      const blocked = slots.map((slot, index) => ({
        ...slot,
        state: index === 1 ? state : slot.state,
      }));
      expect(selectBookingSlot(blocked, null, slots[0]!.start)).toEqual({
        start: slots[0]!.start,
        end: slots[0]!.end,
      });
    },
  );

  it("shortens the initial hour at closing", () => {
    const last = slots.at(-1)!;
    expect(selectBookingSlot(slots, null, last.start)).toEqual({
      start: last.start,
      end: last.end,
    });
  });

  it("extends through every contiguous free slot", () => {
    expect(
      selectBookingSlot(
        slots,
        { start: slots[0]!.start, end: slots[1]!.end },
        slots[5]!.start,
      ),
    ).toEqual({ start: slots[0]!.start, end: slots[5]!.end });
  });

  it.each(["reserved", "maintenance", "past"] as const)(
    "starts over after a %s gap",
    (state) => {
      const blocked = slots.map((slot, index) => ({
        ...slot,
        state: index === 3 ? state : slot.state,
      }));
      expect(
        selectBookingSlot(
          blocked,
          { start: slots[0]!.start, end: slots[1]!.end },
          slots[5]!.start,
        ),
      ).toEqual({ start: slots[5]!.start, end: slots[6]!.end });
    },
  );

  it("starts over when an earlier slot is chosen", () => {
    expect(
      selectBookingSlot(
        slots,
        { start: slots[5]!.start, end: slots[6]!.end },
        slots[2]!.start,
      ),
    ).toEqual({ start: slots[2]!.start, end: slots[3]!.end });
  });

  it("does not silently trim a selection to booking quotas", () => {
    expect(
      selectBookingSlot(
        slots,
        { start: slots[0]!.start, end: slots[1]!.end },
        slots.at(-1)!.start,
      ),
    ).toEqual({ start: slots[0]!.start, end: slots.at(-1)!.end });
  });

  it("ignores an unavailable or unknown click", () => {
    const selected = { start: slots[0]!.start, end: slots[1]!.end };
    expect(selectBookingSlot(slots, selected, "unknown")).toBe(selected);
    expect(
      selectBookingSlot(
        slots.map((slot) => ({ ...slot, state: "reserved" })),
        selected,
        slots[2]!.start,
      ),
    ).toBe(selected);
  });

  it("does not bridge a missing slot", () => {
    expect(
      selectBookingSlot(
        slots.filter((_, index) => index !== 3),
        { start: slots[0]!.start, end: slots[1]!.end },
        slots[5]!.start,
      ),
    ).toEqual({ start: slots[5]!.start, end: slots[6]!.end });
  });

  it("extends using instants when a DST fold repeats an earlier clock label", () => {
    const folded: SelectableSlot[] = createBookingSlots({
      date: "2026-11-01",
      timeZone: "America/New_York",
      openHours: { sun: { open: "00:00", close: "04:00" } },
    }).map((slot) => ({ ...slot, state: "free" }));
    const first = folded.find(
      (slot) => slot.start === "2026-11-01T05:30:00.000Z",
    )!;
    const second = folded.find(
      (slot) => slot.start === "2026-11-01T06:00:00.000Z",
    )!;
    expect(
      selectBookingSlot(
        folded,
        { start: first.start, end: first.end },
        second.start,
      ),
    ).toEqual({ start: first.start, end: second.end });
  });
});

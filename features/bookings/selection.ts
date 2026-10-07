import {
  createBookingSlots,
  currentSlotStart,
  type BookingSlot,
} from "@/features/bookings/rules";
import type { DayBooking, SpaceDayData } from "@/features/bookings/types";

export type SelectableSlot = BookingSlot & {
  state: "free" | "past" | "reserved" | "maintenance";
  booking?: DayBooking;
  block?: SpaceDayData["blocks"][number];
};

export function selectableSlots(data: SpaceDayData): SelectableSlot[] {
  const minimum = currentSlotStart(
    new Date(data.now),
    data.branch.timezone,
  ).getTime();
  return createBookingSlots({
    date: data.date,
    timeZone: data.branch.timezone,
    openHours: data.branch.openHours,
  }).map((slot) => {
    const start = new Date(slot.start).getTime();
    const end = new Date(slot.end).getTime();
    const overlaps = (range: { start: string; end: string }) =>
      new Date(range.start).getTime() < end &&
      new Date(range.end).getTime() > start;
    const block = data.blocks.find(overlaps);
    const booking = data.bookings.find(overlaps);
    return {
      ...slot,
      state: block
        ? "maintenance"
        : booking
          ? "reserved"
          : start < minimum
            ? "past"
            : "free",
      ...(block ? { block } : {}),
      ...(booking ? { booking } : {}),
    };
  });
}

export function selectableEnds(
  slots: SelectableSlot[],
  start: string,
): SelectableSlot[] {
  const index = slots.findIndex((slot) => slot.start === start);
  if (index < 0) return [];
  const ends: SelectableSlot[] = [];
  let next = start;
  for (const slot of slots.slice(index)) {
    if (slot.state !== "free" || slot.start !== next) break;
    ends.push(slot);
    next = slot.end;
  }
  return ends;
}

export function suggestedEnd(slots: SelectableSlot[], start: string): string {
  const ends = selectableEnds(slots, start);
  return (ends[1] ?? ends[0])?.end ?? "";
}

export type BookingSelection = { start: string; end: string };

export function selectBookingSlot(
  slots: SelectableSlot[],
  selection: BookingSelection | null,
  clickedStart: string,
): BookingSelection | null {
  const clicked = slots.find(
    (slot) => slot.start === clickedStart && slot.state === "free",
  );
  if (!clicked) return selection;
  if (selection && Date.parse(clicked.start) > Date.parse(selection.start)) {
    const reachable = selectableEnds(slots, selection.start).find(
      (slot) => slot.start === clicked.start,
    );
    if (reachable) return { start: selection.start, end: reachable.end };
  }
  return { start: clicked.start, end: suggestedEnd(slots, clicked.start) };
}

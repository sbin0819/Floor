import type { FloorDayData } from "@/features/bookings/types";
import { getOperatingWindow } from "@/features/bookings/operating-state";
import { localDate, localTime } from "@/lib/time/zoned";

export function planTimeSlots(data: FloorDayData): number[] {
  const window = getOperatingWindow(
    data.date,
    data.branch.timezone,
    data.branch.openHours,
  );
  if (!window) return [];
  const slots: number[] = [];
  for (
    let at = Date.parse(window.start);
    at < Date.parse(window.end);
    at += 30 * 60_000
  )
    slots.push(at);
  return slots;
}

export function initialPlanTime(
  data: FloorDayData,
  now = new Date(data.now),
): number | null {
  const slots = planTimeSlots(data);
  if (!slots.length) return null;
  if (data.date !== localDate(now, data.branch.timezone)) return slots[0]!;
  return slots.findLast((at) => at <= now.getTime()) ?? slots[0]!;
}

export function planTimeLabel(at: number, timeZone: string) {
  return localTime(new Date(at), timeZone);
}

export function planTimeValueText(at: number, timeZone: string) {
  const [hours, minutes] = planTimeLabel(at, timeZone).split(":").map(Number);
  return `${hours}시${minutes ? ` ${minutes}분` : ""}`;
}

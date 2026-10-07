import { getOpenHours, type OpenHours } from "@/lib/time/open-hours";
import { addDays } from "@/lib/time/zoned";

export function nextOpenDate({
  date,
  today,
  openHours,
}: {
  date: string;
  today: string;
  openHours: OpenHours;
}): string | null {
  const lastDate = addDays(today, 60);
  let next = addDays(date, 1);
  while (next <= lastDate) {
    if (getOpenHours(openHours, next) !== null) return next;
    next = addDays(next, 1);
  }
  return null;
}

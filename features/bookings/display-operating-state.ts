import { getOperatingState } from "@/features/bookings/operating-state";
import { getOpenHours } from "@/lib/time/open-hours";
import { localDate } from "@/lib/time/zoned";

export function getDisplayOperatingState({
  date,
  now,
  timeZone,
  openHours,
}: {
  date: string;
  now: string;
  timeZone: string;
  openHours: unknown;
}) {
  const instant = new Date(now);
  const today = localDate(instant, timeZone);
  const isToday = date === today;
  const hours = getOpenHours(openHours, date);
  const operating = getOperatingState(instant, timeZone, openHours);
  const status =
    operating.status === "open"
      ? "영업 중"
      : operating.status === "before_open"
        ? "영업 전"
        : "영업 종료";
  const label = !hours
    ? "쉬는 날"
    : `${isToday ? `${status} · ` : ""}${hours.open}–${hours.close}`;
  return {
    today,
    isToday,
    hours,
    operating,
    label,
    kind: isToday && hours && operating.status === "open" ? "free" : "none",
  } as const;
}

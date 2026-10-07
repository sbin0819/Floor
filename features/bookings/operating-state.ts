import { getOpenHours, type DayOpenHours } from "@/lib/time/open-hours";
import { addDays, localDate, zonedDateTime } from "@/lib/time/zoned";

export type OperatingWindow = { start: string; end: string };
export type OperatingState = {
  status: "open" | "before_open" | "after_close" | "closed";
  date: string;
  hours: DayOpenHours | null;
  window: OperatingWindow | null;
  nextOpening: string | null;
};

export function getOperatingWindow(
  date: string,
  timeZone: string,
  openHours: unknown,
): OperatingWindow | null {
  const hours = getOpenHours(openHours, date);
  if (!hours) return null;
  const start = zonedDateTime(date, hours.open, timeZone);
  const end = zonedDateTime(date, hours.close, timeZone);
  // DST가 건너뛴 구간 안에 시작·끝이 모두 있으면 실제 운영 시간이 없다.
  return start < end
    ? { start: start.toISOString(), end: end.toISOString() }
    : null;
}

export function getOperatingState(
  now: Date,
  timeZone: string,
  openHours: unknown,
): OperatingState {
  const date = localDate(now, timeZone);
  const hours = getOpenHours(openHours, date);
  const window = getOperatingWindow(date, timeZone, openHours);
  const current = now.getTime();
  const status = !window
    ? "closed"
    : current < Date.parse(window.start)
      ? "before_open"
      : current < Date.parse(window.end)
        ? "open"
        : "after_close";
  let nextOpening: string | null = null;
  if (status !== "open") {
    // 오늘만 운영하는 지점의 다음 주 같은 요일까지 확인한다.
    for (let offset = 0; offset <= 7; offset += 1) {
      const candidate =
        offset === 0
          ? window
          : getOperatingWindow(addDays(date, offset), timeZone, openHours);
      if (candidate && Date.parse(candidate.start) > current) {
        nextOpening = candidate.start;
        break;
      }
    }
  }
  return { status, date, hours, window, nextOpening };
}

import { addDays, localDate } from "@/lib/time/zoned";
import { relativeBookingStatus } from "./format";

export function homeBookingStatus(
  booking: { start: string; end: string; timezone: string },
  now: string,
): { label: string; remaining: string | null; kind: "mine" | "none" } {
  const current = Date.parse(now);
  if (current >= Date.parse(booking.end))
    return { label: "이용 종료", remaining: null, kind: "none" };
  if (current >= Date.parse(booking.start))
    return {
      label: "지금 이용 중",
      remaining: `${Math.ceil((Date.parse(booking.end) - current) / 60_000)}분 남음`,
      kind: "mine",
    };
  const today = localDate(new Date(now), booking.timezone);
  const date = localDate(new Date(booking.start), booking.timezone);
  if (date === today)
    return {
      label: `오늘 · ${relativeBookingStatus(booking.start, booking.end, now) ?? `${Math.floor((Date.parse(booking.start) - current) / 3_600_000)}시간 뒤`}`,
      remaining: null,
      kind: "none",
    };
  const label = new Intl.DateTimeFormat("ko-KR", {
    timeZone: booking.timezone,
    month: "long",
    day: "numeric",
    weekday: "short",
  })
    .format(new Date(booking.start))
    .replace(/[()]/g, "");
  return {
    label: `${date === addDays(today, 1) ? "내일 · " : ""}${label}`,
    remaining: null,
    kind: "none",
  };
}

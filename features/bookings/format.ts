import { addDays, localDate, localTime, zonedDateTime } from "@/lib/time/zoned";
import type { SpaceType } from "@/features/bookings/types";

export const spaceTypeLabels: Record<SpaceType, string> = {
  meeting_room: "회의실",
  seminar: "세미나실",
  phone_booth: "폰부스",
  desk_area: "데스크 구역",
  lounge: "라운지",
  desk: "좌석",
};

export function formatBookingDate(date: string, timeZone: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone,
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(zonedDateTime(date, "12:00", timeZone));
}

export function formatBookingTime(
  start: string,
  end: string,
  timeZone: string,
): string {
  const first = new Date(start);
  const last = new Date(end);
  const finish =
    localDate(last, timeZone) !== localDate(first, timeZone) &&
    localTime(last, timeZone) === "00:00"
      ? "24:00"
      : localTime(last, timeZone);
  return `${localTime(first, timeZone)}–${finish}`;
}

export function floorHref(
  branchId: string,
  floorId: string,
  date?: string,
  spaceId?: string,
  view?: string,
  detail?: boolean,
): string {
  const query = new URLSearchParams();
  if (date) query.set("date", date);
  if (spaceId) query.set("space", spaceId);
  if (spaceId && detail) query.set("detail", "1");
  if (view) query.set("view", view);
  return `/branches/${branchId}/floors/${floorId}${query.size ? `?${query}` : ""}`;
}

export function formatAvailabilityUntil(
  end: string,
  referenceDate: string,
  timeZone: string,
  options: { midnightAs24?: boolean } = {},
): string {
  const instant = new Date(end);
  const date = localDate(instant, timeZone);
  const time = localTime(instant, timeZone);
  if (
    options.midnightAs24 &&
    date === addDays(referenceDate, 1) &&
    time === "00:00"
  )
    return "24:00까지";
  if (date === referenceDate) return `${time}까지`;
  if (date === addDays(referenceDate, 1)) return `내일 ${time}까지`;
  const label = new Intl.DateTimeFormat("ko-KR", {
    timeZone,
    month: "long",
    day: "numeric",
  }).format(instant);
  return `${label} ${time}까지`;
}

export function formatNextOpening(
  nextOpening: string | null,
  now: string,
  timeZone: string,
): string {
  if (!nextOpening) return "운영 예정 시간이 없어요";
  const instant = new Date(nextOpening);
  const today = localDate(new Date(now), timeZone);
  const date = localDate(instant, timeZone);
  const day =
    date === today
      ? "오늘"
      : date === addDays(today, 1)
        ? "내일"
        : new Intl.DateTimeFormat("ko-KR", {
            timeZone,
            weekday: "long",
          }).format(instant);
  return `${day} ${localTime(instant, timeZone)}에 열어요`;
}

export function relativeBookingStatus(
  start: string,
  end: string,
  now: string,
): string | null {
  const begins = Date.parse(start);
  const finishes = Date.parse(end);
  const current = Date.parse(now);
  if (![begins, finishes, current].every(Number.isFinite) || finishes <= begins)
    throw new RangeError("Invalid booking interval.");
  if (current >= finishes) return null;
  if (current >= begins) return "지금 이용 중";
  const minutes = (begins - current) / 60_000;
  if (minutes < 60) return `${Math.max(1, Math.ceil(minutes))}분 뒤`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}시간 뒤`;
  return null;
}

export function formatBookingDayHeading(
  date: string,
  now: string,
  timeZone: string,
): string {
  const today = localDate(new Date(now), timeZone);
  const prefix =
    date === today ? "오늘 · " : date === addDays(today, 1) ? "내일 · " : "";
  return `${prefix}${formatBookingDate(date, timeZone)}`;
}

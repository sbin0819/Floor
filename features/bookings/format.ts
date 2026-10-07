import { localDate, localTime, zonedDateTime } from "@/lib/time/zoned";
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
): string {
  const query = new URLSearchParams();
  if (date) query.set("date", date);
  if (spaceId) query.set("space", spaceId);
  return `/branches/${branchId}/floors/${floorId}${query.size ? `?${query}` : ""}`;
}

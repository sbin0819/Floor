import { addDays, localDate, localTime } from "@/lib/time/zoned";
import {
  formatBookingDate,
  formatBookingTime,
} from "@/features/bookings/format";

type MeetingBooking = {
  title: string | null;
  spaceName: string;
  start: string;
  end: string;
  timezone: string;
  status: "confirmed" | "cancelled";
};
export function meetingName(
  booking: Pick<MeetingBooking, "title" | "spaceName">,
) {
  return booking.title || `${booking.spaceName} 회의`;
}
export function meetingPhase(
  booking: Pick<MeetingBooking, "start" | "end" | "status">,
  now: string,
) {
  if (booking.status === "cancelled") return "cancelled" as const;
  if (Date.parse(now) < Date.parse(booking.start)) return "upcoming" as const;
  return Date.parse(now) < Date.parse(booking.end)
    ? ("ongoing" as const)
    : ("ended" as const);
}
export const meetingPhaseLabels = {
  upcoming: "곧 시작",
  ongoing: "진행 중",
  ended: "지난 회의",
  cancelled: "취소됨",
} as const;
export function meetingTime(
  booking: Pick<MeetingBooking, "start" | "end" | "timezone">,
) {
  return `${formatBookingDate(localDate(new Date(booking.start), booking.timezone), booking.timezone)} · ${formatBookingTime(booking.start, booking.end, booking.timezone)}`;
}
export function meetingStartLabel(
  start: string,
  timezone: string,
  now: string,
) {
  const instant = new Date(start);
  const day = localDate(instant, timezone);
  const today = localDate(new Date(now), timezone);
  const date =
    day === today
      ? "오늘"
      : day === addDays(today, 1)
        ? "내일"
        : new Intl.DateTimeFormat("ko-KR", {
            timeZone: timezone,
            month: "long",
            day: "numeric",
          }).format(instant);
  return `${date} ${localTime(instant, timezone)}`;
}

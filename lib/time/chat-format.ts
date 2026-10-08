import { addDays, localDate } from "./zoned";

export const CHAT_TIMEZONE = "Asia/Seoul";

export function formatChatDate(
  instant: string,
  now: string,
  timeZone = CHAT_TIMEZONE,
): string {
  const date = localDate(new Date(instant), timeZone);
  const today = localDate(new Date(now), timeZone);
  if (date === today) return "오늘";
  if (date === addDays(today, -1)) return "어제";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone,
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(Date.parse(instant));
}

export function formatChatTime(
  instant: string,
  timeZone = CHAT_TIMEZONE,
): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(Date.parse(instant));
}

export function chatDate(instant: string): string {
  return localDate(new Date(instant), CHAT_TIMEZONE);
}

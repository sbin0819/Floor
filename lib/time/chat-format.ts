import { addDays, localDate, localTime } from "./zoned";

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

// "오전 9:12", "오후 12:00" 꼴이다. ICU 버전에 따라 ko-KR의 12시간 표기가 "AM 9:12"로 바뀌므로
// Intl에 기대지 않고 지점 시간대의 시·분으로 직접 만든다.
export function formatChatTime(
  instant: string,
  timeZone = CHAT_TIMEZONE,
): string {
  const [hour, minute] = localTime(new Date(instant), timeZone)
    .split(":")
    .map(Number) as [number, number];
  const period = hour < 12 ? "오전" : "오후";
  const twelveHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${period} ${twelveHour}:${String(minute).padStart(2, "0")}`;
}

export function chatDate(instant: string): string {
  return localDate(new Date(instant), CHAT_TIMEZONE);
}

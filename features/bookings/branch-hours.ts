import { getOpenHours, type DayOpenHours } from "@/lib/time/open-hours";
import { addDays, dayKeys, weekday, type DayKey } from "@/lib/time/zoned";

const dayLabels: Record<DayKey, string> = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
  sun: "일",
};

export function formatBranchHours(hours: DayOpenHours | null): string {
  if (!hours) return "쉼";
  const shortTime = (time: string) => time.replace(/:00$/, "");
  return `${shortTime(hours.open)}–${shortTime(hours.close)}`;
}

export function summarizeBranchWeek(openHours: unknown, today: string) {
  const todayKey = weekday(today);
  const monday = addDays(today, -dayKeys.indexOf(todayKey));
  return dayKeys.map((day, index) => {
    const hours = getOpenHours(openHours, addDays(monday, index));
    const label = dayLabels[day];
    const isToday = day === todayKey;
    return {
      day,
      label,
      isToday,
      hoursLabel: formatBranchHours(hours),
      accessibleLabel: `${label}요일 ${hours ? `${hours.open}부터 ${hours.close}까지` : "쉬는 날"}${isToday ? ", 오늘" : ""}`,
    };
  });
}

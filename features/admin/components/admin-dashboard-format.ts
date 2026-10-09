import { addDays, localDate, localTime, weekday } from "@/lib/time/zoned";
import { utilizationPercent } from "@/lib/floor-plan/render/utilization";
import type { AdminDashboardData, DashboardRange } from "../dashboard-types";

export const dashboardRangeLabels: Record<DashboardRange, string> = {
  day: "오늘",
  week: "이번 주",
  "30days": "30일",
};
export function dashboardHref(
  data: Pick<AdminDashboardData, "branch" | "date" | "range" | "floorId">,
  change: Partial<Pick<AdminDashboardData, "date" | "range" | "floorId">> = {},
) {
  const value = { ...data, ...change };
  const query = new URLSearchParams({ date: value.date, range: value.range });
  if (value.floorId) query.set("floor", value.floorId);
  return `/admin/branches/${data.branch.id}?${query}`;
}
export function dashboardDate(date: string) {
  const day = {
    mon: "월요일",
    tue: "화요일",
    wed: "수요일",
    thu: "목요일",
    fri: "금요일",
    sat: "토요일",
    sun: "일요일",
  }[weekday(date)];
  return `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일 ${day}`;
}
export function dashboardTime(at: string, timezone: string) {
  return localTime(new Date(at), timezone);
}
export function dashboardRelativeTime(
  at: string,
  now: string,
  timezone: string,
) {
  const date = localDate(new Date(at), timezone);
  const today = localDate(new Date(now), timezone);
  const label =
    date === today
      ? "오늘"
      : date === addDays(today, 1)
        ? "내일"
        : `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`;
  return `${label} ${dashboardTime(at, timezone)}`;
}
export function dashboardComparison(
  current: number | null,
  previous: number | null,
  range: DashboardRange,
) {
  if (current === null || previous === null) return null;
  const difference = Math.round((current - previous) * 100);
  const label = {
    day: "지난주 같은 요일보다",
    week: "지난주보다",
    "30days": "앞 30일보다",
  }[range];
  return `${label} ${difference > 0 ? "+" : ""}${difference}%p`;
}
export function dashboardPercent(value: number | null) {
  const percent = utilizationPercent(value);
  return percent === null ? "이용률 없음" : `${percent}%`;
}

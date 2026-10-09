import type { ReportResolution } from "./reports-types";
export type { ReportResolution } from "./reports-types";
export type ReportTab = "open" | "resolved";
export function reportTab(value: unknown): ReportTab {
  return value === "resolved" ? "resolved" : "open";
}
export function reportsPath(branchId: string) {
  return `/admin/branches/${encodeURIComponent(branchId)}/reports`;
}
export function reportsHref(branchId: string, tab: ReportTab) {
  return `${reportsPath(branchId)}?tab=${tab}`;
}
export const reportReasonLabels = {
  spam: "스팸",
  harassment: "괴롭힘",
  inappropriate: "부적절한 내용",
  other: "기타",
};
export const reportResolutionLabels: Record<ReportResolution, string> = {
  dismissed: "문제 없음",
  message_deleted: "메시지 지움",
  member_banned: "라운지에서 내보냄",
};
export function reportDate(at: string, timezone: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: timezone,
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(at));
}

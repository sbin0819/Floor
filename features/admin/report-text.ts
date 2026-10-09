import {
  excerptOf,
  mentionLabel,
  type MentionNames,
} from "@/features/chat/message-text";
import type { ReportSummary } from "./reports-types";

// 운영자 DTO에는 코드 안의 원시 멘션 ID도 남기지 않아요. 일반 채팅 파서는 그대로 둡니다.
export function reportBodyText(body: string, names: MentionNames): string {
  return body.replace(
    /<@(everyone|[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})>/giu,
    (_, id: string) => mentionLabel(id.toLowerCase(), names),
  );
}
export function reportExcerpt(body: string, names: MentionNames): string {
  return Array.from(excerptOf(reportBodyText(body, names)))
    .slice(0, 40)
    .join("");
}
export function serializeReportSummary(
  value: ReportSummary | null,
): ReportSummary | null {
  return value
    ? {
        count: value.count,
        oldestAt: value.oldestAt
          ? new Date(value.oldestAt).toISOString()
          : null,
      }
    : null;
}

import type { DeskPartSummary } from "./types";

export function deskPartStatus(part: DeskPartSummary): string {
  return part.myDeskName
    ? `내 자리 ${part.myDeskName}`
    : part.freeCount > 0
      ? `빈 자리 ${part.freeCount}석`
      : "자리 없음";
}

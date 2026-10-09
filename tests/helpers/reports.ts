import type {
  BranchReportGroup,
  BranchReportsData,
} from "@/features/admin/reports-types";
export const reportBranchId = "b0000000-0000-4000-8000-000000000001";
export function reportGroupFixture(
  change: Partial<BranchReportGroup> = {},
): BranchReportGroup {
  return {
    messageId: "b1000000-0000-4000-8000-000000000001",
    roomKind: "text",
    roomLabel: "강남점 라운지 · # 라운지",
    author: {
      name: "박지훈",
      username: "jihoon",
      avatar: { color: "blue", photoUrl: null },
    },
    body: "함께 쓰는 라운지예요. 서로 배려해 주세요.",
    deleted: false,
    canBan: true,
    reasons: [
      { reason: "spam", count: 2 },
      { reason: "other", count: 1 },
    ],
    count: 3,
    oldestAt: "2026-10-14T00:00:00.000Z",
    details: ["같은 글이 반복돼요.", "<img src=x onerror=alert(1)>"],
    context: [{ authorName: "김민서", excerpt: "안내 내용을 확인했어요" }],
    ...change,
  };
}
export function branchReportsFixture(
  change: Partial<BranchReportsData> = {},
): BranchReportsData {
  return {
    branch: { id: reportBranchId, name: "강남점", timezone: "Asia/Seoul" },
    now: "2026-10-14T03:00:00.000Z",
    tab: "open",
    reportSummary: { count: 2, oldestAt: "2026-10-14T00:00:00.000Z" },
    rows: [
      reportGroupFixture(),
      reportGroupFixture({
        messageId: "b1000000-0000-4000-8000-000000000002",
        roomKind: "meeting",
        roomLabel: "회의실 C · 10월 14일 회의",
        author: {
          name: "정유나",
          username: null,
          avatar: { color: "green", photoUrl: null },
        },
        body: "자료를 확인해 주세요.",
        context: [],
        canBan: false,
        reasons: [{ reason: "harassment", count: 1 }],
        count: 1,
        details: [],
      }),
    ],
    ...change,
  };
}

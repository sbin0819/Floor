import type { Avatar } from "@/lib/avatar";

export type ReportSummary = { count: number; oldestAt: string | null };
export type BranchReportReason =
  "spam" | "harassment" | "inappropriate" | "other";
export type ReportResolution =
  "dismissed" | "message_deleted" | "member_banned";
export type BranchReportGroup = {
  messageId: string;
  roomKind: "text" | "voice" | "meeting";
  roomLabel: string;
  author: { name: string; username: string | null; avatar: Avatar };
  body: string;
  deleted: boolean;
  canBan: boolean;
  reasons: { reason: BranchReportReason; count: number }[];
  count: number;
  oldestAt: string;
  details: string[];
  context: { authorName: string; excerpt: string }[];
  resolution?: ReportResolution;
  resolvedByName?: string;
  resolvedAt?: string;
};
export type BranchReportsData = {
  branch: { id: string; name: string; timezone: string };
  now: string;
  tab: "open" | "resolved";
  reportSummary: ReportSummary | null;
  rows: BranchReportGroup[];
};

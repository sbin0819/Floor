import { ActionError } from "@/lib/actions/result";
import { requireSession } from "@/lib/auth/session";
import { toAvatar } from "@/lib/avatar";
import {
  listBranchReportGroups,
  readOpenReportSummary,
  readReportBranch,
} from "@/lib/dal/reports-read";
import { can } from "@/lib/permissions/can";
import { loadPermissionContext } from "@/lib/permissions/context";
import { loungeAccessFrom } from "@/lib/permissions/lounge";
import { addDays, localDate, zonedDateTime } from "@/lib/time/zoned";
import { readBookingNow } from "@/features/bookings/request-clock";
import type { AdminQueryDependencies } from "./query-factory";
import {
  getBranchReportsSchema,
  type GetBranchReportsInput,
} from "./reports-schema";
import type { BranchReportsData } from "./reports-types";
import {
  reportBodyText,
  reportExcerpt,
  serializeReportSummary,
} from "./report-text";

export function createReportsQueries(
  dependencies: AdminQueryDependencies = {},
) {
  const db = dependencies.database;
  return {
    async getBranchReports(
      input: GetBranchReportsInput,
    ): Promise<BranchReportsData> {
      const session = await (dependencies.requireSession ?? requireSession)();
      const parsed = getBranchReportsSchema.safeParse(input);
      if (!parsed.success) throw new ActionError("INVALID_INPUT");
      const { branchId, tab } = parsed.data;
      const scope = { branchId, userId: session.userId };
      const [branch, context] = await Promise.all([
        readReportBranch(scope, db),
        loadPermissionContext(session, branchId, db),
      ]);
      if (!branch || !context.staffBranchIds.includes(branchId))
        throw new ActionError("NOT_FOUND");
      if (!can(context, "branch.announce", { branchId }))
        throw new ActionError("FORBIDDEN");
      const now = dependencies.now?.() ?? readBookingNow(db !== undefined);
      const cutoff = zonedDateTime(
        addDays(localDate(now, branch.timezone), -30),
        "00:00",
        branch.timezone,
      );
      const [rows, reportSummary] = await Promise.all([
        listBranchReportGroups({ ...scope, tab, now, cutoff }, db),
        readOpenReportSummary(scope, db),
      ]);
      return {
        branch: { id: branch.id, name: branch.name, timezone: branch.timezone },
        now: now.toISOString(),
        tab,
        reportSummary: serializeReportSummary(reportSummary),
        rows: rows.map(({ row }) => {
          const meetingDate = row.bookingStart
            ? localDate(new Date(row.bookingStart), branch.timezone).split("-")
            : null;
          return {
            messageId: row.messageId,
            roomKind: row.roomKind,
            roomLabel:
              row.roomKind === "meeting"
                ? `${row.spaceName} · ${Number(meetingDate?.[1])}월 ${Number(meetingDate?.[2])}일 회의`
                : `${branch.name} 라운지 · # ${row.roomName ?? "채널"}`,
            author: {
              name: row.authorName,
              username: row.authorUsername,
              avatar: toAvatar(row.authorAvatar),
            },
            body: row.deleted
              ? "지운 메시지"
              : reportBodyText(row.body, row.names),
            deleted: row.deleted,
            canBan:
              tab === "open" &&
              row.roomKind !== "meeting" &&
              row.authorId !== session.userId &&
              !loungeAccessFrom({
                isStaff: row.authorIsStaff,
                roleSettings: context.roleSettings[branchId] ?? {},
              }).isAdmin,
            count: row.count,
            oldestAt: new Date(row.oldestAt).toISOString(),
            details: row.details,
            reasons: row.reasons
              .filter(({ count }) => count > 0)
              .sort((a, b) => b.count - a.count),
            context: row.context.map((item) => ({
              authorName: item.authorName,
              excerpt: reportExcerpt(item.body, item.names),
            })),
            ...(row.resolution && row.resolvedAt && row.resolvedByName !== null
              ? {
                  resolution: row.resolution,
                  resolvedAt: new Date(row.resolvedAt).toISOString(),
                  resolvedByName: row.resolvedByName,
                }
              : {}),
          };
        }),
      };
    },
  };
}

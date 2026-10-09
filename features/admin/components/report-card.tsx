import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/user-avatar";
import { notificationAge } from "@/features/notifications/format";
import type { BranchReportGroup } from "../reports-types";
import {
  reportDate,
  reportReasonLabels,
  reportResolutionLabels,
  type ReportResolution,
} from "../report-navigation";

export function reportGroupKey(row: BranchReportGroup) {
  return JSON.stringify([
    row.messageId,
    row.oldestAt,
    row.count,
    row.resolvedAt ?? null,
    row.resolution ?? null,
  ]);
}
export function ReportCard({
  row,
  now,
  timezone,
  pending,
  onResolve,
}: {
  row: BranchReportGroup;
  now: string;
  timezone: string;
  pending?: boolean;
  onResolve?: (
    row: BranchReportGroup,
    resolution: ReportResolution,
    trigger: HTMLButtonElement,
  ) => void;
}) {
  const id = useId();
  const reasons = [...row.reasons].sort((a, b) => b.count - a.count);
  return (
    <article
      aria-labelledby={id}
      className="min-w-0 space-y-4 rounded-xl border bg-card p-4 shadow-card sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          {reasons.map(({ reason, count }) => (
            <Badge key={reason} variant="outline">
              {reportReasonLabels[reason]}{" "}
              <span className="tabular-nums">{count}</span>
            </Badge>
          ))}
          <span className="text-muted-foreground tabular-nums">
            신고 {row.count}건 ·{" "}
            <time
              dateTime={row.oldestAt}
              title={reportDate(row.oldestAt, timezone)}
            >
              {notificationAge(row.oldestAt, now, timezone)}
            </time>
          </span>
        </div>
        <p className="wrap-anywhere text-muted-foreground">{row.roomLabel}</p>
      </div>
      <div className="flex items-start gap-3">
        <UserAvatar
          name={row.author.name}
          avatar={row.author.avatar}
          size={40}
        />
        <div className="min-w-0 flex-1 space-y-2">
          <h2 id={id} className="flex flex-wrap gap-x-2 text-sm font-semibold">
            {row.author.name}
            {row.author.username && (
              <span className="font-normal text-muted-foreground">
                @{row.author.username}
              </span>
            )}
          </h2>
          <p className="rounded-lg border bg-muted/40 p-3 text-sm leading-6 break-words wrap-anywhere whitespace-pre-wrap">
            {row.deleted ? "지운 메시지" : row.body}
          </p>
          {row.roomKind !== "meeting" && row.context.length > 0 && (
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>앞의 메시지</p>
              <ul className="space-y-1">
                {row.context.map((item, index) => (
                  <li key={index} className="wrap-anywhere">
                    {item.authorName}: {item.excerpt}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      {row.details.length > 0 && (
        <details className="text-sm">
          <summary className="flex min-h-11 cursor-pointer items-center rounded-sm text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">
            설명 {row.details.length}개
          </summary>
          <ul className="list-inside list-disc space-y-2 rounded-lg bg-muted/40 p-3">
            {row.details.map((detail, index) => (
              <li key={index} className="wrap-anywhere whitespace-pre-wrap">
                {detail}
              </li>
            ))}
          </ul>
        </details>
      )}
      {row.resolution ? (
        <p className="border-t pt-3 text-sm text-muted-foreground">
          {reportResolutionLabels[row.resolution]} · {row.resolvedByName}
          {row.resolvedAt && (
            <>
              {" "}
              ·{" "}
              <time dateTime={row.resolvedAt} className="tabular-nums">
                {reportDate(row.resolvedAt, timezone)}
              </time>
            </>
          )}
        </p>
      ) : (
        onResolve && (
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              disabled={pending}
              onClick={(event) =>
                onResolve(row, "dismissed", event.currentTarget)
              }
            >
              문제 없음
            </Button>
            {row.canBan && row.roomKind !== "meeting" && (
              <Button
                variant="outline"
                disabled={pending}
                onClick={(event) =>
                  onResolve(row, "member_banned", event.currentTarget)
                }
              >
                라운지에서 내보내기
              </Button>
            )}
            {!row.deleted && (
              <Button
                variant="destructive"
                disabled={pending}
                onClick={(event) =>
                  onResolve(row, "message_deleted", event.currentTarget)
                }
              >
                메시지 지우기
              </Button>
            )}
          </div>
        )
      )}
    </article>
  );
}

import Link from "next/link";
import { Check, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isBlockingPlanIssue } from "@/lib/floor-plan/issues";
import type { PlanPublishPreview, PlanVersion } from "../publish-types";
import { deskPartLabels } from "@/features/bookings/desk-parts";

export function PublishPlanSummary({
  data,
  branchId,
}: {
  data: PlanPublishPreview;
  branchId: string;
}) {
  const blocking = data.issues.filter(isBlockingPlanIssue);
  const warnings = data.issues.filter((issue) => !isBlockingPlanIssue(issue));
  return (
    <div className="space-y-5 text-sm">
      <dl className="grid grid-cols-2 gap-3 rounded-xl border p-4 tabular-nums">
        <dt>바뀐 공간 도형</dt>
        <dd>{data.changedShapes}개</dd>
        <dt>새 좌석</dt>
        <dd>{data.seats.created.length}개</dd>
        <dt>이름을 바꾸는 좌석</dt>
        <dd>{data.seats.renamed.length}개</dd>
        <dt>없어지는 좌석</dt>
        <dd>{data.seats.archived.length}개 · 보관돼요</dd>
      </dl>
      {data.seats.created.length > 0 && (
        <p>새 좌석: {data.seats.created.join(", ")}</p>
      )}
      {data.seats.archived.length > 0 && (
        <p>보관할 좌석: {data.seats.archived.join(", ")}</p>
      )}
      {data.seats.renamed.length > 0 && (
        <ul aria-label="바뀌는 좌석 이름" className="space-y-1">
          {data.seats.renamed.map((seat, index) => (
            <li key={index}>
              {seat.from} → {seat.to}
            </li>
          ))}
        </ul>
      )}
      <section className="space-y-3" aria-label="게시 검사">
        {blocking.length === 0 ? (
          <p className="flex items-center gap-2">
            <Check className="size-4" aria-hidden />
            게시를 막는 문제가 없어요
          </p>
        ) : (
          <>
            <h3 className="flex items-center gap-2 font-bold text-status-busy-foreground">
              <AlertTriangle className="size-4" aria-hidden />
              게시 전에 확인해 주세요
            </h3>
            <ul className="list-disc space-y-2 pl-5">
              {blocking.map((issue, index) => (
                <li key={`${issue.code}-${index}`}>{issue.message}</li>
              ))}
            </ul>
          </>
        )}
        {warnings.length > 0 && (
          <div className="space-y-2">
            <h3 className="font-semibold">알림 · 게시할 수 있어요</h3>
            <ul>
              {warnings.map((issue, index) => (
                <li key={index}>{issue.message}</li>
              ))}
            </ul>
          </div>
        )}
      </section>
      {data.blockingBookings.length > 0 && (
        <section
          className="space-y-3 rounded-xl border border-status-busy-strong bg-status-busy p-4"
          aria-label="남아 있는 예약"
        >
          <h3 className="font-bold">
            예약을 취소하거나 좌석을 남겨야 게시할 수 있어요
          </h3>
          <ul className="space-y-2 tabular-nums">
            {data.blockingBookings.map((booking, index) => (
              <li key={index}>
                {booking.seatName} · {booking.date} ·{" "}
                {booking.part
                  ? deskPartLabels[booking.part]
                  : booking.timeRange}{" "}
                · {booking.bookerName ?? "예약 1건"}
              </li>
            ))}
          </ul>
          <Link
            href={`/admin/branches/${branchId}/bookings`}
            className="inline-flex min-h-11 items-center underline"
          >
            예약 현황에서 보기
          </Link>
        </section>
      )}
    </div>
  );
}

export function PlanVersionList({
  versions,
  timezone,
  disabled,
  onSelect,
}: {
  versions: readonly PlanVersion[];
  timezone: string;
  disabled: boolean;
  onSelect: (version: PlanVersion) => void;
}) {
  return versions.length === 0 ? (
    <p className="py-6 text-muted-foreground">아직 게시한 버전이 없어요</p>
  ) : (
    <ul className="divide-y">
      {versions.map((version) => (
        <li
          key={version.planId}
          className="flex flex-wrap items-center justify-between gap-3 py-4"
        >
          <div className="space-y-1">
            <h3 className="font-bold tabular-nums">
              버전 {version.version} ·{" "}
              {version.status === "published" ? "게시됨" : "지난 버전"}
            </h3>
            <p className="text-sm text-muted-foreground tabular-nums">
              {version.publishedAt
                ? new Intl.DateTimeFormat("ko-KR", {
                    timeZone: timezone,
                    dateStyle: "medium",
                    timeStyle: "short",
                    hour12: false,
                  }).format(new Date(version.publishedAt))
                : "게시 시각 없음"}{" "}
              · {version.publishedByName ?? "이름 없음"}
            </p>
          </div>
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => onSelect(version)}
          >
            버전 {version.version}으로 초안 만들기
          </Button>
        </li>
      ))}
    </ul>
  );
}

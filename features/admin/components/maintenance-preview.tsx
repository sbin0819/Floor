"use client";

import { createContext, useContext, useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBookingTime } from "@/features/bookings/format";
import { localDate } from "@/lib/time/zoned";
import type { MaintenancePreview as MaintenancePreviewData } from "../maintenance-types";

export type MaintenancePreviewResult =
  { ok: true; data: MaintenancePreviewData } | { ok: false; message: string };
export const MaintenancePreviewContext = createContext<{
  key: string | null;
  accept: (key: string, result: MaintenancePreviewResult) => void;
} | null>(null);

export function MaintenancePreviewSkeleton() {
  return (
    <div className="space-y-3 rounded-lg border p-4" aria-busy="true">
      <span role="status" className="sr-only">
        겹치는 예약을 확인하고 있어요
      </span>
      <Skeleton className="h-5 w-52" />
      <Skeleton className="h-14 w-full" />
    </div>
  );
}
export function MaintenancePreview({
  requestKey,
  result,
  timezone,
}: {
  requestKey: string;
  result: MaintenancePreviewResult;
  timezone: string;
}) {
  const context = useContext(MaintenancePreviewContext);
  const matches = context?.key === requestKey;
  const accept = context?.accept;
  useEffect(() => {
    if (matches) accept?.(requestKey, result);
  }, [accept, matches, requestKey, result]);
  if (!matches) return null;
  if (!result.ok)
    return (
      <p role="alert" className="text-sm text-destructive">
        {result.message}
      </p>
    );
  const rows = result.data.bookings;
  if (!rows.length)
    return (
      <p role="status" className="rounded-lg border p-4 text-sm">
        겹치는 예약이 없어요
      </p>
    );
  return (
    <section
      className="overflow-hidden rounded-lg border border-status-busy-border"
      aria-label="취소될 예약"
    >
      <h3 className="flex items-center gap-2 bg-status-busy p-3 text-sm font-semibold text-status-busy-foreground">
        <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
        겹치는 예약 <span className="tabular-nums">{rows.length}건</span>이
        취소돼요
      </h3>
      <ul className="max-h-64 divide-y overflow-y-auto">
        {rows.map((row) => (
          <li key={row.id} className="space-y-1 p-3 text-sm">
            <p className="font-medium tabular-nums">
              {localDate(new Date(row.start), timezone)} ·{" "}
              {formatBookingTime(row.start, row.end, timezone)}
            </p>
            <p className="text-muted-foreground">
              {row.bookerName}
              {row.teamName ? ` · ${row.teamName}` : ""} · 참석{" "}
              <span className="tabular-nums">{row.attendeeCount}</span>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

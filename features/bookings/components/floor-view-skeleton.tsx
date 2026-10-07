"use client";

import { SkeletonRegion } from "@/components/skeleton-region";
import { Skeleton } from "@/components/ui/skeleton";
import type { FloorView } from "@/features/bookings/floor-view";
import { FloorSpaceListSkeleton } from "./booking-skeletons";
import { useFloorView } from "./floor-view";

function TimetableShape() {
  return (
    <div
      data-slot="skeleton-timetable"
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="flex h-12 items-center gap-8 border-b border-border px-4">
        <Skeleton className="h-4 w-36 shrink-0" />
        {[0, 1, 2, 3, 4].map((key) => (
          <Skeleton key={key} className="h-4 w-12 shrink-0" />
        ))}
      </div>
      <Skeleton className="h-10 w-full rounded-none" />
      {[0, 1, 2, 3].map((key) => (
        <div
          key={key}
          className="grid h-16 grid-cols-[148px_1fr] border-b border-border last:border-b-0 lg:grid-cols-[232px_1fr]"
        >
          <div className="flex items-center gap-3 px-4">
            <Skeleton className="hidden h-9 w-12 lg:block" />
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="grid grid-cols-8 divide-x divide-border">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((cell) => (
              <div key={cell} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
export function FloorViewsSkeleton({
  initialView,
}: {
  initialView?: FloorView | null;
}) {
  const { view } = useFloorView(initialView);
  return (
    <SkeletonRegion>
      <div aria-hidden="true">
        {view !== "timeline" && (
          <div className={view === null ? "lg:hidden" : undefined}>
            <FloorSpaceListSkeleton />
          </div>
        )}
        {view !== "list" && (
          <div className={view === null ? "hidden lg:block" : undefined}>
            <TimetableShape />
          </div>
        )}
      </div>
    </SkeletonRegion>
  );
}

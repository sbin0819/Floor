"use client";

import { SkeletonRegion } from "@/components/skeleton-region";
import type { FloorView } from "@/features/bookings/floor-view";
import { FloorSpaceListShape } from "./booking-skeletons";
import { FloorTimetableShape } from "./floor-loading-shapes";
import { useFloorView } from "./floor-view";

export function FloorViewsSkeleton({
  initialView,
}: {
  initialView?: FloorView | null;
}) {
  const { effectiveView: view } = useFloorView(initialView);
  return (
    <SkeletonRegion>
      <div aria-hidden="true">
        {view === "plan" && (
          <div className="h-[32rem] rounded-xl border border-border bg-muted/40" />
        )}
        {view === "list" && (
          <div>
            <FloorSpaceListShape />
          </div>
        )}
        {view === "timeline" && (
          <div>
            <FloorTimetableShape />
          </div>
        )}
      </div>
    </SkeletonRegion>
  );
}

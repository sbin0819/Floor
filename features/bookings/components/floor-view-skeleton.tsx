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
  const { view } = useFloorView(initialView);
  return (
    <SkeletonRegion>
      <div aria-hidden="true">
        {view !== "timeline" && (
          <div className={view === null ? "lg:hidden" : undefined}>
            <FloorSpaceListShape />
          </div>
        )}
        {view !== "list" && (
          <div className={view === null ? "hidden lg:block" : undefined}>
            <FloorTimetableShape />
          </div>
        )}
      </div>
    </SkeletonRegion>
  );
}

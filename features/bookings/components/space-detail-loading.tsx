"use client";

import { SkeletonRegion } from "@/components/skeleton-region";
import { Skeleton } from "@/components/ui/skeleton";
import { SpaceDetailSkeleton } from "./booking-skeletons";
import { useFloorView } from "./floor-view";
import { useWideScreen } from "./use-wide-screen";
import { useFloorSelection } from "./branch-workspace";

export function SpaceDetailLoading() {
  const { effectiveView } = useFloorView();
  const wide = useWideScreen();
  const detail = useFloorSelection()?.location.detail === true;
  if (!wide || effectiveView === "list" || detail)
    return (
      <SpaceDetailSkeleton
        expanded={wide && effectiveView === "timeline" && detail}
      />
    );
  return (
    <SkeletonRegion className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} className="h-11" />
        ))}
      </div>
      <Skeleton className="h-4 w-40" />
    </SkeletonRegion>
  );
}

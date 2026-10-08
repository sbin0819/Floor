"use client";

import { SkeletonRegion } from "@/components/skeleton-region";
import { Skeleton } from "@/components/ui/skeleton";
import { SpaceDetailSkeleton } from "./booking-skeletons";
import { useFloorView } from "./floor-view";
import { useWideScreen } from "./use-wide-screen";
import { useFloorSelection } from "./branch-workspace";
import { spaceDetailMode } from "../space-detail-mode";

export function SpaceDetailLoading() {
  const { effectiveView } = useFloorView();
  const wide = useWideScreen();
  const workspace = useFloorSelection();
  const space = workspace?.floorData?.spaces.find(
    (space) =>
      space.kind === "accessible" && space.id === workspace.location.spaceId,
  );
  const { mode, desk } = spaceDetailMode({
    wide,
    view: effectiveView,
    detail: workspace?.location.detail === true,
    space: space?.kind === "accessible" ? space : null,
  });
  if (desk) return <DeskPickerSkeleton />;
  if (mode !== "strip")
    return <SpaceDetailSkeleton expanded={mode === "detail"} />;
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

function DeskPickerSkeleton() {
  return (
    <SkeletonRegion className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
      <Skeleton className="h-40 shrink-0 rounded-none" />
      <div className="space-y-2 border-b border-border p-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-52" />
      </div>
      <div className="grid shrink-0 grid-cols-3 gap-2 p-4">
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} className="h-24" />
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <h3 className="mb-3 text-sm font-bold">자리 고르기</h3>
        <div className="grid grid-cols-6 gap-2">
          {Array.from({ length: 24 }, (_, index) => (
            <Skeleton key={index} className="h-11 min-w-0" />
          ))}
        </div>
      </div>
      <div className="shrink-0 space-y-3 border-t border-border p-4">
        <Skeleton className="h-10" />
        <Skeleton className="h-11" />
        <Skeleton className="h-11" />
      </div>
    </SkeletonRegion>
  );
}

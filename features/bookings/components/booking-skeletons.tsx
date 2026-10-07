import { SkeletonRegion } from "@/components/skeleton-region";
import {
  SkeletonFields,
  SkeletonHeading,
  SkeletonRows,
} from "@/components/skeleton-shapes";
import { Skeleton } from "@/components/ui/skeleton";

function FloorNavigationShape() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <SkeletonHeading />
        <div className="flex gap-2">
          <Skeleton className="h-11 w-20" />
          <Skeleton className="h-11 w-36" />
          <Skeleton className="h-11 w-20" />
        </div>
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-11 w-16" />
        <Skeleton className="h-11 w-16" />
      </div>
    </div>
  );
}

function FloorSpaceListShape() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-6 w-32" />
      <SkeletonRows count={4} action />
    </div>
  );
}

export function FloorNavigationSkeleton() {
  return (
    <SkeletonRegion>
      <FloorNavigationShape />
    </SkeletonRegion>
  );
}

export function FloorSpaceListSkeleton() {
  return (
    <SkeletonRegion>
      <FloorSpaceListShape />
    </SkeletonRegion>
  );
}

export function FloorPageSkeleton() {
  return (
    <SkeletonRegion width="wide" className="space-y-6">
      <FloorNavigationShape />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,25rem)]">
        <FloorSpaceListShape />
        <div className="flex min-h-40 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border p-8">
          <Skeleton className="size-11" />
          <Skeleton className="h-5 w-48 max-w-full" />
        </div>
      </div>
    </SkeletonRegion>
  );
}

export function SpaceDetailSkeleton() {
  return (
    <SkeletonRegion className="space-y-6 rounded-xl border border-border bg-card p-5">
      <SkeletonHeading />
      <div className="flex gap-2">
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} className="h-6 w-20 rounded-full" />
        ))}
      </div>
      <SkeletonFields count={3} />
      <div className="space-y-2">
        {[0, 1, 2, 3, 4, 5].map((key) => (
          <Skeleton key={key} className="h-11 w-full" />
        ))}
      </div>
      <Skeleton className="h-11 w-full" />
    </SkeletonRegion>
  );
}

export function BranchListSkeleton() {
  return (
    <SkeletonRegion width="standard" className="space-y-6">
      <SkeletonHeading />
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1].map((key) => (
          <div key={key} className="space-y-5 rounded-xl border bg-card p-5">
            <SkeletonHeading compact />
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-11 w-28" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

export function BranchFloorsSkeleton() {
  return (
    <SkeletonRegion width="standard" className="space-y-6">
      <SkeletonHeading />
      <SkeletonRows count={2} />
    </SkeletonRegion>
  );
}

export function MyBookingsSkeleton() {
  return (
    <SkeletonRegion width="standard" className="space-y-8">
      <Skeleton className="h-8 w-36" />
      {[0, 1].map((key) => (
        <div key={key} className="space-y-4">
          <Skeleton className="h-7 w-40" />
          <SkeletonRows count={2} action={key === 0} />
        </div>
      ))}
    </SkeletonRegion>
  );
}
